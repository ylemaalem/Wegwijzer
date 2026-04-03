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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "API configuratie ontbreekt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
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
      .select("id, naam, role, functiegroep, startdatum, tenant_id, inwerktraject_url, werkuren, regio, teams, teamleider_naam, account_type, einddatum, inwerken_afgerond")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profiel niet gevonden" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check tijdelijk account verlopen
    if (profile.account_type === "tijdelijk" && profile.einddatum) {
      const eind = new Date(profile.einddatum);
      if (new Date() > eind) {
        return new Response(
          JSON.stringify({ error: "Je account is verlopen. Neem contact op met je teamleider." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- 4. Rate limiting per rol ----
    // Admin: geen limiet. Teamleider: 100/dag. Medewerker: 30 + optioneel 20 = max 50.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().split("T")[0];

    if (profile.role !== "admin") {
      const { count: todayCount } = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .gte("created_at", todayStart.toISOString());

      const count = todayCount || 0;

      if (profile.role === "teamleider") {
        if (count >= 100) {
          return new Response(
            JSON.stringify({ error: "Je hebt het dagelijkse maximum van 100 vragen bereikt. Morgen kun je weer vragen stellen.", rate_limited: true, hard_limit: true }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Medewerker: check of uitbreiding actief is
        const { data: extension } = await supabaseAdmin
          .from("rate_extensions")
          .select("id")
          .eq("profile_id", profile.id)
          .eq("datum", todayStr)
          .limit(1);

        const hasExtension = extension && extension.length > 0;
        const maxVragen = hasExtension ? 50 : 30;

        if (count >= 50) {
          // Harde stop op 50
          return new Response(
            JSON.stringify({ error: "Je hebt het maximale aantal vragen voor vandaag bereikt. Morgen kun je weer vragen stellen.", rate_limited: true, hard_limit: true }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else if (count >= 30 && !hasExtension) {
          // Zachte limiet: popup tonen
          return new Response(
            JSON.stringify({ error: "Je hebt je dagelijkse 30 vragen gebruikt. Wil je vandaag nog 20 extra vragen gebruiken?", rate_limited: true, soft_limit: true }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // ---- 5. Request body ----
    const body = await req.json();
    const { vraag, functiegroep, weeknummer, extend_limit } = body;

    // Als medewerker rate limit wil uitbreiden
    if (extend_limit && profile.role === "medewerker") {
      await supabaseAdmin
        .from("rate_extensions")
        .upsert({ profile_id: profile.id, datum: todayStr }, { onConflict: "profile_id,datum" });
      return new Response(
        JSON.stringify({ extended: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!vraag || typeof vraag !== "string" || vraag.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Geen vraag opgegeven" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (vraag.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Vraag is te lang (max 2000 tekens)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- 5b. Patroonherkenning zorgwekkende onderwerpen ----
    const vraagLower = vraag.toLowerCase();
    const gevondenTermen = ZORGWEKKENDE_TERMEN.filter(t => vraagLower.includes(t));

    if (gevondenTermen.length > 0) {
      // Tel hoeveel zorgwekkende vragen er deze week zijn binnen hetzelfde team
      const weekStart = new Date();
      const dag = weekStart.getDay();
      const offset = dag === 0 ? 6 : dag - 1;
      weekStart.setDate(weekStart.getDate() - offset);
      weekStart.setHours(0, 0, 0, 0);

      // Haal alle profielen op met dezelfde teams
      const userTeams: string[] = profile.teams || [];
      if (userTeams.length > 0) {
        const { data: teamProfiles } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("tenant_id", profile.tenant_id)
          .overlaps("teams", userTeams);

        if (teamProfiles && teamProfiles.length > 0) {
          const teamProfileIds = teamProfiles.map((p: { id: string }) => p.id);

          const { data: weekConvs } = await supabaseAdmin
            .from("conversations")
            .select("vraag")
            .in("user_id", teamProfileIds)
            .gte("created_at", weekStart.toISOString());

          if (weekConvs) {
            let zorgCount = 0;
            for (const conv of weekConvs) {
              const cl = (conv.vraag || "").toLowerCase();
              if (ZORGWEKKENDE_TERMEN.some(t => cl.includes(t))) {
                zorgCount++;
              }
            }

            // Huidige vraag meetellen
            zorgCount++;

            if (zorgCount >= 3) {
              // Bepaal het onderwerp
              let onderwerp = "een zorgwekkend onderwerp";
              if (gevondenTermen.some(t => t.includes("agressie") || t.includes("geweld") || t.includes("slaan") || t.includes("dreig"))) {
                onderwerp = "agressie";
              } else if (gevondenTermen.some(t => t.includes("crisis") || t.includes("nood"))) {
                onderwerp = "crisissituaties";
              } else if (gevondenTermen.some(t => t.includes("suicid") || t.includes("suïcid") || t.includes("zelfdoding") || t.includes("zelfmoord"))) {
                onderwerp = "suïcidaliteit";
              }

              // Check of er al een melding is deze week voor dit onderwerp
              const { data: bestaandeMelding } = await supabaseAdmin
                .from("meldingen")
                .select("id")
                .eq("tenant_id", profile.tenant_id)
                .eq("type", "patroon_" + onderwerp)
                .gte("created_at", weekStart.toISOString())
                .limit(1);

              if (!bestaandeMelding || bestaandeMelding.length === 0) {
                await supabaseAdmin
                  .from("meldingen")
                  .insert({
                    tenant_id: profile.tenant_id,
                    type: "patroon_" + onderwerp,
                    bericht: `Er zijn deze week meerdere vragen gesteld over ${onderwerp} in jouw team. Overweeg dit te bespreken in het teamoverleg.`,
                  });
              }
            }
          }
        }
      }
    }

    // ---- 6a. Instellingen ophalen ----
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

    // ---- 6b. Website inhoud ophalen ----
    let websiteContext = "";
    if (websiteUrl) {
      try {
        const webResponse = await fetch(websiteUrl, {
          headers: { "User-Agent": "Wegwijzer-Bot/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (webResponse.ok) {
          const html = await webResponse.text();
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
      } catch { /* skip */ }
    }

    // ---- 6c. Persoonlijk inwerktraject ----
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
            persoonlijkContext = `--- PERSOONLIJK INWERKTRAJECT (specifiek voor ${profile.naam || "onbekend"}) ---\n${textContent}`;
          }
        }
      } catch { /* skip */ }
    }

    // ---- 6d. Organisatie documenten (content kolom) ----
    const { data: orgDocs } = await supabaseAdmin
      .from("documents")
      .select("naam, content")
      .eq("tenant_id", profile.tenant_id)
      .is("user_id", null)
      .not("content", "is", null);

    // ---- 6e. Persoonlijke documenten van deze medewerker ----
    const { data: persDocs } = await supabaseAdmin
      .from("documents")
      .select("naam, content")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", profile.id)
      .not("content", "is", null);

    // Combineer alle documenten
    const allDocs = [...(orgDocs || []), ...(persDocs || [])];

    let documentContext = "";
    if (allDocs.length > 0) {
      const keywords = vraag.trim().toLowerCase().split(/\s+/)
        .filter((w: string) => w.length > 2)
        .filter((w: string) => !STOPWOORDEN.has(w));

      const scored = allDocs
        .filter((d: { content: string | null }) => d.content && d.content.trim().length > 10)
        .map((d: { naam: string; content: string }) => {
          const lower = d.content.toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            let pos = 0;
            while ((pos = lower.indexOf(kw, pos)) !== -1) { score++; pos += kw.length; }
          }
          return { naam: d.naam, content: d.content, score };
        })
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 5);

      if (scored.length > 0) {
        const docTexts: string[] = [];
        let totaalLengte = 0;
        for (const doc of scored) {
          const beschikbaar = 40000 - totaalLengte;
          if (beschikbaar <= 0) break;
          const trimmed = doc.content.trim().substring(0, Math.min(beschikbaar, 8000));
          docTexts.push(`--- Document: ${doc.naam} ---\n${trimmed}`);
          totaalLengte += trimmed.length;
        }
        documentContext = docTexts.join("\n\n");
      }
    }

    // ---- 6f. Kennisbank items (admin-antwoorden op veelgestelde vragen) ----
    const { data: kennisItems } = await supabaseAdmin
      .from("kennisbank_items")
      .select("vraag, antwoord")
      .eq("tenant_id", profile.tenant_id);

    let kennisbankContext = "";
    if (kennisItems && kennisItems.length > 0) {
      kennisbankContext = "--- Veelgestelde vragen en antwoorden (door admin opgesteld) ---\n" +
        kennisItems.map((k: { vraag: string; antwoord: string }) =>
          `V: ${k.vraag}\nA: ${k.antwoord}`
        ).join("\n\n");
    }

    // ---- 6g. Teamleider informatie ophalen ----
    const { data: teamleiders } = await supabaseAdmin
      .from("teamleiders")
      .select("naam, email, telefoon, teams")
      .eq("tenant_id", profile.tenant_id);

    let teamleiderContext = "";
    if (teamleiders && teamleiders.length > 0) {
      const userTeams: string[] = profile.teams || [];
      const relevanteTeamleiders = teamleiders.filter((tl: { teams: string[] | null }) => {
        if (!tl.teams || !userTeams.length) return false;
        return tl.teams.some((t: string) => userTeams.includes(t));
      });

      if (relevanteTeamleiders.length > 0) {
        teamleiderContext = "--- Teamleiders contactinformatie ---\n" +
          relevanteTeamleiders.map((tl: { naam: string; email: string; telefoon: string; teams: string[] }) =>
            `Teamleider: ${tl.naam}${tl.telefoon ? `, telefoon: ${tl.telefoon}` : ""}${tl.email ? `, email: ${tl.email}` : ""}${tl.teams ? `, teams: ${tl.teams.join(", ")}` : ""}`
          ).join("\n");
      }

      // Als de medewerker een directe teamleider heeft
      if (profile.teamleider_naam) {
        const directeTl = teamleiders.find((tl: { naam: string }) =>
          tl.naam === profile.teamleider_naam
        );
        if (directeTl) {
          teamleiderContext += `\n\nDe directe teamleider van ${profile.naam || "de medewerker"} is ${directeTl.naam}${directeTl.telefoon ? ` (telefoon: ${directeTl.telefoon})` : ""}${directeTl.email ? ` (email: ${directeTl.email})` : ""}.`;
        }
      }
    }

    // ---- 7. System prompt bouwen (per functiegroep) ----
    const naam = profile.naam || "medewerker";
    const org = organisatienaam || "de organisatie";
    const wk = weeknummer || 1;

    // Functiegroep-specifieke system prompts (Opdracht 2)
    const functiePrompts: Record<string, string> = {
      ambulant_begeleider: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als ambulant begeleider bij ${org}. Als ambulant begeleider ondersteun je cliënten bij hun hulpvragen in hun eigen thuissituatie. Elke cliënt heeft zijn of haar eigen uren — dat kan variëren van één uur per week tot meerdere uren. Je werkt zelfstandig bij cliënten thuis, ondersteunt bij praktische en dagelijkse hulpvragen, de contactfrequentie verschilt per cliënt afhankelijk van de toegekende uren, je werkt alleen zonder collega direct naast je en je reist tussen cliënten. Geef antwoorden die warm en begripvol zijn, rekening houden met het zelfstandig werken, praktisch en direct toepasbaar zijn en bij twijfel doorverwijzen naar de teamleider.`,
      ambulant_persoonlijk_begeleider: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als ambulant persoonlijk begeleider bij ${org}. Als persoonlijk begeleider ben je regiehouder over je cliënten. Jij bewaakt het overzicht over de zorg, de planning en de doelen. Hoe intensief het cliëntcontact is verschilt per situatie en per cliënt — soms sta je meer op de achtergrond en ligt de focus op de organisatie van de zorg. Je bent regiehouder en bewaakt het overzicht, schrijft en verlengt zorgplannen en indicaties, onderhoudt contact met WMO consulenten en het zorgkantoor, bewaakt de ureninzet en de intensiteit van cliëntcontact verschilt per situatie. Geef antwoorden die de regierol centraal stellen, ingaan op plannen en indicaties en WMO procedures, helpen bij organiseren en overzicht houden, ruimte laten voor de nuance dat elke cliënt anders is en doorverwijzen naar de teamleider bij complexe beslissingen.`,
      woonbegeleider: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als woonbegeleider bij ${org}. Vanuit de woonlocatie ondersteun je cliënten bij hun dagelijkse leven. Er zijn altijd collega's aanwezig. Je werkt vanuit een vaste woonlocatie, er zijn altijd collega's om je heen, je werkt in een teamstructuur met vaste overdracht en teamcommunicatie is essentieel. Geef antwoorden die rekening houden met de teamdynamiek, ingaan op overdracht en samenwerking, praktisch zijn voor de woonlocatie context en warm en ondersteunend zijn.`,
      persoonlijk_woonbegeleider: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als persoonlijk woonbegeleider bij ${org}. Dit is de regierol binnen de woonlocatie. Je bent regiehouder net als de ambulant PB maar dan vanuit de woonlocatie, schrijft en verlengt zorgplannen en indicaties, werkt samen met een vast team, hebt overzicht over jouw cliënten én afstemming met het team en de intensiteit van cliëntcontact verschilt per situatie. Geef antwoorden die de regierol combineren met de teamcontext, helpen bij plannen en indicaties, rekening houden met de woonlocatie structuur en professioneel maar persoonlijk zijn.`,
      medewerker_avond_nachtdienst: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als medewerker avond-/nachtdienst bij ${org}. Je werkt in avond- en nachtdiensten, vaak alleen op locatie, buiten kantoortijden. Je bent zelfstandig verantwoordelijk tijdens je dienst. De focus ligt op overdracht, veiligheid, crisisprotocollen en zelfstandig handelen buiten kantooruren. Geef antwoorden die rekening houden met het alleen werken, focus op veiligheid en crisis, praktisch en direct toepasbaar zijn en bij twijfel doorverwijzen naar de teamleider of achterwacht.`,
      kantoorpersoneel: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als kantoorpersoneel bij ${org}. Je werkt op kantoor en ondersteunt de organisatie. Geef antwoorden die praktisch en professioneel zijn, gericht op kantoorprocessen, administratie en organisatorische zaken.`,
      stagiaire: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} is stagiaire bij ${org}. Als stagiaire ben je aan het leren en oriënteren. Wees extra geduldig, leg begrippen uit en verwijs waar nodig naar de begeleider of teamleider. Geef antwoorden die leerzaam en ondersteunend zijn.`,
      zzp_uitzendkracht: `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als ZZP'er of uitzendkracht bij ${org}. Je bent flexibel inzetbaar en werkt mogelijk in wisselende teams of locaties. Geef antwoorden die praktisch en direct zijn, gericht op werkwijze en protocollen van de organisatie.`,
    };

    // Teamleider krijgt eigen prompt
    let basisPrompt = "";
    if (profile.role === "teamleider") {
      basisPrompt = `Je bent Wegwijzer — de kennisassistent van ${naam}, teamleider bij ${org}. ${naam} is leidinggevende en aanspreekpunt voor medewerkers bij vragen over werk, roosters en organisatorische zaken. Een teamleider begeleidt geen cliënten. Geef antwoorden die professioneel en direct zijn, gericht op leidinggevende taken, organisatie en teammanagement.`;
    } else {
      basisPrompt = functiePrompts[profile.functiegroep || ""] ||
        `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam} bij ${org}.`;
    }

    // Weekfase context (niet voor teamleiders, niet als inwerken afgerond)
    let weekContext = "";
    const inwerkAfgerond = profile.inwerken_afgerond || wk > 6 || profile.functiegroep === "zzp_uitzendkracht";
    if (profile.role === "teamleider") {
      weekContext = `\n\n${naam} is teamleider. Antwoord direct en professioneel als kennisassistent.`;
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

    // Volledig medewerkerprofiel opbouwen
    let profielInfo = `\n\nPERSOONLIJKE GEGEVENS VAN ${naam.toUpperCase()}:`;
    profielInfo += `\n- Naam: ${naam}`;
    profielInfo += `\n- Functiegroep: ${profile.functiegroep ? profile.functiegroep.replace(/_/g, " ") : "onbekend"}`;
    if (profile.werkuren) profielInfo += `\n- Werkuren per week: ${profile.werkuren}`;
    if (profile.regio) profielInfo += `\n- Regio: ${profile.regio}`;
    if (profile.teams && profile.teams.length > 0) profielInfo += `\n- Team(s): ${profile.teams.join(", ")}`;
    if (profile.startdatum) profielInfo += `\n- Startdatum: ${profile.startdatum}`;
    profielInfo += `\n- Weeknummer inwerktraject: ${wk}${wk > 6 ? " (inwerktraject afgerond)" : " van 6"}`;
    if (profile.teamleider_naam) {
      profielInfo += `\n- Teamleider: ${profile.teamleider_naam}`;
      // Voeg contactgegevens toe als beschikbaar
      if (teamleiders && teamleiders.length > 0) {
        const directeTl = teamleiders.find((tl: { naam: string }) => tl.naam === profile.teamleider_naam);
        if (directeTl) {
          if (directeTl.telefoon) profielInfo += ` (telefoon: ${directeTl.telefoon})`;
          if (directeTl.email) profielInfo += ` (email: ${directeTl.email})`;
        }
      }
    }

    // Bronnen combineren
    const bronnen: string[] = [];
    if (documentContext) bronnen.push(documentContext);
    if (kennisbankContext) bronnen.push(kennisbankContext);
    if (websiteContext) bronnen.push(websiteContext);
    if (persoonlijkContext) bronnen.push(persoonlijkContext);
    if (teamleiderContext) bronnen.push(teamleiderContext);

    let alleKennisbronnen = "";
    if (bronnen.length > 0) {
      alleKennisbronnen = "BESCHIKBARE KENNISBRONNEN:\n" + bronnen.join("\n\n");
    } else {
      alleKennisbronnen = "Er zijn nog geen documenten of kennisbronnen beschikbaar. Verwijs de medewerker naar de teamleider voor informatie.";
    }

    const systemPrompt = `${basisPrompt}${profielInfo}${weekContext}

INSTRUCTIES:
- Antwoord ALTIJD in het Nederlands.
- Begin elk antwoord met een korte, vriendelijke openingszin met een passende emoji. Wissel af.
- Gebruik in je antwoord af en toe een passende emoji (twee tot drie per antwoord is genoeg).
- Baseer je antwoorden op de PERSOONLIJKE GEGEVENS hierboven en de KENNISBRONNEN hieronder. Verzin geen informatie.
- Bij vragen over het eigen profiel (werkuren, regio, team, teamleider, startdatum): gebruik de persoonlijke gegevens hierboven om DIRECT antwoord te geven. Verwijs NIET door naar HR of de teamleider voor deze informatie.
- Als het antwoord niet in de persoonlijke gegevens of kennisbronnen staat, zeg dan eerlijk: "Dit kan ik niet terugvinden in de beschikbare documenten. Neem contact op met je teamleider voor meer informatie."
- Pas je antwoorden aan op de functiegroep van de medewerker.
- Houd antwoorden beknopt en praktisch. Gebruik opsommingstekens waar handig. Gebruik **vetgedrukte kopjes**.
- FORMATTING: Gebruik GEEN lege regels tussen zinnen binnen dezelfde alinea of opsomming. Plaats alleen een witregel tussen duidelijk verschillende onderwerpen of secties. Houd de tekst compact.
- Verwerk NOOIT persoonsgegevens van cliënten.
- Als er een PERSOONLIJK INWERKTRAJECT sectie staat, gebruik die als eerste bron.
- BELANGRIJK: Als je een URL vindt in de kennisbronnen die relevant is, plak die DIRECT in je antwoord: 👉 [de volledige URL]. Verzin NOOIT zelf een URL.
- Als de medewerker vraagt naar zijn/haar teamleider, contactpersoon, of wie te bellen: geef direct de naam en het telefoonnummer uit de persoonlijke gegevens of teamleider contactinformatie.

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
        messages: [{ role: "user", content: vraag.trim() }],
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

    // ---- 9. Gesprek opslaan ----
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function fout:", err);
    return new Response(
      JSON.stringify({ error: "Er ging iets mis. Probeer het later opnieuw." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
