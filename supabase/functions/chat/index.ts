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

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- 1. Authenticatie controleren ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Niet geautoriseerd" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Supabase client met user token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "API configuratie ontbreekt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client met user's JWT (voor RLS)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client (bypass RLS, voor documenten ophalen)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ---- 2. Gebruiker verifiëren ----
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Sessie verlopen. Log opnieuw in." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- 3. Profiel ophalen ----
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, naam, role, functiegroep, startdatum, tenant_id, inwerktraject_url")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profiel niet gevonden" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- 4. Request body lezen ----
    const { vraag, functiegroep, weeknummer } = await req.json();

    if (!vraag || typeof vraag !== "string" || vraag.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Geen vraag opgegeven" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Max lengte check
    if (vraag.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Vraag is te lang (max 2000 tekens)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- 5a. Tenant instellingen ophalen (organisatienaam, website URL) ----
    const { data: settingsData } = await supabaseAdmin
      .from("settings")
      .select("sleutel, waarde")
      .eq("tenant_id", profile.tenant_id);

    const settings: Record<string, string> = {};
    if (settingsData) {
      for (const s of settingsData) {
        settings[s.sleutel] = s.waarde;
      }
    }

    const organisatienaam = settings["organisatienaam"] || "";
    const websiteUrl = settings["website_url"] || "";

    // ---- 5b. Website inhoud ophalen als kennisbron ----
    let websiteContext = "";
    if (websiteUrl) {
      try {
        const webResponse = await fetch(websiteUrl, {
          headers: { "User-Agent": "Wegwijzer-Bot/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (webResponse.ok) {
          const html = await webResponse.text();
          // Strip HTML tags, houd tekst over
          const textContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 6000);
          if (textContent.length > 50) {
            websiteContext = `--- Kennisbank website: ${websiteUrl} ---\n${textContent}`;
          }
        }
      } catch {
        // Website niet bereikbaar, ga door zonder
      }
    }

    // ---- 5c. Persoonlijk inwerktraject ophalen ----
    let persoonlijkContext = "";
    if (profile.inwerktraject_url) {
      try {
        const persResponse = await fetch(profile.inwerktraject_url, {
          headers: { "User-Agent": "Wegwijzer-Bot/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (persResponse.ok) {
          const html = await persResponse.text();
          const textContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 8000);
          if (textContent.length > 50) {
            persoonlijkContext = `--- PERSOONLIJK INWERKTRAJECT (specifiek voor deze medewerker: ${profile.naam || "onbekend"}) ---\n${textContent}`;
          }
        }
      } catch {
        // Persoonlijk inwerktraject niet bereikbaar, ga door zonder
      }
    }

    // ---- 5d. Documenten ophalen uit Storage ----
    const { data: documents } = await supabaseAdmin
      .from("documents")
      .select("naam, bestandspad")
      .eq("tenant_id", profile.tenant_id);

    let documentContext = "";

    if (documents && documents.length > 0) {
      const docTexts: string[] = [];

      for (const doc of documents) {
        try {
          const { data: fileData, error: fileError } = await supabaseAdmin.storage
            .from("documents")
            .download(doc.bestandspad);

          if (fileError || !fileData) continue;

          // Lees als tekst (werkt voor PDF text-layer en plain text)
          const text = await fileData.text();

          // Filter lege of te korte bestanden
          if (text && text.trim().length > 10) {
            // Limiteer per document tot 8000 karakters
            const trimmed = text.trim().substring(0, 8000);
            docTexts.push(`--- Document: ${doc.naam} ---\n${trimmed}`);
          }
        } catch {
          // Document kon niet gelezen worden, sla over
          continue;
        }
      }

      if (docTexts.length > 0) {
        documentContext = docTexts.join("\n\n");
      }
    }

    // ---- 6. Functiegroep context opbouwen ----
    const functiegroepContext: Record<string, string> = {
      ambulant_begeleider:
        "De medewerker is Ambulant Begeleider. Dit is een ondersteunende rol. " +
        "De medewerker bezoekt cliënten thuis en kan cliënten vaker zien. " +
        "De focus ligt op thuisbezoeken, dagelijkse zorg en omgaan met situaties bij de cliënt thuis.",
      ambulant_persoonlijk_begeleider:
        "De medewerker is Ambulant Persoonlijk Begeleider. Dit is een regiehouder met helicopterview over de cliënt. " +
        "Verantwoordelijk voor zorgplannen maken en verlengen, indicaties, contact met WMO consulent en zorgkantoor, " +
        "en het bewaken van de ureninzet. Focus op plannen schrijven, indicaties aanvragen, WMO procedures, rapportage en regievoering.",
      woonbegeleider:
        "De medewerker is Woonbegeleider. Dit is een ondersteunende rol vanuit een woonlocatie. " +
        "De medewerker werkt in teamverband. Focus op teamoverdracht, woonlocatie werkwijze en omgaan met cliënten in de woonvorm.",
      persoonlijk_woonbegeleider:
        "De medewerker is Persoonlijk Woonbegeleider. Dit is een regiehouder vanuit een woonlocatie. " +
        "Verantwoordelijk voor zorgplannen, indicaties en regievoering op locatie. " +
        "Zelfde verantwoordelijkheden als de ambulant PB maar dan in de context van een woonlocatie.",
    };

    const fgContext = functiegroepContext[profile.functiegroep || ""] || "";
    const wk = weeknummer || 1;

    // ---- 7. System prompt bouwen ----
    const orgLabel = organisatienaam ? `voor nieuwe medewerkers van ${organisatienaam}` : "voor nieuwe medewerkers";

    // Combineer alle kennisbronnen
    const bronnen: string[] = [];
    if (documentContext) bronnen.push(documentContext);
    if (websiteContext) bronnen.push(websiteContext);
    if (persoonlijkContext) bronnen.push(persoonlijkContext);

    let alleKennisbronnen = "";
    if (bronnen.length > 0) {
      alleKennisbronnen = "BESCHIKBARE KENNISBRONNEN:\n" + bronnen.join("\n\n");
    } else {
      alleKennisbronnen = "Er zijn nog geen documenten of kennisbronnen beschikbaar. Verwijs de medewerker naar de teamleider voor informatie.";
    }

    const systemPrompt = `Je bent de Wegwijzer, een vriendelijke en behulpzame inwerkcoach ${orgLabel}.

FUNCTIEGROEP VAN DE MEDEWERKER:
${fgContext || "Functiegroep onbekend."}

WEEKNUMMER INWERKTRAJECT:
De medewerker zit in week ${wk} van het 6 weken durende inwerktraject.
${wk <= 2 ? "Focus op basisinformatie, kennismaking met de organisatie en eerste stappen." : ""}
${wk >= 3 && wk <= 4 ? "De medewerker is halverwege het inwerktraject. Focus op verdieping en zelfstandig werken." : ""}
${wk >= 5 ? "De medewerker nadert het einde van het inwerktraject. Focus op zelfstandigheid en afronding." : ""}

INSTRUCTIES:
- Antwoord ALTIJD in het Nederlands.
- Begin elk antwoord met een korte, vriendelijke openingszin met een passende emoji. Voorbeelden: "Goeie vraag! 😊", "Dat leg ik je graag uit! 📋", "Goed dat je dit vraagt! 💡", "Daar help ik je mee! 🤝". Wissel af en herhaal niet steeds dezelfde opening.
- Communiceer vriendelijk en warm. Gebruik ook in de rest van je antwoord af en toe een passende emoji (bijv. ✅, 📌, 🏠, ❤️) om het levendig en toegankelijk te maken. Overdrijf niet — twee tot drie emoji's per antwoord is genoeg.
- Baseer je antwoorden UITSLUITEND op de beschikbare kennisbronnen hieronder. Verzin geen informatie.
- Als het antwoord niet in de kennisbronnen staat, zeg dan eerlijk: "Dit kan ik niet terugvinden in de beschikbare documenten. Neem contact op met je teamleider voor meer informatie."
- Pas je antwoorden aan op de functiegroep van de medewerker. Geef informatie die relevant is voor hun specifieke rol.
- Houd je antwoorden beknopt en praktisch. Gebruik opsommingstekens waar handig. Gebruik **vetgedrukte kopjes** om secties te scheiden.
- Verwerk NOOIT persoonsgegevens van cliënten. Als de medewerker cliëntgegevens deelt, wijs hen erop dat dit niet is toegestaan.
- Wees bemoedigend en ondersteunend — de medewerker is nieuw en leert nog.
- Als er een PERSOONLIJK INWERKTRAJECT sectie in de kennisbronnen staat, gebruik die informatie als eerste bron bij vragen over het inwerktraject van deze specifieke medewerker. Dit document is op maat gemaakt voor hen.

${alleKennisbronnen}`;

    // ---- 8. Claude Haiku aanroepen ----
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: vraag.trim(),
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error("Anthropic API fout:", anthropicResponse.status, errorBody);
      return new Response(
        JSON.stringify({ error: "AI kon de vraag niet verwerken. Probeer het later opnieuw." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await anthropicResponse.json();
    const antwoord = aiResult.content?.[0]?.text || "Geen antwoord ontvangen.";

    // ---- 9. Gesprek opslaan in database ----
    const { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .insert({
        tenant_id: profile.tenant_id,
        user_id: profile.id,
        vraag: vraag.trim(),
        antwoord: antwoord,
      })
      .select("id")
      .single();

    if (convError) {
      console.error("Conversation opslaan mislukt:", convError);
    }

    // ---- 10. Antwoord terugsturen ----
    return new Response(
      JSON.stringify({
        antwoord: antwoord,
        conversation_id: conversation?.id || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Edge function fout:", err);
    return new Response(
      JSON.stringify({ error: "Er ging iets mis. Probeer het later opnieuw." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
