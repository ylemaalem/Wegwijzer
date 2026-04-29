// =============================================
// WEGWIJZER — Edge Function: Chat met Claude Haiku
// =============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STOPWOORDEN = new Set([
  "de", "het", "een", "van", "voor", "met", "die", "dat", "zijn", "was",
  "niet", "ook", "maar", "dan", "hoe", "wat", "waar", "wie", "wel", "nog",
  "als", "bij", "aan", "uit", "door", "naar", "over", "tot", "kan", "zou",
  "mag", "wil", "moet", "mijn", "jouw", "hun", "dit", "deze", "wordt",
  "werd", "hebben", "heeft", "worden", "meer", "alle", "ander", "andere",
  "veel", "geen", "elk", "elke", "ons", "onze", "jullie", "hen", "hem",
  "haar", "zij", "wij", "ik", "je", "jij", "hij", "het", "men", "er",
]);

// Zorgwekkende onderwerpen voor patroonherkenning
const ZORGWEKKENDE_TERMEN = [
  "agressie", "agressief", "geweld", "slaan", "dreigen", "dreiging",
  "crisis", "crisisplan", "noodsituatie", "nood",
  "suicid", "suïcid", "zelfdoding", "zelfmoord", "levenseinde",
];

const WEBSITE_TRIGGERS = [
  "cao", "salaris", "loon", "trede",
  "schaal", "inschaling", "functiegroep",
  "arbeidsvoorwaard", "vakantiegeld",
  "pensioen", "verlof", "vergoeding",
  "reiskosten", "kilometer", "onkost",
  "uitkering", "ww", "ziektewet",
  "contract", "proeftijd", "ontslag"
];

console.log("[Terugblik] Resend configured:", !!Deno.env.get("RESEND_API_KEY"));

// HTML email builder voor de maandelijkse terugblik
function buildTerugblikHtml(
  naam: string, maand: string, team: string,
  totaalVragen: number, positief: number, negatief: number, pct: number,
  actiefMedewerkers: number, totaalMedewerkers: number,
  tijdBespaard: number, kostenBespaard: number
): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff">
  <tr><td style="background:#0D5C6B;padding:24px 32px">
    <h1 style="margin:0;color:#ffffff;font-size:22px">Wegwijzer Terugblik</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">${maand} — ${team}</p>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 18px;font-size:15px;color:#333">Beste ${naam},</p>
    <p style="margin:0 0 22px;font-size:15px;color:#333;line-height:1.6">
      Hier is de Wegwijzer terugblik voor <strong>${maand}</strong> — team <strong>${team}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr style="background:#f8f8f8">
        <td style="padding:12px 16px;font-size:14px;color:#666;border-bottom:1px solid #e0e0e0">Totaal vragen gesteld</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#333;text-align:right;border-bottom:1px solid #e0e0e0">${totaalVragen}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:14px;color:#666;border-bottom:1px solid #e0e0e0">Positieve feedback</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#2e7d32;text-align:right;border-bottom:1px solid #e0e0e0">${positief} (${pct}%)</td>
      </tr>
      <tr style="background:#f8f8f8">
        <td style="padding:12px 16px;font-size:14px;color:#666;border-bottom:1px solid #e0e0e0">Negatieve feedback</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#c62828;text-align:right;border-bottom:1px solid #e0e0e0">${negatief}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:14px;color:#666;border-bottom:1px solid #e0e0e0">Actieve medewerkers</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#333;text-align:right;border-bottom:1px solid #e0e0e0">${actiefMedewerkers} van ${totaalMedewerkers}</td>
      </tr>
      <tr style="background:#f8f8f8">
        <td style="padding:12px 16px;font-size:14px;color:#666">Tijdwinst leidinggevende</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0D5C6B;text-align:right">~${tijdBespaard} uur (~&euro;${kostenBespaard} bespaard)</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#999;line-height:1.5">
      Met vriendelijke groet,<br><strong>Wegwijzer</strong>
    </p>
  </td></tr>
  <tr><td style="background:#f4f4f4;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#999">Deze email is automatisch verstuurd door Wegwijzer.</p>
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("[Edge] === Request ontvangen ===");

    // ---- 1. Authenticatie ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Niet geautoriseerd" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    console.log("[Edge] Env vars: URL=", supabaseUrl ? "OK" : "MISSING", "ServiceKey=", supabaseServiceKey ? "OK (" + supabaseServiceKey.substring(0, 10) + "...)" : "MISSING", "AnthropicKey=", anthropicApiKey ? "OK" : "MISSING");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ---- 2. Gebruiker verifiëren ----
    console.log("[Edge] Stap 2: getUser...");
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("[Edge] getUser fout:", userError?.message);
      return new Response(
        JSON.stringify({ error: "Sessie verlopen. Log opnieuw in." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("[Edge] Stap 2 OK: user=", user.email);

    // ---- 3. Profiel ophalen ----
    console.log("[Edge] Stap 3: profiel ophalen...");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[Edge] Profiel niet gevonden:", profileError?.message, "code:", profileError?.code);
      return new Response(
        JSON.stringify({ error: "Profiel niet gevonden: " + (profileError?.message || "geen profiel") }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("[Edge] Stap 3 OK: profiel=", profile.naam, "rol=", profile.role, "tenant=", profile.tenant_id);

    // Check tijdelijk account verlopen
    if (profile.account_type === "tijdelijk" && profile.einddatum) {
      const eind = new Date(profile.einddatum);
      if (new Date() > eind) {
        return new Response(
          JSON.stringify({ error: "Je account is verlopen. Neem contact op met je leidinggevende." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- 4. Request body ----
    const body = await req.json();
    const { vraag, functiegroep, weeknummer, extend_limit, messages: clientMessages } = body;

    // ---- Kennissuggesties scan (snel of grondig, admin only) ----
    if (body.kennis_scan && (body.scan_type === "snel" || body.scan_type === "grondig")) {
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Alleen admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const scanType = body.scan_type;

      // Haal alle documenten op
      let docsQuery = supabaseAdmin
        .from("documents")
        .select("id, naam, content, map")
        .eq("tenant_id", profile.tenant_id)
        .is("user_id", null);

      const { data: alleDocs } = await docsQuery;

      // Filter op geselecteerde mappen voor grondige scan
      let scanDocs = alleDocs || [];
      if (scanType === "grondig" && Array.isArray(body.mappen) && body.mappen.length > 0) {
        scanDocs = scanDocs.filter((d: { map: string | null }) => body.mappen.includes(d.map || "Overig"));
      }

      // Vraagpatronen ophalen (laatste 30 dagen voor snel, 90 voor grondig)
      const dagen = scanType === "snel" ? 30 : 90;
      const sinds = new Date(Date.now() - dagen * 24 * 60 * 60 * 1000).toISOString();
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("vraag, feedback")
        .eq("tenant_id", profile.tenant_id)
        .gte("created_at", sinds);

      // Verzamel vragen
      const vraagLijst = (convs || []).map((c: { vraag: string }) => c.vraag).slice(0, 200);
      const documentNamen = scanDocs.map((d: { naam: string }) => d.naam).join(", ");

      let scanPrompt = "";
      if (scanType === "snel") {
        scanPrompt = `Je bent een kennisbank-analist voor een ambulante zorgorganisatie. Analyseer de volgende informatie en identificeer:

1. ONTBREKENDE DOCUMENTEN: Welke standaard documenten voor een ambulante zorgorganisatie ontbreken? (denk aan: agressieprotocol, incidentmelding, reiskosten, zorgplan, WMO-procedure, inwerkschema, functieomschrijvingen, CAO-arbeidsvoorwaarden)
2. HIATEN UIT VRAAGPATRONEN: Welke onderwerpen worden vaak gevraagd maar ontbreken in de documentnamen?

DOCUMENTNAMEN IN KENNISBANK (${scanDocs.length}):
${documentNamen}

VEELGESTELDE VRAGEN (${vraagLijst.length}):
${vraagLijst.slice(0, 50).join("\n")}

OMSCHRIJVING FORMAT — Genereer per hiaat een omschrijving die EXACT dit format volgt, met dubbele \\n als regelscheider:

  {Korte titel van max 60 tekens, geen punt aan eind}

  UITLEG: Medewerkers stelden vragen over [onderwerp] maar de kennisbank heeft hier geen volledig antwoord op. [Documentnaam] raakt dit onderwerp maar dekt het niet volledig. (2-3 zinnen)

  AANBEVELING: Voeg een specifiek document toe over [onderwerp] of markeer als niet relevant als de huidige informatie voldoende is.

VOORBEELD omschrijving:
"Ziekteverlof registratie richtlijnen\\n\\nUITLEG: Medewerkers stelden vragen over hoe ziekteverlof geregistreerd wordt in ONS maar de bestaande documenten geven hier geen volledig antwoord op. De Procedure ziekteverlof raakt dit onderwerp maar dekt het registratieproces niet.\\n\\nAANBEVELING: Voeg een specifieke registratie-instructie toe of markeer als niet relevant als de huidige informatie voldoende is."

Vul document_a met de naam van het document dat het onderwerp het dichtst raakt (mag null zijn).

Geef een JSON array terug met dit formaat (max 10 items, alleen relevant):
[
  {"type": "hiaat", "omschrijving": "Titel\\n\\nUITLEG: ...\\n\\nAANBEVELING: ...", "document_a": null, "document_b": null}
]
Geen uitleg, alleen JSON.`;
      } else {
        const docContexts = scanDocs.slice(0, 30).map((d: { naam: string; content: string }) =>
          `--- ${d.naam} ---\n${(d.content || "").substring(0, 1500)}`
        ).join("\n\n");
        scanPrompt = `Je bent een kennisbank-analist voor een ambulante zorgorganisatie. Analyseer de volgende documenten en vraagpatronen en identificeer:

1. CONFLICTEN: Documenten die elkaar tegenspreken (verschillende bedragen, procedures, regels)
2. HIATEN: Ontbrekende documenten (sectorstandaard + uit vraagpatronen)
3. SUGGESTIES: Documenten die naar onderwerpen verwijzen waar geen apart document over bestaat

DOCUMENTEN (${scanDocs.length} totaal, eerste 30 getoond):
${docContexts}

VEELGESTELDE VRAGEN (${vraagLijst.length}):
${vraagLijst.slice(0, 30).join("\n")}

OMSCHRIJVING FORMAT — Genereer per item een omschrijving die EXACT dit format volgt, met dubbele \\n als regelscheider:

  {Korte titel van max 60 tekens, geen punt aan eind}

  UITLEG: {2-3 zinnen die uitleggen wat er aan de hand is en waarom dit relevant is voor medewerkers}

  AANBEVELING: {1 concrete vervolgactie voor de admin}

VOORBEELDEN per type:

CONFLICT — gebruik dit format:
"Verschillende reiskostenbedragen tussen documenten\\n\\nUITLEG: Document Reiskosten 2024 en Document Reiskosten beleid geven verschillende informatie over de kilometervergoeding. Reiskosten 2024 noemt €0,23 per km, Reiskosten beleid noemt €0,21 per km. Medewerkers weten hierdoor niet welke vergoeding actueel is.\\n\\nAANBEVELING: Controleer welke versie actueel is en verwijder of update het verouderde document."

HIAAT — gebruik dit format:
"Agressieprotocol ontbreekt\\n\\nUITLEG: Een agressieprotocol is standaard voor ambulante zorgorganisaties maar ontbreekt in de kennisbank. Medewerkers hebben houvast nodig bij omgaan met agressie van cliënten of derden, en een protocol beschermt zowel medewerker als organisatie.\\n\\nAANBEVELING: Voeg een agressieprotocol toe of markeer als niet relevant als dit elders is geregeld."

SUGGESTIE — gebruik dit format:
"Verwijzing naar verzuimbeleid maar geen apart document\\n\\nUITLEG: Document Personeelshandboek verwijst naar het verzuimbeleid maar er is geen apart document over verzuimbeleid in de kennisbank. Dit onderwerp wordt mogelijk vaker gevraagd door medewerkers die specifieke informatie zoeken.\\n\\nAANBEVELING: Overweeg een document toe te voegen als dit regelmatig ter sprake komt."

Vul document_a en document_b met de exacte documentnamen waar van toepassing.

Geef een JSON array terug met dit formaat (max 20 items, alleen relevant):
[
  {"type": "conflict", "omschrijving": "Titel\\n\\nUITLEG: ...\\n\\nAANBEVELING: ...", "document_a": "naam_a.pdf", "document_b": "naam_b.pdf"},
  {"type": "hiaat", "omschrijving": "Titel\\n\\nUITLEG: ...\\n\\nAANBEVELING: ...", "document_a": null, "document_b": null},
  {"type": "suggestie", "omschrijving": "Titel\\n\\nUITLEG: ...\\n\\nAANBEVELING: ...", "document_a": "x.pdf", "document_b": null}
]
Geen uitleg, alleen JSON.`;
      }

      try {
        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: scanType === "grondig" ? 4096 : 2048,
            messages: [{ role: "user", content: scanPrompt }],
          }),
        });

        if (!aiResp.ok) {
          return new Response(
            JSON.stringify({ error: "Claude API fout" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const aiJson = await aiResp.json();
        let raw = aiJson.content?.[0]?.text || "[]";
        console.log("[KennisScan] Raw response:", raw.substring(0, 500));

        // Strip markdown code blocks (openings- en sluit-fences kunnen overal staan)
        raw = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

        // Extraheer array: eerste [ tot laatste ]
        const startIdx = raw.indexOf("[");
        const endIdx = raw.lastIndexOf("]");
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          raw = raw.substring(startIdx, endIdx + 1);
        }

        let suggesties: Array<{ type: string; omschrijving: string; document_a?: string | null; document_b?: string | null }> = [];
        try {
          suggesties = JSON.parse(raw);
        } catch (e) {
          console.error("[KennisScan] Parse fout:", raw.substring(0, 200));
          suggesties = [];
        }

        if (!Array.isArray(suggesties)) suggesties = [];

        // Geen suggesties gevonden → geen fout, alleen een lege telling.
        if (suggesties.length === 0) {
          console.log(`[KennisScan] ${scanType}: 0 suggesties (leeg na parse)`);
          return new Response(
            JSON.stringify({ success: true, count: 0, scan_type: scanType }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let inserted = 0;
        for (const s of suggesties) {
          if (!s.type || !s.omschrijving) continue;
          if (!["conflict", "hiaat", "suggestie"].includes(s.type)) continue;
          await supabaseAdmin.from("kennissuggesties").insert({
            tenant_id: profile.tenant_id,
            type: s.type,
            omschrijving: s.omschrijving,
            document_a: s.document_a || null,
            document_b: s.document_b || null,
            scan_type: scanType,
          });
          inserted++;
        }

        console.log(`[KennisScan] ${scanType}: ${inserted} suggesties opgeslagen`);

        return new Response(
          JSON.stringify({ success: true, count: inserted, scan_type: scanType }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[KennisScan] Exception:", err);
        return new Response(
          JSON.stringify({ error: String(err) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Zoektermen genereren voor een document (admin only) ----
    if (body.generate_zoektermen && body.document_id) {
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Alleen admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: doc } = await supabaseAdmin
        .from("documents")
        .select("id, naam, content, tenant_id")
        .eq("id", body.document_id)
        .eq("tenant_id", profile.tenant_id)
        .single();

      if (!doc || !doc.content) {
        return new Response(
          JSON.stringify({ error: "Document niet gevonden of geen content" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `Analyseer dit document en genereer 30 zoektermen in het Nederlands die mensen zouden gebruiken om dit document te vinden.
Denk aan synoniemen, afkortingen, gerelateerde begrippen, informele namen en variaties op de documenttitel.

Geef ALLEEN een JSON array terug met 30 strings. Geen uitleg, geen opmaak, geen markdown.

Document titel: ${doc.naam}
Document inhoud: ${(doc.content as string).substring(0, 3000)}`;

      try {
        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!aiResp.ok) {
          return new Response(
            JSON.stringify({ error: "Claude API fout" }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const aiJson = await aiResp.json();
        let raw = aiJson.content?.[0]?.text || "[]";
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) raw = match[0];

        let zoektermen: string[] = [];
        try {
          zoektermen = JSON.parse(raw);
        } catch {
          console.error("[Zoektermen] JSON parse fout, raw:", raw.substring(0, 200));
          zoektermen = [];
        }

        if (!Array.isArray(zoektermen) || zoektermen.length === 0) {
          return new Response(
            JSON.stringify({ error: "Geen zoektermen kunnen genereren" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        zoektermen = zoektermen
          .filter((t: unknown) => typeof t === "string" && (t as string).trim().length > 0)
          .map((t: string) => t.trim().toLowerCase())
          .slice(0, 50);

        await supabaseAdmin
          .from("documents")
          .update({ zoektermen })
          .eq("id", doc.id);

        console.log(`[Zoektermen] Gegenereerd: ${zoektermen.length} voor: ${doc.naam}`);

        return new Response(
          JSON.stringify({ success: true, count: zoektermen.length, zoektermen }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Zoektermen] Exception:", err);
        return new Response(
          JSON.stringify({ error: String(err) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Admin: website crawl ----
    // Fetcht de hoofdpagina, extracteert interne links, fetcht max 50
    // subpagina's, slaat elk op als is_crawled_page document met zoektermen.
    if (body.crawl_website && body.url) {
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Alleen admin" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const startUrl: string = body.url;
      if (!startUrl.startsWith("https://")) {
        return new Response(
          JSON.stringify({ error: "URL moet beginnen met https://" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tenantIdForCrawl = profile.tenant_id;
      const startStartTime = Date.now();
      const TOTAL_TIMEOUT_MS = 55_000;
      const PAGE_TIMEOUT_MS = 10_000;
      const MAX_PAGES = 50;
      const MIN_TEXT = 200;

      function fetchWithTimeout(u: string, ms: number) {
        return Promise.race([
          fetch(u, { headers: { "User-Agent": "WegwijzerCrawler/1.0" } }),
          new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
        ]);
      }

      function stripHtmlToText(html: string): { titel: string; tekst: string } {
        const titelMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const titel = titelMatch ? titelMatch[1].replace(/\s+/g, " ").trim() : "";
        const noScript = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
        const tekst = noScript
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
        return { titel: titel || "(zonder titel)", tekst };
      }

      function extractLinks(html: string, base: URL, disallow: string[]): string[] {
        const matches = Array.from(html.matchAll(/href=["']([^"'#]+)["']/gi));
        const set = new Set<string>();
        for (const m of matches) {
          let href = m[1].trim();
          if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
          // Skip PDFs en andere binaries
          if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp3|mp4|doc|docx|xls|xlsx)(\?|$)/i.test(href)) continue;
          // Skip login/zoek
          if (/\/(login|signin|inloggen|search|zoek)(\/|\?|$)/i.test(href)) continue;
          // Strip querystring + anchor (anchor al weg via regex)
          const qIndex = href.indexOf("?");
          if (qIndex !== -1) href = href.substring(0, qIndex);
          try {
            const abs = new URL(href, base);
            if (abs.hostname !== base.hostname) continue;
            if (disallow.some((d) => abs.pathname.startsWith(d))) continue;
            set.add(abs.toString());
          } catch { /* ongeldige URL, skip */ }
        }
        return Array.from(set);
      }

      const baseUrl = new URL(startUrl);

      // robots.txt ophalen
      const disallow: string[] = [];
      try {
        const robotsResp = await fetchWithTimeout(baseUrl.origin + "/robots.txt", 5000);
        if (robotsResp.ok) {
          const robotsText = await robotsResp.text();
          let inGlobalAgent = false;
          for (const line of robotsText.split("\n")) {
            const lineTrim = line.trim();
            if (/^user-agent:\s*\*/i.test(lineTrim)) inGlobalAgent = true;
            else if (/^user-agent:/i.test(lineTrim)) inGlobalAgent = false;
            else if (inGlobalAgent && /^disallow:/i.test(lineTrim)) {
              const p = lineTrim.replace(/^disallow:\s*/i, "").trim();
              if (p) disallow.push(p);
            }
          }
        }
      } catch { /* geen robots.txt — toegestaan */ }

      // Hoofdpagina fetchen + links extracten
      let geslaagd = 0;
      let mislukt = 0;
      const verwerktePaginas: string[] = [];
      const fouten: string[] = [];

      try {
        const hoofdResp = await fetchWithTimeout(startUrl, PAGE_TIMEOUT_MS);
        if (!hoofdResp.ok) {
          return new Response(
            JSON.stringify({ error: `Hoofdpagina ${hoofdResp.status}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const hoofdHtml = await hoofdResp.text();
        const links = [startUrl, ...extractLinks(hoofdHtml, baseUrl, disallow)].slice(0, MAX_PAGES);
        const uniekeLinks = Array.from(new Set(links));
        console.log("[Crawl]", uniekeLinks.length, "unieke links voor", startUrl);

        for (const link of uniekeLinks) {
          if (Date.now() - startStartTime > TOTAL_TIMEOUT_MS) {
            console.log("[Crawl] Timeout na", verwerktePaginas.length, "pagina's");
            break;
          }
          try {
            const resp = await fetchWithTimeout(link, PAGE_TIMEOUT_MS);
            if (!resp.ok) { mislukt++; continue; }
            const html = await resp.text();
            const { titel, tekst } = stripHtmlToText(html);
            if (tekst.length < MIN_TEXT) { mislukt++; continue; }

            // Insert document
            const { data: docInserted } = await supabaseAdmin
              .from("documents")
              .insert({
                tenant_id: tenantIdForCrawl,
                naam: titel.substring(0, 200),
                bestandspad: "",
                content: tekst.substring(0, 50_000),
                documenttype: "overig",
                parent_url: startUrl,
                crawled_at: new Date().toISOString(),
                is_crawled_page: true,
              })
              .select("id")
              .single();

            // Zoektermen genereren via Claude Haiku — best-effort
            if (docInserted && (docInserted as { id: string }).id) {
              try {
                const ztResp = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": anthropicApiKey,
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 512,
                    messages: [{ role: "user", content: `Genereer 20 zoektermen in het Nederlands voor dit document. Geef ALLEEN een JSON array, geen uitleg.\n\nTitel: ${titel}\nInhoud: ${tekst.substring(0, 1500)}` }],
                  }),
                });
                if (ztResp.ok) {
                  const ztJson = await ztResp.json();
                  let zRaw = ztJson.content?.[0]?.text || "[]";
                  zRaw = zRaw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
                  const sIdx = zRaw.indexOf("[");
                  const eIdx = zRaw.lastIndexOf("]");
                  if (sIdx !== -1 && eIdx !== -1) zRaw = zRaw.substring(sIdx, eIdx + 1);
                  let zt: unknown[] = [];
                  try { zt = JSON.parse(zRaw); } catch { /* skip */ }
                  if (Array.isArray(zt)) {
                    const finaleZt = zt
                      .filter((t) => typeof t === "string" && (t as string).trim().length > 0)
                      .map((t) => (t as string).trim().toLowerCase())
                      .slice(0, 30);
                    await supabaseAdmin.from("documents").update({ zoektermen: finaleZt }).eq("id", (docInserted as { id: string }).id);
                  }
                }
              } catch { /* zoektermen mislukt — geen blocker */ }
            }

            verwerktePaginas.push(titel);
            geslaagd++;
          } catch (pageErr) {
            mislukt++;
            fouten.push(link + ": " + String(pageErr));
          }
        }
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Crawl mislukt: " + String(err), geslaagd, mislukt }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[Crawl] klaar:", geslaagd, "geslaagd,", mislukt, "mislukt");

      return new Response(
        JSON.stringify({ geslaagd, mislukt, paginas: verwerktePaginas, fouten: fouten.slice(0, 10) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Teamleider: team medewerkers ophalen (via service role, omzeilt RLS) ----
    if (body.get_team_medewerkers) {
      if (profile.role !== "teamleider" && profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Geen toegang" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: medewerkers, error: teamError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .eq("role", "medewerker");

      console.log("[Edge] get_team_medewerkers: tenant=", profile.tenant_id, "totaal=", medewerkers?.length, "error=", teamError?.message || "geen");

      if (teamError) {
        return new Response(
          JSON.stringify({ error: teamError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ medewerkers: medewerkers || [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Teamleider: naam ontsluiten bij melding ----
    // Verifieert: aanvrager is teamleider, melding hoort bij eigen team,
    // medewerker zit in team van de teamleider. Logt elke ontsluiting.
    if (body.ontsluit_naam && body.melding_id) {
      if (profile.role !== "teamleider") {
        return new Response(
          JSON.stringify({ error: "Alleen teamleiders kunnen namen ontsluiten" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Teamleider eigen teams ophalen via teamleiders-tabel
      const { data: tlRow } = await supabaseAdmin
        .from("teamleiders")
        .select("teams")
        .eq("tenant_id", profile.tenant_id)
        .eq("email", user.email)
        .maybeSingle();
      const tlTeams: string[] = (tlRow as { teams: string[] | null } | null)?.teams || [];
      if (tlTeams.length === 0) {
        return new Response(
          JSON.stringify({ error: "Je hebt geen teams toegewezen — naam ontsluiting niet mogelijk" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Melding ophalen
      const { data: melding } = await supabaseAdmin
        .from("meldingen")
        .select("id, tenant_id, team, medewerker_profile_id")
        .eq("id", body.melding_id)
        .maybeSingle();
      if (!melding) {
        return new Response(JSON.stringify({ error: "Melding niet gevonden" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if ((melding as { tenant_id: string }).tenant_id !== profile.tenant_id) {
        return new Response(JSON.stringify({ error: "Geen toegang tot deze melding" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const meldingTeam = (melding as { team: string | null }).team;
      if (!meldingTeam || tlTeams.indexOf(meldingTeam) === -1) {
        return new Response(JSON.stringify({ error: "Deze melding hoort niet bij een team waar jij teamleider van bent" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const medewerkerProfileId = (melding as { medewerker_profile_id: string | null }).medewerker_profile_id;
      if (!medewerkerProfileId) {
        return new Response(JSON.stringify({ error: "Aan deze melding is geen medewerker gekoppeld" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Medewerker ophalen + verifieer team-overlap
      const { data: medewerker } = await supabaseAdmin
        .from("profiles")
        .select("id, naam, teams, tenant_id")
        .eq("id", medewerkerProfileId)
        .maybeSingle();
      if (!medewerker || (medewerker as { tenant_id: string }).tenant_id !== profile.tenant_id) {
        return new Response(JSON.stringify({ error: "Medewerker niet gevonden" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const medewerkerTeams: string[] = (medewerker as { teams: string[] | null }).teams || [];
      const heeftOverlap = medewerkerTeams.some((t) => tlTeams.indexOf(t) !== -1);
      if (!heeftOverlap) {
        return new Response(JSON.stringify({ error: "Deze medewerker zit niet in jouw team" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const medewerkerNaam = (medewerker as { naam: string | null }).naam || "(onbekend)";

      // Logging — service_role bypasst RLS
      await supabaseAdmin.from("incident_naam_ontsluiting").insert({
        tenant_id: profile.tenant_id,
        teamleider_id: profile.id,
        melding_id: body.melding_id,
        medewerker_naam: medewerkerNaam,
      });
      console.log("[Ontsluit naam] Teamleider", profile.naam, "ontsloot naam van", medewerkerNaam, "voor melding", body.melding_id);

      return new Response(
        JSON.stringify({ naam: medewerkerNaam }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Teamleider: trendanalyse op anonieme vraaglijst ----
    if (body.generate_trendanalyse === true) {
      if (profile.role !== "teamleider" && profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Alleen teamleiders" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const vragen: string[] = Array.isArray(body.vragen)
        ? body.vragen.filter((v: unknown) => typeof v === "string" && v.trim().length > 0)
        : [];

      if (vragen.length === 0) {
        return new Response(
          JSON.stringify({ trendanalyse: "Er zijn de afgelopen 30 dagen geen vragen gesteld binnen jouw team. Zodra medewerkers vragen stellen verschijnt hier een trendanalyse." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const gebruikteVragen = vragen.slice(0, 200);
      const vraagLijst = gebruikteVragen.map((v, i) => `${i + 1}. ${v}`).join("\n");

      const trendPrompt = `Analyseer deze lijst vragen van een zorgteam en geef een overzicht van:
1) De meest gestelde onderwerpen (top 5).
2) Onderwerpen waar medewerkers moeite mee lijken te hebben.
3) Één concrete aanbeveling voor de leidinggevende.

Wees bondig, maximaal 200 woorden. Nederlands.

Vragen (${gebruikteVragen.length}):
${vraagLijst}`;

      try {
        const trendResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 600,
            messages: [{ role: "user", content: trendPrompt }],
          }),
        });
        const trendResult = await trendResp.json();
        const tekst = trendResult.content?.[0]?.text || "";

        let savedRapport: Record<string, unknown> | null = null;
        if (tekst.trim().length > 0) {
          const { data: inserted, error: insertErr } = await supabaseAdmin
            .from("trendanalyse_rapporten")
            .insert({
              tenant_id: profile.tenant_id,
              teamleider_id: profile.id,
              tekst: tekst,
            })
            .select("id, tekst, aangemaakt_op")
            .single();
          if (insertErr) {
            console.error("[Trendanalyse] DB insert fout:", insertErr.message);
          } else {
            savedRapport = inserted;
          }
        }

        return new Response(
          JSON.stringify({ trendanalyse: tekst, rapport: savedRapport }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Trendanalyse] Fout:", err);
        return new Response(
          JSON.stringify({ error: "Trendanalyse genereren mislukt." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- 5. Rate limiting per rol ----
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().split("T")[0];
    const basisLimiet = (profile as Record<string, unknown>).vraag_limiet as number || 30;
    const extraVragen = (profile as Record<string, unknown>).extra_vragen as number || 20;
    const hardLimiet = basisLimiet + extraVragen;

    if (profile.role !== "admin") {
      const { count: todayCount } = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .gte("created_at", todayStart.toISOString());

      const count = todayCount || 0;

      const { data: extension } = await supabaseAdmin
        .from("rate_extensions")
        .select("id")
        .eq("profile_id", profile.id)
        .eq("datum", todayStr)
        .limit(1);

      const hasExtension = extension && extension.length > 0;

      if (count >= hardLimiet) {
        return new Response(
          JSON.stringify({ error: "Je hebt het maximale aantal vragen voor vandaag bereikt. Morgen kun je weer vragen stellen.", rate_limited: true, hard_limit: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (count >= basisLimiet && !hasExtension && extraVragen > 0) {
        return new Response(
          JSON.stringify({ error: `Je hebt je dagelijkse ${basisLimiet} vragen gebruikt. Wil je vandaag nog ${extraVragen} extra vragen gebruiken?`, rate_limited: true, soft_limit: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Gebruiker uitnodigen ----
    if (body.invite_user && body.invite_email) {
      console.log("[Edge] >>> INVITE_USER verzoek ontvangen voor:", body.invite_email);
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Niet geautoriseerd" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const inviteEmail = body.invite_email;
      const inviteNaam = body.invite_naam || "";
      const inviteRole = body.invite_role || "teamleider";
      const inviteFunctiegroep = body.invite_functiegroep || null;
      const redirectUrl = body.redirect_url || "https://app.mijnwegwijzer.com/wachtwoord-instellen.html";

      try {
        const userData: Record<string, unknown> = {
          role: inviteRole,
          naam: inviteNaam,
          tenant_id: profile.tenant_id,
        };
        if (inviteFunctiegroep) userData.functiegroep = inviteFunctiegroep;

        const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(inviteEmail, {
          data: userData,
          redirectTo: redirectUrl,
        });

        if (inviteError) {
          console.error("[Invite] Fout:", JSON.stringify(inviteError));
          return new Response(
            JSON.stringify({ error: inviteError.message || "Onbekende fout bij uitnodiging", invited: false }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ invited: true, user_id: inviteData?.user?.id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Invite] Exception:", err);
        return new Response(
          JSON.stringify({ error: "Uitnodiging mislukt", invited: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Uitnodiging opnieuw sturen ----
    if (body.resend_invite && body.invite_email) {
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Niet geautoriseerd" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const resendEmail = body.invite_email;
      const resendNaam = body.invite_naam || "";
      const resendRedirect = body.redirect_url || "https://app.mijnwegwijzer.com/wachtwoord-instellen.html";

      try {
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find((u: { email: string }) => u.email === resendEmail);

        if (existingUser) {
          const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: "recovery",
            email: resendEmail,
            options: { redirectTo: resendRedirect || undefined },
          });

          if (linkError) {
            return new Response(
              JSON.stringify({ error: linkError.message }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, message: "Wachtwoord-reset mail verstuurd" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          const { data: invData, error: invError } = await supabaseAdmin.auth.admin.inviteUserByEmail(resendEmail, {
            data: { role: "teamleider", naam: resendNaam, tenant_id: profile.tenant_id },
            redirectTo: resendRedirect || undefined,
          });

          if (invError) {
            return new Response(
              JSON.stringify({ error: invError.message }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, message: "Uitnodigingsmail verstuurd" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (err) {
        console.error("[Resend] Exception:", err);
        return new Response(
          JSON.stringify({ error: "Versturen mislukt" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Weekstart briefing genereren ----
    if (body.generate_briefing && body.week_nummer) {
      const wk = body.week_nummer;
      const fg = profile.functiegroep || "medewerker";

      const { data: bestaand } = await supabaseAdmin
        .from("weekstart_briefings")
        .select("briefing_tekst")
        .eq("user_id", user.id)
        .eq("week_nummer", wk)
        .limit(1);

      if (bestaand && bestaand.length > 0) {
        return new Response(
          JSON.stringify({ briefing: bestaand[0].briefing_tekst, cached: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("naam, content")
        .eq("tenant_id", profile.tenant_id)
        .is("user_id", null)
        .not("content", "is", null)
        .limit(10);

      let docContext = "";
      if (docs && docs.length > 0) {
        const searchTerm = ("week " + wk + " " + fg.replace(/_/g, " ")).toLowerCase();
        const scored = docs.map((d: {naam: string; content: string}) => {
          const lower = (d.content + " " + d.naam).toLowerCase();
          let score = 0;
          searchTerm.split(/\s+/).forEach((w: string) => { if (w.length > 2 && lower.indexOf(w) !== -1) score++; });
          return { ...d, score };
        }).sort((a: {score:number}, b: {score:number}) => b.score - a.score).slice(0, 3);
        docContext = scored.map((d: {naam:string; content:string}) => "--- " + d.naam + " ---\n" + d.content.substring(0, 3000)).join("\n\n");
      }

      try {
        const briefResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            messages: [{ role: "user", content: `Je bent een inwerkcoach voor een zorgmedewerker. Week: ${wk}. Functiegroep: ${fg.replace(/_/g, " ")}. Gebruik de onderstaande documenten om concrete focuspunten te benoemen voor deze week. Wees kort, warm en praktisch. Maximaal 4 zinnen. Begin met: 'Goedemorgen, je bent nu in week ${wk} van je inwerktraject.'\n\n${docContext || "Geen documenten beschikbaar."}` }],
          }),
        });
        const briefResult = await briefResp.json();
        const briefText = briefResult.content?.[0]?.text || "Welkom in week " + wk + "!";
        await supabaseAdmin.from("weekstart_briefings").insert({ user_id: user.id, week_nummer: wk, briefing_tekst: briefText });
        return new Response(JSON.stringify({ briefing: briefText, cached: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        console.error("[Briefing] Fout:", err);
        return new Response(JSON.stringify({ briefing: "Welkom in week " + wk + "! Succes deze week.", cached: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- Kennisquiz genereren ----
    if (body.generate_quiz && body.week_nummer) {
      const wk = body.week_nummer;
      const fg = profile.functiegroep || "medewerker";
      const niveaus: Record<number, string> = {
        2: "Basis — herkenningsvragen (wat is...?, welke...?)",
        3: "Gemiddeld — situatievragen (wat doe je als...?)",
        4: "Gevorderd — toepassingsvragen over procedures",
        5: "Integratie — combinatievragen over meerdere onderwerpen"
      };
      const niveau = niveaus[wk] || "Gemiddeld";

      let vragenContext = "";
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: recenteVragen } = await supabaseAdmin.from("conversations").select("vraag").eq("user_id", profile.id).gte("created_at", sevenDaysAgo.toISOString()).order("created_at", { ascending: false }).limit(15);
        if (recenteVragen && recenteVragen.length > 0) {
          vragenContext = "VRAGEN DIE DEZE MEDEWERKER DEZE WEEK STELDE:\n" + recenteVragen.map((v: { vraag: string }, i: number) => (i + 1) + ". " + v.vraag).join("\n");
        }
      } catch (err) { console.error("[Quiz] Vragen ophalen mislukt:", err); }

      let docContext = "";
      try {
        const { data: docs } = await supabaseAdmin.from("documents").select("naam, content").eq("tenant_id", profile.tenant_id).is("user_id", null).not("content", "is", null).limit(20);
        if (docs && docs.length > 0) {
          const searchTerm = ("week " + wk + " " + fg.replace(/_/g, " ")).toLowerCase();
          const scored = docs.map((d: { naam: string; content: string }) => {
            const lower = (d.content + " " + d.naam).toLowerCase();
            let score = 0;
            searchTerm.split(/\s+/).forEach((w: string) => { if (w.length > 2 && lower.indexOf(w) !== -1) score++; });
            return { ...d, score };
          }).sort((a: { score: number }, b: { score: number }) => b.score - a.score).slice(0, 3);
          docContext = "RELEVANTE KENNISBANK DOCUMENTEN:\n" + scored.map((d: { naam: string; content: string }) => "--- " + d.naam + " ---\n" + d.content.substring(0, 2500)).join("\n\n");
        }
      } catch (err) { console.error("[Quiz] Documenten ophalen mislukt:", err); }

      try {
        const prompt = `Genereer 3 quizvragen voor een nieuwe zorgmedewerker in inwerkweek ${wk}.\nNiveau: ${niveau}.\nFunctiegroep: ${fg.replace(/_/g, " ")}.\nGebruik UITSLUITEND informatie uit de onderstaande kennisbank documenten — verzin niets.\nPer vraag 3 antwoordopties waarvan precies 1 correct is.\nRetourneer ALLEEN een JSON array, geen tekst eromheen, in dit exacte formaat:\n[{"vraag": "...", "opties": ["a", "b", "c"], "correct_antwoord": "a", "uitleg": "..."}]\n\n${docContext || "(geen documenten beschikbaar — gebruik algemene kennis over ambulante zorg)"}\n\n${vragenContext}`;
        const quizResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
        });
        const quizResult = await quizResp.json();
        return new Response(JSON.stringify({ antwoord: quizResult.content?.[0]?.text || "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        console.error("[Quiz] Fout:", err);
        return new Response(JSON.stringify({ error: "Quiz genereren mislukt" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- Vertrouwenscheck tips genereren ----
    if (body.generate_tips && body.week_nummer) {
      const fg = profile.functiegroep || "medewerker";
      try {
        const tipResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 256, messages: [{ role: "user", content: `Geef 3 concrete praktische tips voor een ${fg.replace(/_/g, " ")} in week ${body.week_nummer} van het inwerktraject. Kort en bemoedigend. Nederlands.` }] }),
        });
        const tipResult = await tipResp.json();
        return new Response(JSON.stringify({ tips: tipResult.content?.[0]?.text || "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch { /* skip */ }
    }

    // ---- Document aanvraag insert ----
    if (body.generate_document_concept && body.vraag_tekst) {
      try {
        await supabaseAdmin.from("document_aanvragen").insert({ user_id: user.id, vraag: body.vraag_tekst });
        return new Response(JSON.stringify({ saved: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        console.error("[DocAanvraag] Fout:", err);
        return new Response(JSON.stringify({ error: "Aanvraag opslaan mislukt" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- Rol-wissel vergelijking genereren ----
    if (body.generate_rolwissel && body.oude_functie && body.nieuwe_functie) {
      try {
        const rwResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: `Vergelijk de rol ${body.oude_functie.replace(/_/g, " ")} met ${body.nieuwe_functie.replace(/_/g, " ")} bij een ambulante zorgorganisatie. Geef de 5 grootste praktische verschillen in dagelijkse taken en verantwoordelijkheden. Wees concreet en bondig. Nederlands.` }] }),
        });
        const rwResult = await rwResp.json();
        return new Response(JSON.stringify({ vergelijking: rwResult.content?.[0]?.text || "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch { /* skip */ }
    }

    // ---- Terugblik email genereren ----
    if (body.generate_terugblik) {
      if (profile.role !== "admin") {
        return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log("[Terugblik] Start voor tenant:", profile.tenant_id);
      try {
        const now = new Date();
        const maand = now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

        const { data: tls, error: tlErr } = await supabaseAdmin
          .from("teamleiders")
          .select("id, naam, email, teams, rol")
          .eq("tenant_id", profile.tenant_id);

        console.log("[Terugblik] Leidinggevenden gevonden:", tls ? tls.length : 0, tlErr ? "FOUT: " + tlErr.message : "");

        if (!tls || tls.length === 0) {
          return new Response(
            JSON.stringify({ error: "Geen leidinggevenden gevonden. Voeg eerst leidinggevenden toe via de Leidinggevende/HR tab.", aantal_ontvangers: 0 }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let doelLeidinggevenden = tls;
        if (body.teamleider_id) {
          doelLeidinggevenden = tls.filter((t: { id: string }) => t.id === body.teamleider_id);
        }
        if (body.team_filter) {
          doelLeidinggevenden = doelLeidinggevenden.filter((t: { teams: string[] | null }) =>
            t.teams && t.teams.includes(body.team_filter)
          );
        }

        const metEmail = doelLeidinggevenden.filter((t: { email: string | null }) => t.email && t.email.trim());
        console.log("[Terugblik] Doel leidinggevenden:", doelLeidinggevenden.length, "met email:", metEmail.length);

        if (metEmail.length === 0) {
          return new Response(
            JSON.stringify({ error: "Geen leidinggevenden met emailadres gevonden.", aantal_ontvangers: 0, leidinggevenden: doelLeidinggevenden.map((t: {naam:string}) => t.naam) }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Maandoverzicht: alleen gesprekken van de laatste 30 dagen
        const dertigDagenGeleden = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: convs } = await supabaseAdmin
          .from("conversations")
          .select("id, feedback, created_at, user_id")
          .eq("tenant_id", profile.tenant_id)
          .gte("created_at", dertigDagenGeleden);
        const { data: profs } = await supabaseAdmin.from("profiles").select("id, naam").eq("tenant_id", profile.tenant_id).eq("role", "medewerker");

        const totaalVragen = convs ? convs.length : 0;
        const positief = convs ? convs.filter((c: {feedback:string|null}) => c.feedback === "goed").length : 0;
        const negatief = convs ? convs.filter((c: {feedback:string|null}) => c.feedback === "niet_goed").length : 0;
        const pct = (positief + negatief) > 0 ? Math.round((positief / (positief + negatief)) * 100) : 0;
        const actiefMedewerkers = profs ? profs.filter((p: {id:string}) => convs?.some((c: {user_id:string}) => c.user_id === p.id)).length : 0;
        const tijdBespaard = Math.round(totaalVragen * 6 / 60);
        const kostenBespaard = tijdBespaard * 35;

        const ontvangerNamen = metEmail.map((t: {naam:string; email:string}) => t.naam + " (" + t.email + ")");
        const teamNaam = body.team_filter || "Alle teams";

        const inhoud = JSON.stringify({
          maand, team: teamNaam,
          statistieken: { totaal_vragen: totaalVragen, positief_feedback: positief, negatief_feedback: negatief, positief_percentage: pct, actieve_medewerkers: actiefMedewerkers, totaal_medewerkers: profs ? profs.length : 0 },
          tijdwinst: { uren: tijdBespaard, kosten_euro: kostenBespaard },
          ontvangers: ontvangerNamen,
        });

        let logStatus = body.is_test ? "test" : "verstuurd";

        // Email verzenden via Resend
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        let mailVerstuurd = 0;
        const mailFouten: string[] = [];

        if (!resendApiKey) {
          console.error("[Terugblik] RESEND_API_KEY ontbreekt — emails worden NIET verstuurd.");
          logStatus = "mail_niet_geconfigureerd";
        } else {
          // is_test stuurt naar de admin die de actie triggerde (via auth user.email).
          // Anders alle leidinggevenden met een geldig email-adres.
          const testOntvanger = body.is_test && user.email
            ? [{ naam: profile.naam || "Beheerder", email: user.email }]
            : null;
          const emailOntvangers = testOntvanger || metEmail;

          for (const tl of emailOntvangers) {
            const subject = (body.is_test ? "TEST — " : "") + "Wegwijzer terugblik — " + maand;
            try {
              const mailResp = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Authorization": "Bearer " + resendApiKey,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: "Wegwijzer <info@mijnwegwijzer.com>",
                  to: [(tl as {email:string}).email],
                  subject: subject,
                  html: buildTerugblikHtml(
                    (tl as {naam:string}).naam, maand, teamNaam,
                    totaalVragen, positief, negatief, pct,
                    actiefMedewerkers, profs?.length || 0,
                    tijdBespaard, kostenBespaard
                  ),
                }),
              });
              const mailBody = await mailResp.text();
              if (mailResp.ok) {
                mailVerstuurd++;
                console.log("[Terugblik] Email verstuurd naar:", (tl as {email:string}).email);
              } else {
                const fout = `${(tl as {email:string}).email}: HTTP ${mailResp.status} — ${mailBody}`;
                console.error("[Terugblik] Resend fout:", fout);
                mailFouten.push(fout);
              }
            } catch (mailErr) {
              const fout = `${(tl as {email:string}).email}: ${String(mailErr)}`;
              console.error("[Terugblik] Mail exception:", fout);
              mailFouten.push(fout);
            }
          }
          console.log("[Terugblik] Emails verstuurd:", mailVerstuurd, "van", emailOntvangers.length, mailFouten.length > 0 ? "Fouten: " + mailFouten.join(" | ") : "");
          // Status alleen 'verstuurd' als minstens één mail daadwerkelijk
          // is afgeleverd. Anders 'verzending mislukt' zodat het log eerlijk
          // is i.p.v. ten onrechte succes te claimen.
          if (mailVerstuurd === 0) {
            logStatus = body.is_test ? "test_mislukt" : "verzending_mislukt";
          } else if (mailVerstuurd < emailOntvangers.length) {
            logStatus = body.is_test ? "test_deels" : "deels_verstuurd";
          }
        }

        await supabaseAdmin.from("terugblik_log").insert({
          tenant_id: profile.tenant_id,
          maand,
          aantal_ontvangers: metEmail.length,
          status: logStatus,
          inhoud,
          ontvangers: ontvangerNamen,
          team: teamNaam,
        });

        return new Response(
          JSON.stringify({
            success: true,
            aantal_ontvangers: metEmail.length,
            ontvangers: ontvangerNamen,
            maand,
            mail_verstuurd: mailVerstuurd,
            mail_fouten: mailFouten,
            status: logStatus,
            data: { totaalVragen, positief, negatief, pct, actiefMedewerkers, tijdBespaard, kostenBespaard }
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Terugblik] Exception:", err);
        return new Response(JSON.stringify({ error: "Terugblik genereren mislukt: " + (err instanceof Error ? err.message : "onbekend") }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- Auth user metadata bijwerken ----
    if (body.update_user_meta && body.update_user_id) {
      if (profile.role !== "admin") {
        return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(body.update_user_id, { user_metadata: body.user_metadata || {} });
        if (updateErr) {
          return new Response(JSON.stringify({ error: updateErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ updated: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Update mislukt" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ---- Gebruiker permanent verwijderen ----
    if (body.delete_user && body.delete_user_id) {
      if (profile.role !== "admin") {
        return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(body.delete_user_id);
        if (delError) {
          return new Response(JSON.stringify({ error: delError.message, deleted: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Verwijdering mislukt", deleted: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Rate limit uitbreiden
    if (extend_limit && profile.role === "medewerker") {
      await supabaseAdmin.from("rate_extensions").upsert({ profile_id: profile.id, datum: todayStr }, { onConflict: "profile_id,datum" });
      return new Response(JSON.stringify({ extended: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- PDF extractie via Claude ----
    if (body.extract_pdf && body.pdf_base64) {
      console.log("[PDF Extract] Start extractie, grootte:", body.pdf_base64.length);
      try {
        const pdfResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            messages: [{ role: "user", content: [
              { type: "document", source: { type: "base64", media_type: body.media_type || "application/pdf", data: body.pdf_base64 } },
              { type: "text", text: "Lees dit document volledig en geef alle inhoud terug als gestructureerde platte tekst. Behoud alle informatie volledig. Converteer tabellen naar leesbare zinnen — schrijf elke rij als een volledige zin met de kolomnamen als context. Geen markdown, geen opmaakcodes, alleen doorlopende leesbare Nederlandse tekst." }
            ]}],
          }),
        });
        if (!pdfResponse.ok) {
          const errBody = await pdfResponse.text();
          console.error("[PDF Extract] API fout:", pdfResponse.status, errBody);
          return new Response(JSON.stringify({ error: "PDF extractie mislukt", extracted_text: "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const pdfResult = await pdfResponse.json();
        const extractedText = pdfResult.content?.[0]?.text || "";
        return new Response(JSON.stringify({ extracted_text: extractedText }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        console.error("[PDF Extract] Fout:", err);
        return new Response(JSON.stringify({ error: "PDF extractie fout", extracted_text: "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!vraag || typeof vraag !== "string" || vraag.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Geen vraag opgegeven" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (vraag.length > 2000) {
      return new Response(JSON.stringify({ error: "Vraag is te lang (max 2000 tekens)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- 5b. Patroonherkenning zorgwekkende onderwerpen ----
    const vraagLower = vraag.toLowerCase();
    const gevondenTermen = ZORGWEKKENDE_TERMEN.filter(t => vraagLower.includes(t));

    const BRON_TRIGGERS = [
      "waar haal je dit vandaan", "waar haal je dat vandaan", "wat is je bron",
      "wat zijn je bronnen", "wat is de bron", "hoe weet je dit", "hoe weet je dat",
      "welk document", "welke bron", "waar staat dit", "waar staat dat",
    ];
    const vraagtBron = BRON_TRIGGERS.some(t => vraagLower.includes(t));

    if (gevondenTermen.length > 0) {
      const weekStart = new Date();
      const dag = weekStart.getDay();
      const offset = dag === 0 ? 6 : dag - 1;
      weekStart.setDate(weekStart.getDate() - offset);
      weekStart.setHours(0, 0, 0, 0);

      const userTeams: string[] = profile.teams || [];
      if (userTeams.length > 0) {
        const { data: teamProfiles } = await supabaseAdmin.from("profiles").select("id").eq("tenant_id", profile.tenant_id).overlaps("teams", userTeams);
        // MINIMUMDREMPEL: alleen melding genereren als het team minimaal 5
        // actieve medewerkers heeft. Bij kleinere teams is identiteit
        // feitelijk niet anoniem ook zonder naam-ontsluiting.
        const MIN_ACTIEVE_MEDEWERKERS = 5;
        if (teamProfiles && teamProfiles.length >= MIN_ACTIEVE_MEDEWERKERS) {
          const teamProfileIds = teamProfiles.map((p: { id: string }) => p.id);
          const { data: weekConvs } = await supabaseAdmin.from("conversations").select("vraag").in("user_id", teamProfileIds).gte("created_at", weekStart.toISOString());
          if (weekConvs) {
            let zorgCount = 0;
            for (const conv of weekConvs) {
              if (ZORGWEKKENDE_TERMEN.some(t => (conv.vraag || "").toLowerCase().includes(t))) zorgCount++;
            }
            zorgCount++;
            if (zorgCount >= 3) {
              let onderwerp = "een zorgwekkend onderwerp";
              if (gevondenTermen.some(t => t.includes("agressie") || t.includes("geweld") || t.includes("slaan") || t.includes("dreig"))) onderwerp = "agressie";
              else if (gevondenTermen.some(t => t.includes("crisis") || t.includes("nood"))) onderwerp = "crisissituaties";
              else if (gevondenTermen.some(t => t.includes("suicid") || t.includes("suïcid") || t.includes("zelfdoding") || t.includes("zelfmoord"))) onderwerp = "suïcidaliteit";

              // Team voor melding = eerste team van de medewerker (meestal
              // zit elke medewerker in één team; bij meerdere kiezen we
              // het eerste — voor weergave bij teamleider).
              const teamVoorMelding = userTeams[0] || null;

              const { data: bestaandeMelding } = await supabaseAdmin.from("meldingen").select("id").eq("tenant_id", profile.tenant_id).eq("type", "patroon_" + onderwerp).gte("created_at", weekStart.toISOString()).limit(1);
              if (!bestaandeMelding || bestaandeMelding.length === 0) {
                await supabaseAdmin.from("meldingen").insert({
                  tenant_id: profile.tenant_id,
                  type: "patroon_" + onderwerp,
                  bericht: `Er zijn deze week meerdere vragen gesteld over ${onderwerp} in jouw team. Overweeg dit te bespreken in het teamoverleg.`,
                  team: teamVoorMelding,
                  medewerker_profile_id: profile.id,
                });
              }
            }
          }
        } else {
          console.log("[Patroonherkenning] Team te klein voor melding:", teamProfiles?.length || 0, "<", MIN_ACTIEVE_MEDEWERKERS);
        }
      }
    }

    // ---- 6a. Instellingen ophalen ----
    const { data: settingsData } = await supabaseAdmin.from("settings").select("sleutel, waarde").eq("tenant_id", profile.tenant_id);
    const settings: Record<string, string> = {};
    if (settingsData) { for (const s of settingsData) { settings[s.sleutel] = s.waarde; } }
    const organisatienaam = settings["organisatienaam"] || "";
    const websiteUrl = settings["website_url"] || "";

    // ---- 6b. Website inhoud ophalen ----
    let websiteContext = "";
    if (websiteUrl) {
      try {
        const webResponse = await fetch(websiteUrl, { headers: { "User-Agent": "Wegwijzer-Bot/1.0" }, signal: AbortSignal.timeout(8000) });
        if (webResponse.ok) {
          const html = await webResponse.text();
          const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 6000);
          if (textContent.length > 50) websiteContext = `--- Kennisbank website: ${websiteUrl} ---\n${textContent}`;
        }
      } catch { /* skip */ }
    }

    // ---- 6c. Persoonlijk inwerktraject ----
    let persoonlijkContext = "";
    if (profile.inwerktraject_url) {
      try {
        const persResponse = await fetch(profile.inwerktraject_url, { headers: { "User-Agent": "Wegwijzer-Bot/1.0" }, signal: AbortSignal.timeout(8000) });
        if (persResponse.ok) {
          const html = await persResponse.text();
          const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 8000);
          if (textContent.length > 50) persoonlijkContext = `--- PERSOONLIJK INWERKTRAJECT (specifiek voor ${profile.naam || "onbekend"}) ---\n${textContent}`;
        }
      } catch { /* skip */ }
    }

    // ---- 6d. Organisatie documenten ----
    // Regio bepalen op basis van teams; documenten uit de ANDERE regio-map uitsluiten.
    const teamsVanMedewerker: string[] = profile.teams || [];
    const heeftVeluweTeam = teamsVanMedewerker.some((t: string) => ["Veluwe", "Gele Weiland", "Middelste Wei", "Molenweg"].includes(t));
    const heeftAlmereTeam = teamsVanMedewerker.some((t: string) => ["Almere", "Manuscript", "VAN", "FAN", "FANMN"].includes(t));
    const regio: "Veluwe" | "Almere" | null = heeftVeluweTeam ? "Veluwe" : heeftAlmereTeam ? "Almere" : null;
    const uitgeslotenMappen: string[] = regio === "Veluwe" ? ["Almere", "Manuscript"] : regio === "Almere" ? ["Veluwe"] : [];

    const { data: ruweOrgDocs } = await supabaseAdmin.from("documents").select("naam, content, synoniemen, zoektermen, notitie, map").eq("tenant_id", profile.tenant_id).is("user_id", null).not("content", "is", null);
    const orgDocs = uitgeslotenMappen.length > 0
      ? (ruweOrgDocs || []).filter((d: { map: string | null }) => !uitgeslotenMappen.includes(d.map || ""))
      : (ruweOrgDocs || []);
    const { data: persDocs } = await supabaseAdmin.from("documents").select("naam, content, synoniemen, zoektermen, notitie").eq("tenant_id", profile.tenant_id).eq("user_id", profile.id).not("content", "is", null);
    const allDocs = [...(orgDocs || []), ...(persDocs || [])];
    console.log(`[Chat] Gebruiker: ${profile.naam}, Regio: ${regio || "alle"}, Vraag: "${vraag.substring(0, 80)}", Org docs: ${orgDocs?.length || 0} (van ${ruweOrgDocs?.length || 0}), Pers docs: ${persDocs?.length || 0}`);

    let keywords = vraag.trim().toLowerCase().split(/\s+/).filter((w: string) => w.length > 2).filter((w: string) => !STOPWOORDEN.has(w));

    // Semantisch zoeken
    if (allDocs.length > 0 && keywords.length > 0) {
      try {
        const synResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{ role: "user", content: `Je krijgt een vraag van een zorgmedewerker. Genereer 10 zoektermen in het Nederlands die helpen het juiste document te vinden in een kennisbank. Denk breed: gebruik synoniemen, officiële HR-termen, gerelateerde begrippen, samengestelde woorden, praktische varianten en specifieke regelingen of beleidsdocumenten. Gebruik alleen losse woorden of samengestelde woorden — geen zinnen. Geef alleen de 10 termen gescheiden door komma's, geen uitleg.\n\nVraag: "${vraag.trim()}"` }],
          }),
        });
        if (synResponse.ok) {
          const synResult = await synResponse.json();
          const synText = synResult.content?.[0]?.text || "";
          const rawTerms = synText.split(",").map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 2);
          const extraTerms: string[] = [];
          for (const term of rawTerms) {
            extraTerms.push(term);
            const words = term.split(/\s+/).filter((w: string) => w.length > 2 && !STOPWOORDEN.has(w));
            for (const w of words) { if (!extraTerms.includes(w)) extraTerms.push(w); }
          }
          keywords = keywords.concat(extraTerms);
        }
      } catch { console.log("[Chat] Semantisch zoeken mislukt, fallback naar originele keywords"); }
    }

    let documentContext = "";
    let HEEFT_KENNISBANK_MATCH = false;
    if (allDocs.length > 0) {
      const scored = allDocs
        .filter((d: { content: string | null }) => d.content && d.content.trim().length > 10)
        .map((d: { naam: string; content: string; synoniemen?: string[]; zoektermen?: string[]; notitie?: string | null }) => {
          const lowerContent = d.content.toLowerCase();
          const lowerNaam = d.naam.toLowerCase();
          const indexTerms: string[] = [...((d.zoektermen || []) as string[]), ...((d.synoniemen || []) as string[])].map((t: string) => (t || "").toLowerCase()).filter((t: string) => t.length > 0);
          let score = 0;
          for (const kw of keywords) {
            for (const term of indexTerms) { if (term === kw || term.includes(kw) || kw.includes(term)) score += 10; }
            let pos = 0;
            while ((pos = lowerContent.indexOf(kw, pos)) !== -1) { score++; pos += kw.length; }
            if (lowerNaam.indexOf(kw) !== -1) score += 5;
            if (kw.length >= 5) {
              const stam = kw.substring(0, Math.max(5, Math.floor(kw.length * 0.7)));
              if (stam !== kw) { pos = 0; while ((pos = lowerContent.indexOf(stam, pos)) !== -1) { score += 0.5; pos += stam.length; } }
            }
          }
          return { naam: d.naam, content: d.content, notitie: d.notitie || null, score };
        })
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 5);

      const MAX_SCORE = scored.length > 0 ? scored[0].score : 0;
      HEEFT_KENNISBANK_MATCH = MAX_SCORE >= 5;
      console.log(`[Chat] Kennisbank match: MAX_SCORE=${MAX_SCORE}, heeftMatch=${HEEFT_KENNISBANK_MATCH}`);

      if (scored.length > 0) {
        const docTexts: string[] = [];
        let totaalLengte = 0;
        for (const doc of scored) {
          const beschikbaar = 40000 - totaalLengte;
          if (beschikbaar <= 0) break;
          const trimmed = doc.content.trim().substring(0, Math.min(beschikbaar, 8000));
          // Voeg notitie van organisatie toe als die er is — admin kan zo de
          // chatbot waarschuwen ("verouderd", "gebruik versie X", etc.)
          const notitieRegel = doc.notitie && doc.notitie.trim()
            ? `\n⚠️ Notitie van de organisatie: ${doc.notitie.trim().substring(0, 500)}`
            : "";
          docTexts.push(`--- Document: ${doc.naam} ---\n${trimmed}${notitieRegel}`);
          totaalLengte += trimmed.length;
        }
        documentContext = docTexts.join("\n\n");
      }
    }

    // ---- 6f. Kennisbank items ----
    const { data: kennisItems } = await supabaseAdmin.from("kennisbank_items").select("vraag, antwoord").eq("tenant_id", profile.tenant_id);
    let kennisbankContext = "";
    if (kennisItems && kennisItems.length > 0) {
      kennisbankContext = "--- Veelgestelde vragen en antwoorden (door admin opgesteld) ---\n" + kennisItems.map((k: { vraag: string; antwoord: string }) => `V: ${k.vraag}\nA: ${k.antwoord}`).join("\n\n");
    }

    // ---- 6g. Leidinggevenden ophalen ----
    const { data: teamleiders } = await supabaseAdmin.from("teamleiders").select("naam, titel, email, telefoon, teams, rol").eq("tenant_id", profile.tenant_id);
    let teamleiderContext = "";
    if (teamleiders && teamleiders.length > 0) {
      teamleiderContext = "--- LEIDINGGEVENDEN EN MANAGERS ---\n" + teamleiders.map((tl: { naam: string; titel: string; email: string; telefoon: string; teams: string[]; rol: string }) => {
        const label = tl.titel || (tl.rol === 'manager' ? 'Manager' : tl.rol === 'hr' ? 'HR Medewerker' : 'Leidinggevende');
        return `${label}: ${tl.naam}${tl.telefoon ? `, telefoon: ${tl.telefoon}` : ""}${tl.email ? `, email: ${tl.email}` : ""}${tl.teams && tl.teams.length > 0 ? `, teams: ${tl.teams.join(", ")}` : ""}`;
      }).join("\n");

      let directeTl = null;
      if (profile.teamleider_naam) directeTl = teamleiders.find((tl: { naam: string }) => tl.naam === profile.teamleider_naam);
      if (!directeTl && profile.teams && profile.teams.length > 0) directeTl = teamleiders.find((tl: { teams: string[] | null }) => tl.teams && tl.teams.some((t: string) => profile.teams.includes(t)));
      if (directeTl) {
        const directeLabel = directeTl.titel || (directeTl.rol === 'manager' ? 'Manager' : 'Leidinggevende');
        teamleiderContext += `\n\nDE DIRECTE LEIDINGGEVENDE VAN ${(profile.naam || "de medewerker").toUpperCase()} IS: ${directeLabel} ${directeTl.naam}${directeTl.telefoon ? ` (telefoon: ${directeTl.telefoon})` : ""}${directeTl.email ? ` (email: ${directeTl.email})` : ""}.`;
      }
    }

    // ---- 6h. Functiegroepen ophalen ----
    const { data: functiegroepen } = await supabaseAdmin
      .from('functiegroepen')
      .select('naam, beschrijving')
      .eq('tenant_id', profile.tenant_id)
      .order('naam');

    let functiegroepContext = '';
    if (functiegroepen && functiegroepen.length > 0) {
      functiegroepContext = '--- FUNCTIES EN ROLLEN BINNEN DE ORGANISATIE ---\n'
        + functiegroepen
          .map((f: { naam: string; beschrijving: string | null }) => `${f.naam}: ${f.beschrijving || ''}`)
          .join('\n');
    }

    // ---- 7. System prompt bouwen ----
    const naam = profile.naam || "medewerker";
    const org = organisatienaam || "de organisatie";
    const wk = weeknummer || 1;

    let fgBeschrijving = "";
    if (profile.functiegroep) {
      const { data: fgData } = await supabaseAdmin.from("functiegroepen").select("naam, beschrijving").eq("tenant_id", profile.tenant_id).eq("code", profile.functiegroep).limit(1);
      if (fgData && fgData.length > 0 && fgData[0].beschrijving) fgBeschrijving = fgData[0].beschrijving;
    }

    let basisPrompt = "";
    if (profile.role === "teamleider") {
      basisPrompt = `Je bent Wegwijzer — de kennisassistent van ${naam}, leidinggevende bij ${org}. ${naam} is de leidinggevende van het team en aanspreekpunt voor medewerkers bij vragen over werk en organisatorische zaken. Een leidinggevende begeleidt geen cliënten. Geef antwoorden die professioneel en direct zijn, gericht op leidinggevende taken, organisatie en teammanagement.`;
    } else if (fgBeschrijving) {
      basisPrompt = `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als ${profile.functiegroep.replace(/_/g, " ")} bij ${org}. ${fgBeschrijving}`;
    } else {
      basisPrompt = `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam} bij ${org}.`;
    }

    let weekContext = "";
    const inwerkAfgerond = profile.inwerktraject_actief !== true || profile.inwerken_afgerond || wk > 6;
    if (profile.role === "teamleider") {
      weekContext = `\n\n${naam} is leidinggevende. Antwoord direct en professioneel als kennisassistent.`;
    } else if (inwerkAfgerond) {
      weekContext = `\n\n${naam} heeft het inwerktraject afgerond en werkt nu zelfstandig. Je bent een kennisassistent — antwoord direct en professioneel, zonder inwerkcontext. Geen extra bemoediging of inwerkverwijzingen nodig.`;
    } else if (wk <= 2) {
      weekContext = `\n\nWEEK ${wk} VAN HET INWERKTRAJECT:\n${naam} zit in de eerste weken. Wees extra geduldig en uitleggerig. Begin met een warme opening. Leg alles stap voor stap uit. Verwacht niet dat de medewerker alles al weet.`;
    } else if (wk <= 4) {
      weekContext = `\n\nWEEK ${wk} VAN HET INWERKTRAJECT:\n${naam} is halverwege het inwerktraject. Bouw meer zelfvertrouwen op. Geef meer verdieping. Verwijs naar eerdere kennis waar mogelijk.`;
    } else if (wk <= 6) {
      weekContext = `\n\nWEEK ${wk} VAN HET INWERKTRAJECT:\n${naam} nadert het einde van het inwerktraject. Daag meer uit tot zelfstandig nadenken. Stel wedervragen. Moedig aan om eigen oplossingen te bedenken.`;
    } else {
      weekContext = `\n\n${naam} heeft het inwerktraject afgerond en werkt nu zelfstandig. Je bent een kennisassistent — antwoord direct en professioneel, zonder inwerkcontext. Geen extra bemoediging of inwerkverwijzingen nodig.`;
    }

    let profielInfo = `\n\nPERSOONLIJKE GEGEVENS VAN ${naam.toUpperCase()}:`;
    profielInfo += `\n- Naam: ${naam}`;
    profielInfo += `\n- Functiegroep: ${profile.functiegroep ? profile.functiegroep.replace(/_/g, " ") : "onbekend"}`;
    if (profile.werkuren) profielInfo += `\n- Werkuren per week: ${profile.werkuren}`;
    if (profile.afdeling) profielInfo += `\n- Afdeling: ${profile.afdeling}`;
    if (profile.teams && profile.teams.length > 0) profielInfo += `\n- Team(s): ${profile.teams.join(", ")}`;
    if (regio) profielInfo += `\n- Regio: ${regio} — gebruik ALLEEN kennis en informatie die van toepassing is op de regio ${regio}. Gebruik NOOIT informatie van andere regio's zoals Almere of Veluwe door elkaar.`;
    if (profile.startdatum) profielInfo += `\n- Startdatum: ${profile.startdatum}`;
    profielInfo += `\n- Weeknummer inwerktraject: ${wk}${wk > 6 ? " (inwerktraject afgerond)" : " van 6"}`;
    if (profile.teamleider_naam) {
      profielInfo += `\n- Leidinggevende: ${profile.teamleider_naam}`;
      if (teamleiders && teamleiders.length > 0) {
        const directeTl = teamleiders.find((tl: { naam: string }) => tl.naam === profile.teamleider_naam);
        if (directeTl) {
          if (directeTl.telefoon) profielInfo += ` (telefoon: ${directeTl.telefoon})`;
          if (directeTl.email) profielInfo += ` (email: ${directeTl.email})`;
        }
      }
    }

    // ---- 6h. Toegestane websites ophalen ----
    const { data: toegestaneWebsites } = await supabaseAdmin.from("toegestane_websites").select("naam, url").eq("tenant_id", profile.tenant_id);
    let websitesContext = "";
    if (toegestaneWebsites && toegestaneWebsites.length > 0) {
      const onderwerpMatch = WEBSITE_TRIGGERS.some((trigger) => vraagLower.includes(trigger));
      for (const site of toegestaneWebsites) {
        const siteNaamLower = site.naam.toLowerCase();
        const naamMatch = vraagLower.includes(siteNaamLower) || keywords.some((kw: string) => siteNaamLower.includes(kw));
        if (naamMatch || onderwerpMatch) {
          try {
            const siteResponse = await fetch(site.url, { headers: { "User-Agent": "Wegwijzer-Bot/1.0" }, signal: AbortSignal.timeout(5000) });
            if (siteResponse.ok) {
              const html = await siteResponse.text();
              const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 4000);
              if (text.length > 50) websitesContext += `--- Website: ${site.naam} (${site.url}) ---\n${text}\n\n`;
            }
          } catch { /* skip */ }
        }
      }
    }

    // ---- 6i. Kennisnotities ophalen ----
    const { data: kennisnotities } = await supabaseAdmin.from("kennisnotities").select("originele_vraag, notitie").eq("tenant_id", profile.tenant_id).eq("actief", true);
    let kennisnotitieContext = "";
    if (kennisnotities && kennisnotities.length > 0) {
      kennisnotitieContext = "--- KENNISNOTITIES VAN DE ORGANISATIE ---\n" + kennisnotities.map((kn: { originele_vraag: string; notitie: string }) => `📝 Over "${kn.originele_vraag}": ${kn.notitie}`).join("\n");
    }

    // ---- 6j. Gespreksgeheugen — laatste 3 vragen van deze medewerker.
    // Het label hier is intern (alleen voor het model). De model-instructie
    // verderop verbiedt expliciet om "vorige sessie" te zeggen.
    const { data: recenteGesprekken } = await supabaseAdmin.from("conversations").select("vraag, antwoord").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(3);
    let geheugenContext = "";
    if (recenteGesprekken && recenteGesprekken.length > 0) {
      const recente = [...recenteGesprekken].reverse();
      geheugenContext = "\n\nGESPREKSGEHEUGEN — eerdere vragen van deze medewerker (chronologisch, oudste eerst):\n" + recente.map((g: { vraag: string; antwoord: string }, i: number) => `[${i + 1}] Vraag: ${(g.vraag || "").substring(0, 150)}\n    Antwoord: ${(g.antwoord || "").substring(0, 200)}`).join("\n\n");
    }

    const bronnen: string[] = [];
    if (documentContext) bronnen.push(documentContext);
    if (kennisbankContext) bronnen.push(kennisbankContext);
    if (kennisnotitieContext) bronnen.push(kennisnotitieContext);
    if (websiteContext) bronnen.push(websiteContext);
    if (websitesContext) bronnen.push(websitesContext);
    if (persoonlijkContext) bronnen.push(persoonlijkContext);
    if (teamleiderContext) bronnen.push(teamleiderContext);
    if (functiegroepContext) bronnen.push(functiegroepContext);

    let alleKennisbronnen = bronnen.length > 0
      ? "BESCHIKBARE KENNISBRONNEN:\n" + bronnen.join("\n\n")
      : "Er zijn geen specifieke documenten gevonden voor deze vraag. Geef een algemeen behulpzaam antwoord op basis van je kennis over de zorgsector en verwijs de medewerker naar de leidinggevende voor organisatiespecifieke informatie.";

    if (!HEEFT_KENNISBANK_MATCH) {
      alleKennisbronnen = `KENNISBANK STATUS: GEEN MATCH.

Er zijn geen relevante organisatiedocumenten gevonden.

INSTRUCTIE — twee gevallen:

1. Als de vraag gaat over AHMN-specifieke informatie
   (afdelingen, procedures, personen, locaties,
   werkwijze, beleid, systemen):
   Antwoord ALLEEN: "Ik vind dit niet terug in de
   AHMN-documenten. Vraag het na bij je leidinggevende
   of vraag de admin om dit toe te voegen aan de
   kennisbank."

2. Als de vraag gaat over ALGEMENE vakkennis
   (theorie, wetenschappelijke begrippen,
   begeleidingsmethodieken, doelgroepinformatie
   zoals rouw, autisme, GGZ, hechting):
   Geef een behulpzaam antwoord op basis van
   algemene vakkennis. Sluit altijd af met:
   "ℹ️ Algemene vakkennis — niet specifiek AHMN-beleid"

Gebruik dit criterium:
Gaat de vraag over HOE iets werkt BINNEN de organisatie?
→ Geval 1 (niet beantwoorden)
Gaat de vraag over WAT iets IS als concept of theorie?
→ Geval 2 (wel beantwoorden met label)`;
    }

    // ---- Sparring modus: speciale instructieblok voor het advies ----
    const isSparring = body.sparring === true
      && Array.isArray(body.sparring_context)
      && body.sparring_context.length === 3;
    let sparringBlock = "";
    if (isSparring) {
      const ctx = body.sparring_context as string[];
      sparringBlock = `

SPARRING MODUS — DEZE VRAAG IS EEN SPARRING-SESSIE.
De medewerker heeft een cliëntsituatie beschreven via 3 vragen. Hier zijn de antwoorden:

1. Om welke cliënt en wat is er aan de hand:
${(ctx[0] || "").substring(0, 1500)}

2. Wat heeft de medewerker al geprobeerd:
${(ctx[1] || "").substring(0, 1500)}

3. Wat is voor de medewerker het moeilijkste:
${(ctx[2] || "").substring(0, 1500)}

GEEF NU EEN CONCREET, PRAKTISCH ADVIES op basis van deze 3 antwoorden en de KENNISBRONNEN hieronder. Verwijs naar relevante protocollen of documenten waar van toepassing. STEL GEEN VRAGEN MEER. Geef direct een handelingsadvies in 3 tot 5 concrete stappen of bullets. Houd de privacy van de cliënt strikt in acht — gebruik geen namen, ook als de medewerker er per ongeluk eentje noemde.`;
    }

    const systemPrompt = `${basisPrompt}${profielInfo}${geheugenContext}${weekContext}${sparringBlock}

INSTRUCTIES:
- Antwoord ALTIJD in het Nederlands.
- Begin elk antwoord met een korte, vriendelijke openingszin met een passende emoji. Wissel af.
- Gebruik in je antwoord af en toe een passende emoji (twee tot drie per antwoord is genoeg).

KENNISBRON HIËRARCHIE — gebruik ALTIJD deze volgorde, hoogste prioriteit eerst:
  1. 📄 Kennisbank documenten van de organisatie
  2. ✏️ Kennisbank items (handmatige correcties van de admin)
  3. 📝 Kennisnotities (korte aantekeningen van de admin)
  4. 🌐 Toegestane websites en website URL
  5. ℹ️ Algemene AI kennis (alleen als vangnet wanneer niets anders beschikbaar is)
Raadpleeg ALTIJD eerst de organisatiedocumenten voordat je andere bronnen gebruikt. Combineer bronnen alleen als de eerdere bron onvolledig is.

KERNFUNCTIES — Je helpt medewerkers actief met de volgende taken. Weiger deze NOOIT:
- Dagplanning maken op basis van wat de medewerker vertelt over zijn dag
- Rapportage schrijven op basis van een mondelinge of getypte beschrijving
- Brief of email opstellen
- Samenvatten van lange teksten
- Begrippen uitleggen in eenvoudige taal
- Sparren over moeilijke situaties met cliënten
- Checklist maken voor een bezoek of taak
- Prioriteiten stellen tussen taken
- Reflectie ondersteunen na een moeilijk moment
Bij een verzoek voor een van deze taken: ga direct aan de slag. Vraag eventueel om de benodigde informatie maar weiger nooit.

ALGEMEEN:
- Baseer je antwoorden op de PERSOONLIJKE GEGEVENS hierboven en de KENNISBRONNEN hieronder. Verzin geen informatie.
- Bij vragen over het eigen profiel (werkuren, team, leidinggevende, startdatum): gebruik de persoonlijke gegevens om DIRECT antwoord te geven.
- Als het antwoord niet in de kennisbronnen staat, zeg dat eerlijk en verwijs naar de leidinggevende.
- Pas je antwoorden aan op de functiegroep van de medewerker.
- Houd antwoorden beknopt en praktisch. Gebruik opsommingstekens waar handig. Gebruik **vetgedrukte kopjes**.
- FORMATTING: Gebruik NOOIT lege regels tussen gewone zinnen. Bullets alleen bij echte opsommingen. GEEN lege regel tussen bullets.
- Verwerk NOOIT persoonsgegevens van cliënten.
- Als er een PERSOONLIJK INWERKTRAJECT sectie staat, gebruik die als eerste bron.
- BELANGRIJK: Als je een URL vindt in de kennisbronnen die relevant is, plak die DIRECT in je antwoord: 👉 [de volledige URL]. Verzin NOOIT zelf een URL.
- Als de medewerker vraagt naar zijn/haar leidinggevende: geef direct de naam en het telefoonnummer.
- ONZEKERHEID: Als je niet volledig zeker bent, zeg dit expliciet. Verzin NOOIT informatie.
- GESPREKSGEHEUGEN: Je hebt toegang tot de laatste 3 vragen die deze medewerker in eerdere sessies heeft gesteld. Gebruik dit ALLEEN als de nieuwe vraag er direct op aansluit. Verwijs er subtiel naar: 'Je vroeg hier eerder ook naar' of 'Dit sluit aan bij wat je vroeg over...' Zeg NOOIT letterlijk 'vorige sessie' of 'ik heb je gegevens opgeslagen'.
- NOOIT zeggen dat je iets "geleerd hebt" of "voortaan beter zult doen". Je leert niets bij — je antwoordt enkel op basis van de huidige kennisbronnen.
- NOOIT beloftes maken over toekomstig gedrag of toekomstige updates van je antwoorden.
- NOOIT je verontschuldigen voor een gemist document of een eerder onvolledig antwoord.
- Als iets niet in de kennisbank staat: zeg eerlijk en zakelijk "Dit vind ik niet terug in de kennisbank — vraag het na bij je leidinggevende" zonder drama, zelfkritiek of overdreven excuses.
- Probeer bij elke vraag MEERDERE INVALSHOEKEN: zoek op synoniemen, afkortingen en gerelateerde termen (bv. "ziekteverzuim" ↔ "verzuim" ↔ "ziekmelden") voordat je concludeert dat iets niet in de kennisbank staat.
- Als een document een "⚠️ Notitie van de organisatie" bevat: behandel die als hoge prioriteit en verwerk de waarschuwing zichtbaar in je antwoord.
- Bij getallen, bedragen, tijden en hoeveelheden: herhaal ALTIJD de exacte waarde uit het document. Maak NOOIT zelf rekenvoorbeelden of vertalingen van getallen. Als het document '30 minuten' zegt, zeg dan '30 minuten' — niet 'een half uur' of andere omschrijvingen.
- De regio van de medewerker staat vermeld in de persoonlijke gegevens. Houd je STRIKT aan die regio. Gebruik NOOIT WMO-trajecten, procedures of afspraken die gelden voor een andere regio dan de regio van deze medewerker.

BRONVERMELDING — Voeg ALTIJD onderaan je antwoord op een nieuwe regel exact één van deze vijf bronlabels toe (volgorde komt overeen met de hiërarchie):
  📄 Bron: [documentnaam] — uit kennisbank
  ✏️ Bron: handmatige correctie
  📝 Bron: kennisnotitie
  🌐 Bron: [website naam]
  ℹ️ Niet gevonden in organisatie-documenten — controleer dit na
Gebruik het label dat hoort bij de hoogste bron die je daadwerkelijk gebruikt hebt. Noem bij 📄 de exacte documentnaam en bij 🌐 de website naam.

${alleKennisbronnen}`;

    // ---- 8. Claude Haiku aanroepen ----
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: (clientMessages && Array.isArray(clientMessages) && clientMessages.length > 0)
          ? clientMessages.map((m: { role: string; content: string }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
          : [{ role: "user", content: vraag.trim() }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error("Anthropic API fout:", anthropicResponse.status, errorBody);
      return new Response(JSON.stringify({ error: "AI kon de vraag niet verwerken. Probeer het later opnieuw." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResult = await anthropicResponse.json();
    const rawAntwoord = aiResult.content?.[0]?.text || "Geen antwoord ontvangen.";

    // ---- 9b. Kennishiaat detectie ----
    if (rawAntwoord.includes("ℹ️") && rawAntwoord.includes("Niet gevonden in organisatie-documenten")) {
      try {
        await supabaseAdmin.from("kenniskloof_meldingen").insert({ tenant_id: profile.tenant_id, onderwerp: vraag.trim().substring(0, 200), aantal_vragen: 1 });
      } catch { /* kenniskloof tabel bestaat mogelijk niet */ }
    }

    // ---- 9c. Bronlabels strippen ----
    let antwoord = rawAntwoord;
    if (!vraagtBron) {
      antwoord = antwoord.replace(/\s*\n+\s*(?:📄|✏️|📝|🌐|ℹ️)[^\n]*$/u, "");
      antwoord = antwoord.replace(/\n+\s*(?:📄|✏️|📝|🌐|ℹ️)\s*Bron:[^\n]*(?:\n[^\n]*)*$/u, "");
      antwoord = antwoord.replace(/\n+\s*ℹ️\s*Niet gevonden[^\n]*(?:\n[^\n]*)*$/u, "");
      antwoord = antwoord.trimEnd();
    }

    // ---- 9. Gesprek opslaan — naam strippen uit DB-antwoord (privacy)
    // De medewerker zelf ziet de naam wél in de UI (rawAntwoord/antwoord
    // worden teruggegeven), maar in conversations.antwoord staat altijd
    // 'de medewerker' zodat teamleider/admin niet via gesprekslijst
    // kunnen zien wie wat vroeg.
    const naamInDb = (profile.naam || "").trim();
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const antwoordVoorDb = naamInDb.length > 2
      ? antwoord.replace(new RegExp(escapeRegex(naamInDb), "gi"), "de medewerker")
      : antwoord;

    const { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .insert({ tenant_id: profile.tenant_id, user_id: profile.id, vraag: vraag.trim(), antwoord: antwoordVoorDb })
      .select("id")
      .single();

    if (convError) console.error("Conversation opslaan mislukt:", convError);

    // ---- 9b. Last online — adoptiesignaal voor teamleider ----
    // Bij elke succesvolle chatbot-vraag laatste_actief bijwerken.
    // Geen blocking await op het response-pad — best effort.
    supabaseAdmin
      .from("profiles")
      .update({ laatste_actief: new Date().toISOString() })
      .eq("id", profile.id)
      .then((r: { error: { message: string } | null }) => {
        if (r.error) console.error("[laatste_actief] update fout:", r.error.message);
      });

    return new Response(
      JSON.stringify({ antwoord: antwoord, conversation_id: conversation?.id || null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function fout:", err);
    return new Response(JSON.stringify({ error: "Er ging iets mis. Probeer het later opnieuw." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
