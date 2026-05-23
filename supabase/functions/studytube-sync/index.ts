import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const STUDYTUBE_OAUTH_URL = "https://backend.studytube.nl/gateway/oauth/token";
const STUDYTUBE_COURSES_URL = "https://public-api.studytube.nl/api/v2/courses";
const STUDYTUBE_DEEPLINK_BASE = "https://app.studytube.nl/nl/courses";

const EMBEDDING_BATCH_SIZE = 20;
const BESCHRIJVING_BATCH_SIZE = 50;
const MAX_BESCHRIJVING_PER_SYNC = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const clientId = Deno.env.get("STUDYTUBE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("STUDYTUBE_CLIENT_SECRET")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";

  if (!openaiKey) console.error("[Sync] OPENAI_API_KEY niet geconfigureerd");
  if (!anthropicKey) console.warn("[Sync] ANTHROPIC_API_KEY niet geconfigureerd");

  // Auth
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
    // 1. Bestaande cursussen ophalen
    const { data: bestaandRows } = await supabaseAdmin
      .from("studytube_cursussen")
      .select("studytube_course_id, embedding, beschrijving")
      .eq("tenant_id", tenantId);

    const bestaandMap = new Map<string, { heeftEmbedding: boolean; heeftBeschrijving: boolean }>();
    for (const r of bestaandRows ?? []) {
      bestaandMap.set(String(r.studytube_course_id), {
        heeftEmbedding: !!r.embedding,
        heeftBeschrijving: r.beschrijving !== null && r.beschrijving !== undefined && r.beschrijving !== "",
      });
    }
    console.log(`[Sync] ${bestaandMap.size} cursussen al in DB, ${[...bestaandMap.values()].filter(v => v.heeftBeschrijving).length} met beschrijving`);

    // 2. OAuth token
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

    // 3. Alle cursussen ophalen
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

    // Delta bepalen
    const nieuweCursussen = allCourses.filter((c) => !bestaandMap.get(String(c.id))?.heeftEmbedding);
    // Cursussen zonder beschrijving — gesorteerd op course_id zodat we altijd de volgende batch pakken
    const zonderBeschrijving = allCourses
      .filter((c) => !bestaandMap.get(String(c.id))?.heeftBeschrijving)
      .sort((a, b) => a.id - b.id)
      .slice(0, MAX_BESCHRIJVING_PER_SYNC);

    console.log(`[Sync] ${nieuweCursussen.length} nieuwe cursussen (embedding nodig)`);
    console.log(`[Sync] ${zonderBeschrijving.length} cursussen zonder beschrijving in deze batch (van ${allCourses.filter(c => !bestaandMap.get(String(c.id))?.heeftBeschrijving).length} totaal)`);

    // 4. Embeddings voor nieuwe cursussen
    const embeddingMap = new Map<number, number[]>();
    let embeddingSucces = 0;

    if (openaiKey && nieuweCursussen.length > 0) {
      for (let i = 0; i < nieuweCursussen.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = nieuweCursussen.slice(i, i + EMBEDDING_BATCH_SIZE);
        try {
          const embRes = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "text-embedding-3-small", input: batch.map(c => c.name) }),
          });
          if (embRes.ok) {
            const embData = await embRes.json();
            for (let j = 0; j < batch.length; j++) {
              const emb = embData.data?.[j]?.embedding;
              if (emb && Array.isArray(emb)) { embeddingMap.set(batch[j].id, emb); embeddingSucces++; }
            }
          }
        } catch (e) { console.error(`[Sync] Embedding batch ${i} exception:`, e); }
      }
    }
    console.log(`[Sync] Embeddings: ${embeddingSucces} nieuwe`);

    // 5. Beschrijvingen voor deze batch
    const beschrijvingMap = new Map<number, string>();
    let beschrijvingSucces = 0;

    if (anthropicKey && zonderBeschrijving.length > 0) {
      for (let i = 0; i < zonderBeschrijving.length; i += BESCHRIJVING_BATCH_SIZE) {
        const batch = zonderBeschrijving.slice(i, i + BESCHRIJVING_BATCH_SIZE);
        const namenLijst = batch.map((c, idx) => `${idx + 1}. ${c.name}`).join("\n");
        try {
          const descRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 4096,
              messages: [{ role: "user", content: `Genereer voor elke training hieronder een korte beschrijving (max 15 woorden) met relevante zoekwoorden waar een zorgmedewerker op zou zoeken. Focus op: doelgroep, methodiek, vaardigheid, ziektebeeld. Gebruik Nederlandse zorgtermen en synoniemen.\n\nFormaat: één regel per training, genummerd.\nVoorbeeld:\n1. Omgaan met agressie, grensoverschrijdend gedrag, de-escalatie, veiligheid\n2. NAH niet-aangeboren hersenletsel, cognitieve beperkingen, revalidatie\n\nTrainingen:\n${namenLijst}` }],
            }),
          });
          if (descRes.ok) {
            const descData = await descRes.json();
            const tekst = descData.content?.[0]?.text || "";
            const regels = tekst.split("\n").filter((r: string) => r.trim().length > 0);
            for (const regel of regels) {
              const match = regel.match(/^(\d+)\.\s*(.+)/);
              if (match) {
                const idx = parseInt(match[1], 10) - 1;
                if (idx >= 0 && idx < batch.length) {
                  beschrijvingMap.set(batch[idx].id, match[2].trim());
                  beschrijvingSucces++;
                }
              }
            }
          } else {
            const errText = await descRes.text();
            console.error(`[Sync] Beschrijving batch ${i} HTTP ${descRes.status}: ${errText.substring(0, 300)}`);
          }
        } catch (e) { console.error(`[Sync] Beschrijving batch ${i} exception:`, e); }
      }
    }
    console.log(`[Sync] Beschrijvingen: ${beschrijvingSucces} aangemaakt voor deze batch`);

    // 6. Twee aparte upserts:
    // A) Alle cursussen: naam/duur/deeplink/timestamp bijwerken (ZONDER beschrijving en embedding te overschrijven)
    // B) Alleen cursussen met nieuwe data: embedding of beschrijving apart updaten

    // Stap A: Basis upsert voor alle cursussen (geen beschrijving/embedding in payload)
    const UPSERT_BATCH = 200;
    const basisRows = allCourses.map((c) => ({
      tenant_id: tenantId,
      studytube_course_id: String(c.id),
      naam: c.name,
      duur_minuten: c.duration ? Math.round(c.duration / 60) : null,
      deeplink_url: `${STUDYTUBE_DEEPLINK_BASE}/${c.id}`,
      trefwoorden: [],
      laatst_gesynchroniseerd: new Date().toISOString(),
    }));

    for (let i = 0; i < basisRows.length; i += UPSERT_BATCH) {
      const batch = basisRows.slice(i, i + UPSERT_BATCH);
      const { error: upsertErr } = await supabaseAdmin
        .from("studytube_cursussen")
        .upsert(batch, { onConflict: "tenant_id,studytube_course_id", ignoreDuplicates: false });
      if (upsertErr) {
        console.error(`[Sync] Basis upsert batch ${i} fout:`, upsertErr.message);
        return new Response(JSON.stringify({ error: "Upsert mislukt: " + upsertErr.message }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Stap B: Embeddings apart updaten (alleen nieuwe cursussen)
    for (const [courseId, embedding] of embeddingMap.entries()) {
      await supabaseAdmin
        .from("studytube_cursussen")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("tenant_id", tenantId)
        .eq("studytube_course_id", String(courseId));
    }

    // Stap C: Beschrijvingen apart updaten (alleen cursussen in deze batch)
    for (const [courseId, beschrijving] of beschrijvingMap.entries()) {
      await supabaseAdmin
        .from("studytube_cursussen")
        .update({ beschrijving })
        .eq("tenant_id", tenantId)
        .eq("studytube_course_id", String(courseId));
    }

    const totaalZonderBeschrijving = allCourses.filter((c) =>
      !beschrijvingMap.has(c.id) && !bestaandMap.get(String(c.id))?.heeftBeschrijving
    ).length;

    console.log(`[Sync] Klaar. Nog ${totaalZonderBeschrijving} zonder beschrijving.`);

    return new Response(
      JSON.stringify({
        cursussen_gesynchroniseerd: allCourses.length,
        nieuwe_cursussen: nieuweCursussen.length,
        embeddings_gegenereerd: embeddingSucces,
        beschrijvingen_gegenereerd: beschrijvingSucces,
        nog_zonder_beschrijving: totaalZonderBeschrijving,
        beschrijvingen_totaal: [...bestaandMap.values()].filter(v => v.heeftBeschrijving).length + beschrijvingSucces,
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
