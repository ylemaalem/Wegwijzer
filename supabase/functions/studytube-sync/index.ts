import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CLAUDE_MODEL, claudeTekst, claudeVerzoek } from "../_shared/claude.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const STUDYTUBE_OAUTH_URL = "https://backend.studytube.nl/gateway/oauth/token";
const STUDYTUBE_COURSES_URL = "https://public-api.studytube.nl/api/v2/courses";
const STUDYTUBE_DEEPLINK_BASE = "https://app.studytube.nl/nl/courses";

const EMBEDDING_BATCH_SIZE = 20;
const MAX_EMBEDDING_PER_SYNC = 100;
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
    // 1. Bestaande cursussen ophalen incl. beschrijving voor embedding input
    const { data: bestaandRows } = await supabaseAdmin
      .from("studytube_cursussen")
      .select("studytube_course_id, embedding, beschrijving")
      .eq("tenant_id", tenantId);

    const bestaandMap = new Map<string, { heeftEmbedding: boolean; heeftBeschrijving: boolean; beschrijving: string }>();
    for (const r of bestaandRows ?? []) {
      bestaandMap.set(String(r.studytube_course_id), {
        heeftEmbedding: !!r.embedding,
        heeftBeschrijving: r.beschrijving !== null && r.beschrijving !== undefined && r.beschrijving !== "",
        beschrijving: r.beschrijving || "",
      });
    }
    console.log(`[Sync] ${bestaandMap.size} cursussen al in DB, ${[...bestaandMap.values()].filter(v => v.heeftEmbedding).length} met embedding, ${[...bestaandMap.values()].filter(v => v.heeftBeschrijving).length} met beschrijving`);

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

    // Delta bepalen — max 100 embeddings per sync
    const alleZonderEmbedding = allCourses.filter((c) => !bestaandMap.get(String(c.id))?.heeftEmbedding);
    const teEmbeddenCursussen = alleZonderEmbedding.sort((a, b) => a.id - b.id).slice(0, MAX_EMBEDDING_PER_SYNC);

    // Cursussen zonder beschrijving — max 100 per sync
    const zonderBeschrijving = allCourses
      .filter((c) => !bestaandMap.get(String(c.id))?.heeftBeschrijving)
      .sort((a, b) => a.id - b.id)
      .slice(0, MAX_BESCHRIJVING_PER_SYNC);

    console.log(`[Sync] ${alleZonderEmbedding.length} totaal zonder embedding, ${teEmbeddenCursussen.length} in deze batch`);
    console.log(`[Sync] ${zonderBeschrijving.length} cursussen zonder beschrijving in deze batch`);

    // 4. Embeddings genereren op naam + beschrijving
    const embeddingMap = new Map<number, number[]>();
    let embeddingSucces = 0;

    if (openaiKey && teEmbeddenCursussen.length > 0) {
      for (let i = 0; i < teEmbeddenCursussen.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = teEmbeddenCursussen.slice(i, i + EMBEDDING_BATCH_SIZE);
        try {
          // Embedding input: naam + beschrijving (indien beschikbaar)
          const inputs = batch.map((c) => {
            const bestaand = bestaandMap.get(String(c.id));
            const beschrijving = bestaand?.beschrijving || "";
            return beschrijving ? `${c.name} ${beschrijving}` : c.name;
          });
          const embRes = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "text-embedding-3-small", input: inputs }),
          });
          if (embRes.ok) {
            const embData = await embRes.json();
            for (let j = 0; j < batch.length; j++) {
              const emb = embData.data?.[j]?.embedding;
              if (emb && Array.isArray(emb)) { embeddingMap.set(batch[j].id, emb); embeddingSucces++; }
            }
          } else {
            const errText = await embRes.text();
            console.error(`[Sync] Embedding batch ${i} HTTP ${embRes.status}: ${errText.substring(0, 200)}`);
          }
        } catch (e) { console.error(`[Sync] Embedding batch ${i} exception:`, e); }
      }
    }
    console.log(`[Sync] Embeddings: ${embeddingSucces} aangemaakt in deze batch`);

    // 5. Beschrijvingen genereren (indien nog cursussen zonder beschrijving)
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
            body: JSON.stringify(claudeVerzoek(CLAUDE_MODEL, "hulp", {
              model: CLAUDE_MODEL,
              max_tokens: 4096,
              messages: [{ role: "user", content: `Genereer voor elke training hieronder een korte beschrijving (max 15 woorden) met relevante zoekwoorden waar een zorgmedewerker op zou zoeken. Focus op: doelgroep, methodiek, vaardigheid, ziektebeeld. Gebruik Nederlandse zorgtermen en synoniemen.\n\nFormaat: één regel per training, genummerd.\nVoorbeeld:\n1. Omgaan met agressie, grensoverschrijdend gedrag, de-escalatie, veiligheid\n2. NAH niet-aangeboren hersenletsel, cognitieve beperkingen, revalidatie\n\nTrainingen:\n${namenLijst}` }],
            })),
          });
          if (descRes.ok) {
            const descData = await descRes.json();
            const tekst = claudeTekst(descData) || "";
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
    console.log(`[Sync] Beschrijvingen: ${beschrijvingSucces} aangemaakt in deze batch`);

    // 6. Basis upsert voor alle cursussen
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

    // 7. Embeddings apart updaten
    for (const [courseId, embedding] of embeddingMap.entries()) {
      await supabaseAdmin
        .from("studytube_cursussen")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("tenant_id", tenantId)
        .eq("studytube_course_id", String(courseId));
    }

    // 8. Beschrijvingen apart updaten
    for (const [courseId, beschrijving] of beschrijvingMap.entries()) {
      await supabaseAdmin
        .from("studytube_cursussen")
        .update({ beschrijving })
        .eq("tenant_id", tenantId)
        .eq("studytube_course_id", String(courseId));
    }

    const nogZonderEmbedding = alleZonderEmbedding.length - embeddingSucces;
    const nogZonderBeschrijving = allCourses.filter((c) =>
      !beschrijvingMap.has(c.id) && !bestaandMap.get(String(c.id))?.heeftBeschrijving
    ).length;

    console.log(`[Sync] Klaar. Nog ${nogZonderEmbedding} zonder embedding, ${nogZonderBeschrijving} zonder beschrijving.`);

    return new Response(
      JSON.stringify({
        cursussen_gesynchroniseerd: allCourses.length,
        embeddings_gegenereerd: embeddingSucces,
        nog_zonder_embedding: nogZonderEmbedding,
        beschrijvingen_gegenereerd: beschrijvingSucces,
        nog_zonder_beschrijving: nogZonderBeschrijving,
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
