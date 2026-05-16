import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const STUDYTUBE_OAUTH_URL = "https://backend.studytube.nl/gateway/oauth/token";
const STUDYTUBE_COURSES_URL = "https://public-api.studytube.nl/api/v2/courses";
const STUDYTUBE_DEEPLINK_BASE = "https://app.studytube.nl/nl/courses";

const HAIKU_BATCH_SIZE = 50;
const EMBEDDING_BATCH_SIZE = 20;

const STOPWOORDEN = new Set([
  "de", "het", "een", "en", "in", "van", "voor", "met", "op", "aan", "bij",
  "uit", "over", "naar", "als", "je", "zijn", "is", "dat", "te", "om", "hoe",
  "wat", "wie", "er", "zo", "of", "maar", "ook", "al", "dan", "nog", "door",
]);

function fallbackTrefwoorden(cursusnaam: string): string[] {
  return cursusnaam
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWOORDEN.has(w));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const clientId = Deno.env.get("STUDYTUBE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("STUDYTUBE_CLIENT_SECRET")!;

  // Valideer API keys
  if (!anthropicKey) {
    console.error("[Sync] ANTHROPIC_API_KEY niet geconfigureerd");
  }
  if (!openaiKey) {
    console.error("[Sync] OPENAI_API_KEY niet geconfigureerd");
  }

  // ── Auth: controleer dat de aanroeper een admin is ──
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Niet ingelogd" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, tenant_id")
    .eq("user_id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return new Response(JSON.stringify({ error: "Alleen admins kunnen synchroniseren" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tenantId = profile.tenant_id as string;

  try {
    // ── 1. OAuth token ophalen ──
    const tokenRes = await fetch(STUDYTUBE_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return new Response(JSON.stringify({ error: "OAuth mislukt", detail: tokenData }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = tokenData.access_token as string;
    const apiHeaders = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    // ── 2. Alle cursussen ophalen (gepagineerd) ──
    let allCourses: Array<{ id: number; name: string; duration: number }> = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${STUDYTUBE_COURSES_URL}?page=${page}&per_page=100`, { headers: apiHeaders });
      if (!res.ok) break;
      const batch = await res.json() as Array<{ id: number; name: string; duration: number }>;
      if (!Array.isArray(batch) || batch.length === 0) break;
      allCourses = allCourses.concat(batch);
      if (batch.length < 100) break;
      page++;
    }

    if (allCourses.length === 0) {
      return new Response(JSON.stringify({ error: "Geen cursussen gevonden van StudyTube" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[Sync] ${allCourses.length} cursussen opgehaald van StudyTube API`);

    // ── 3. Trefwoorden genereren via Claude Haiku (batches van 50) ──
    const keywordMap = new Map<number, string[]>();
    let haikuSucces = 0;
    let haikuFallback = 0;

    if (anthropicKey) {
      for (let i = 0; i < allCourses.length; i += HAIKU_BATCH_SIZE) {
        const batch = allCourses.slice(i, i + HAIKU_BATCH_SIZE);
        const cursusList = batch.map((c) => `id: ${c.id}, naam: ${c.name}`).join("\n");

        const prompt = `Voor elke training hieronder: geef 8-12 Nederlandse trefwoorden die beschrijven waar de training INHOUDELIJK over gaat. Denk vanuit de medewerker: welke woorden zou iemand gebruiken als hij een vraag stelt over dit onderwerp? Niet de naam herhalen maar de betekenis beschrijven.

Geef output ALLEEN als geldig JSON array, geen uitleg:
[{"id": 123, "trefwoorden": ["woord1", "woord2"]}]

Trainingen:
${cursusList}`;

        try {
          const haikuRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 8192,
              messages: [{ role: "user", content: prompt }],
            }),
          });

          if (!haikuRes.ok) {
            const errText = await haikuRes.text();
            console.error(`[Sync] Haiku batch ${i} HTTP ${haikuRes.status}: ${errText.substring(0, 300)}`);
          } else {
            const haikuData = await haikuRes.json();
            const tekst = haikuData.content?.[0]?.text || "";
            const stopReason = haikuData.stop_reason || "unknown";

            if (stopReason === "max_tokens") {
              console.warn(`[Sync] Haiku batch ${i} afgekapt (max_tokens bereikt)`);
            }

            if (!tekst) {
              console.warn(`[Sync] Haiku batch ${i} lege response, data:`, JSON.stringify(haikuData).substring(0, 300));
            } else {
              const jsonMatch = tekst.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: number | string; trefwoorden: string[] }>;
                  for (const entry of parsed) {
                    const entryId = typeof entry.id === "string" ? parseInt(entry.id, 10) : entry.id;
                    if (entryId && Array.isArray(entry.trefwoorden) && entry.trefwoorden.length > 0) {
                      keywordMap.set(entryId, entry.trefwoorden.map((t: string) => t.toLowerCase().trim()));
                      haikuSucces++;
                    }
                  }
                } catch (parseErr) {
                  console.error(`[Sync] Haiku batch ${i} JSON parse fout:`, parseErr, "tekst start:", tekst.substring(0, 200));
                }
              } else {
                console.warn(`[Sync] Haiku batch ${i} geen JSON array gevonden in response, start:`, tekst.substring(0, 200));
              }
            }
          }
        } catch (e) {
          console.error(`[Sync] Haiku batch ${i} exception:`, e);
        }

        // Fallback: voor cursussen zonder Haiku-trefwoorden, gebruik naam-parsing
        for (const course of batch) {
          if (!keywordMap.has(course.id)) {
            keywordMap.set(course.id, fallbackTrefwoorden(course.name));
            haikuFallback++;
          }
        }
      }
    } else {
      // Geen API key — alles via fallback
      for (const course of allCourses) {
        keywordMap.set(course.id, fallbackTrefwoorden(course.name));
        haikuFallback++;
      }
    }
    console.log(`[Sync] Haiku trefwoorden gegenereerd voor ${haikuSucces} cursussen, fallback voor ${haikuFallback}`);

    // ── 4. Embeddings genereren via OpenAI (batches van 20) ──
    const embeddingMap = new Map<number, number[]>();
    let embeddingSucces = 0;

    if (openaiKey) {
      for (let i = 0; i < allCourses.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = allCourses.slice(i, i + EMBEDDING_BATCH_SIZE);
        const inputs = batch.map((c) => {
          const trefwoorden = keywordMap.get(c.id) || [];
          return c.name + ": " + trefwoorden.join(", ");
        });

        try {
          const embRes = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
          });

          if (!embRes.ok) {
            const errText = await embRes.text();
            console.error(`[Sync] Embedding batch ${i} HTTP ${embRes.status}: ${errText.substring(0, 300)}`);
          } else {
            const embData = await embRes.json();
            for (let j = 0; j < batch.length; j++) {
              const emb = embData.data?.[j]?.embedding;
              if (emb && Array.isArray(emb)) {
                embeddingMap.set(batch[j].id, emb);
                embeddingSucces++;
              }
            }
          }
        } catch (e) {
          console.error(`[Sync] Embedding batch ${i} exception:`, e);
        }
      }
    } else {
      console.error("[Sync] Geen OPENAI_API_KEY — embeddings overgeslagen");
    }
    console.log(`[Sync] OpenAI embeddings gegenereerd voor ${embeddingSucces} van ${allCourses.length} cursussen`);

    // ── 5. Upsert in studytube_cursussen ──
    const rows = allCourses.map((c) => ({
      tenant_id: tenantId,
      studytube_course_id: String(c.id),
      naam: c.name,
      duur_minuten: c.duration ? Math.round(c.duration / 60) : null,
      deeplink_url: `${STUDYTUBE_DEEPLINK_BASE}/${c.id}`,
      trefwoorden: keywordMap.get(c.id) || [],
      embedding: embeddingMap.has(c.id) ? JSON.stringify(embeddingMap.get(c.id)) : null,
      laatst_gesynchroniseerd: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabaseAdmin
      .from("studytube_cursussen")
      .upsert(rows, { onConflict: "tenant_id,studytube_course_id" });

    if (upsertErr) {
      console.error("[Sync] Upsert fout:", upsertErr.message);
      return new Response(JSON.stringify({ error: "Upsert mislukt: " + upsertErr.message }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Sync] Upsert voltooid voor ${allCourses.length} cursussen`);

    return new Response(
      JSON.stringify({
        cursussen_gesynchroniseerd: allCourses.length,
        haiku_trefwoorden: haikuSucces,
        haiku_fallback: haikuFallback,
        embeddings_gegenereerd: embeddingSucces,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[StudyTube Sync] Onverwachte fout:", err);
    return new Response(JSON.stringify({ error: "Synchronisatie mislukt: " + String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
