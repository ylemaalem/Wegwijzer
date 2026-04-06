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
          JSON.stringify({ error: "Je account is verlopen. Neem contact op met je teamleider." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- 4. Rate limiting per rol (configureerbaar per profiel) ----
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

    // ---- 5. Request body ----
    const body = await req.json();
    const { vraag, functiegroep, weeknummer, extend_limit, messages: clientMessages } = body;

    // ---- Gebruiker uitnodigen via admin API (service role) ----
    if (body.invite_user && body.invite_email) {
      console.log("[Edge] >>> INVITE_USER verzoek ontvangen voor:", body.invite_email);
      // Alleen admin mag uitnodigen
      if (profile.role !== "admin") {
        console.log("[Edge] AFGEWEZEN: rol is", profile.role, "niet admin");
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

      console.log("[Invite] Start uitnodiging voor:", inviteEmail, "rol:", inviteRole, "redirect:", redirectUrl);

      try {
        const userData: Record<string, unknown> = {
          role: inviteRole,
          naam: inviteNaam,
          tenant_id: profile.tenant_id,
        };
        if (inviteFunctiegroep) userData.functiegroep = inviteFunctiegroep;

        console.log("[Invite] Stap: inviteUserByEmail aanroepen...");
        const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(inviteEmail, {
          data: userData,
          redirectTo: redirectUrl,
        });
        console.log("[Invite] inviteUserByEmail klaar, error:", inviteError ? inviteError.message : "geen");

        if (inviteError) {
          console.error("[Invite] Fout:", JSON.stringify(inviteError));
          console.error("[Invite] Error details — message:", inviteError.message, "status:", inviteError.status, "name:", inviteError.name);
          return new Response(
            JSON.stringify({ error: inviteError.message || "Onbekende fout bij uitnodiging", invited: false }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("[Invite] Succes, user id:", inviteData?.user?.id, "email:", inviteData?.user?.email);
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
      console.log("[Resend] Start voor:", resendEmail);

      try {
        // Check of user al bestaat
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find((u: { email: string }) => u.email === resendEmail);

        if (existingUser) {
          // User bestaat — stuur recovery link (wachtwoord reset)
          console.log("[Resend] User bestaat, genereer recovery link");
          const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: "recovery",
            email: resendEmail,
            options: { redirectTo: resendRedirect || undefined },
          });

          if (linkError) {
            console.error("[Resend] Recovery link fout:", linkError.message);
            return new Response(
              JSON.stringify({ error: linkError.message }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log("[Resend] Recovery link gegenereerd");
          return new Response(
            JSON.stringify({ success: true, message: "Wachtwoord-reset mail verstuurd" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          // User bestaat niet — stuur invite
          console.log("[Resend] User bestaat niet, stuur invite");
          const { data: invData, error: invError } = await supabaseAdmin.auth.admin.inviteUserByEmail(resendEmail, {
            data: {
              role: "teamleider",
              naam: resendNaam,
              tenant_id: profile.tenant_id,
            },
            redirectTo: resendRedirect || undefined,
          });

          if (invError) {
            console.error("[Resend] Invite fout:", invError.message);
            return new Response(
              JSON.stringify({ error: invError.message }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log("[Resend] Invite verstuurd, user id:", invData?.user?.id);
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

    // ---- Gebruiker permanent verwijderen uit auth.users ----
    if (body.delete_user && body.delete_user_id) {
      if (profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Niet geautoriseerd" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const deleteUserId = body.delete_user_id;
      console.log("[Delete] Permanent verwijderen auth user:", deleteUserId);

      try {
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(deleteUserId);
        if (delError) {
          console.error("[Delete] Fout:", delError.message);
          return new Response(
            JSON.stringify({ error: delError.message, deleted: false }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log("[Delete] Succes");
        return new Response(
          JSON.stringify({ deleted: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Delete] Exception:", err);
        return new Response(
          JSON.stringify({ error: "Verwijdering mislukt", deleted: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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

    // ---- PDF extractie via Claude ----
    if (body.extract_pdf && body.pdf_base64) {
      console.log("[PDF Extract] Start extractie, grootte:", body.pdf_base64.length);
      try {
        const pdfResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            messages: [{
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "base64", media_type: body.media_type || "application/pdf", data: body.pdf_base64 },
                },
                {
                  type: "text",
                  text: "Lees dit document volledig en geef alle inhoud terug als gestructureerde platte tekst. Behoud alle informatie volledig. Converteer tabellen naar leesbare zinnen — schrijf elke rij als een volledige zin met de kolomnamen als context. Geen markdown, geen opmaakcodes, alleen doorlopende leesbare Nederlandse tekst."
                }
              ]
            }],
          }),
        });

        if (!pdfResponse.ok) {
          const errBody = await pdfResponse.text();
          console.error("[PDF Extract] API fout:", pdfResponse.status, errBody);
          return new Response(
            JSON.stringify({ error: "PDF extractie mislukt", extracted_text: "" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const pdfResult = await pdfResponse.json();
        const extractedText = pdfResult.content?.[0]?.text || "";
        console.log("[PDF Extract] Succes, tekst lengte:", extractedText.length);

        return new Response(
          JSON.stringify({ extracted_text: extractedText }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[PDF Extract] Fout:", err);
        return new Response(
          JSON.stringify({ error: "PDF extractie fout", extracted_text: "" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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
    console.log(`[Chat] Gebruiker: ${profile.naam}, Vraag: "${vraag.substring(0, 80)}", Org docs: ${orgDocs?.length || 0}, Pers docs: ${persDocs?.length || 0}`);

    // Keywords voor relevantie-scoring (gebruikt door documenten en websites)
    let keywords = vraag.trim().toLowerCase().split(/\s+/)
      .filter((w: string) => w.length > 2)
      .filter((w: string) => !STOPWOORDEN.has(w));

    // Semantisch zoeken: genereer verwante zoektermen via Claude
    if (allDocs.length > 0 && keywords.length > 0) {
      try {
        const synResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{
              role: "user",
              content: `Je krijgt een vraag van een zorgmedewerker. Genereer 10 zoektermen in het Nederlands die helpen het juiste document te vinden in een kennisbank. Denk breed: gebruik synoniemen, officiële HR-termen, gerelateerde begrippen, samengestelde woorden, praktische varianten en specifieke regelingen of beleidsdocumenten. Bijvoorbeeld: bij 'iemand aandragen voor een baan' genereer: aanbrengbonus, referralbonus, wervingsvergoeding, doorverwijzen, werving, vacature, beloning, kandidaat, aanbrengen, sollicitatie. Bij 'plusuren': genereer: minuren, jaaruren, JUS, jaarurensystematiek, overuren, compensatie, urenregistratie, arbeidstijd, saldo, uitbetaling. Gebruik alleen losse woorden of samengestelde woorden — geen zinnen. Geef alleen de 10 termen gescheiden door komma's, geen uitleg.\n\nVraag: "${vraag.trim()}"`
            }],
          }),
        });

        if (synResponse.ok) {
          const synResult = await synResponse.json();
          const synText = synResult.content?.[0]?.text || "";
          // Split op komma's en haal individuele termen
          const rawTerms = synText.split(",").map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 2);
          // Split multi-word termen ook in losse woorden voor betere matching
          const extraTerms: string[] = [];
          for (const term of rawTerms) {
            extraTerms.push(term); // Voeg de hele term toe
            const words = term.split(/\s+/).filter((w: string) => w.length > 2 && !STOPWOORDEN.has(w));
            for (const w of words) {
              if (!extraTerms.includes(w)) extraTerms.push(w);
            }
          }
          console.log(`[Chat] Semantische termen (${extraTerms.length}): ${extraTerms.join(", ")}`);
          keywords = keywords.concat(extraTerms);
        }
      } catch {
        // Semantisch zoeken gefaald, ga door met originele keywords
        console.log("[Chat] Semantisch zoeken mislukt, fallback naar originele keywords");
      }
    }

    let documentContext = "";
    if (allDocs.length > 0) {

      const scored = allDocs
        .filter((d: { content: string | null }) => d.content && d.content.trim().length > 10)
        .map((d: { naam: string; content: string }) => {
          const lowerContent = d.content.toLowerCase();
          const lowerNaam = d.naam.toLowerCase();
          let score = 0;

          for (const kw of keywords) {
            // Zoek in documentinhoud
            let pos = 0;
            while ((pos = lowerContent.indexOf(kw, pos)) !== -1) { score++; pos += kw.length; }

            // Bonus: zoek in documentnaam (zwaarder gewogen)
            if (lowerNaam.indexOf(kw) !== -1) { score += 5; }

            // Stam-matching: als keyword > 4 tekens, zoek ook op de eerste 4+ letters
            if (kw.length >= 5) {
              const stam = kw.substring(0, Math.max(5, Math.floor(kw.length * 0.7)));
              if (stam !== kw) {
                pos = 0;
                while ((pos = lowerContent.indexOf(stam, pos)) !== -1) { score += 0.5; pos += stam.length; }
              }
            }
          }

          return { naam: d.naam, content: d.content, score };
        })
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 5);

      const matchedDocs = scored.filter((s: {score:number}) => s.score > 0);
      console.log(`[Chat] Documenten met score > 0: ${matchedDocs.length}/${scored.length}`);
      console.log(`[Chat] Keywords (${keywords.length}): ${keywords.slice(0, 20).join(", ")}`);
      matchedDocs.slice(0, 5).forEach((d: {naam:string, score:number}) => {
        console.log(`[Chat]   ${d.naam}: score ${d.score}`);
      });

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
      // Stuur ALLE teamleiders mee zodat de AI elke vraag over teamleiders kan beantwoorden
      teamleiderContext = "--- VOLLEDIGE TEAMLEIDERS TABEL ---\n" +
        teamleiders.map((tl: { naam: string; email: string; telefoon: string; teams: string[] }) =>
          `Teamleider: ${tl.naam}${tl.telefoon ? `, telefoon: ${tl.telefoon}` : ""}${tl.email ? `, email: ${tl.email}` : ""}${tl.teams && tl.teams.length > 0 ? `, teams: ${tl.teams.join(", ")}` : ""}`
        ).join("\n");

      // Markeer de directe teamleider van deze medewerker
      let directeTl = null;
      if (profile.teamleider_naam) {
        directeTl = teamleiders.find((tl: { naam: string }) => tl.naam === profile.teamleider_naam);
      }
      // Fallback: zoek teamleider op basis van team-overlap
      if (!directeTl && profile.teams && profile.teams.length > 0) {
        directeTl = teamleiders.find((tl: { teams: string[] | null }) =>
          tl.teams && tl.teams.some((t: string) => profile.teams.includes(t))
        );
      }
      if (directeTl) {
        teamleiderContext += `\n\nDE DIRECTE LEIDINGGEVENDE VAN ${(profile.naam || "de medewerker").toUpperCase()} IS: ${directeTl.naam}${directeTl.telefoon ? ` (telefoon: ${directeTl.telefoon})` : ""}${directeTl.email ? ` (email: ${directeTl.email})` : ""}.`;
      }
    }

    // ---- 7. System prompt bouwen (per functiegroep uit DB) ----
    const naam = profile.naam || "medewerker";
    const org = organisatienaam || "de organisatie";
    const wk = weeknummer || 1;

    // Haal functiegroep beschrijving op uit configureerbare tabel
    let fgBeschrijving = "";
    if (profile.functiegroep) {
      const { data: fgData } = await supabaseAdmin
        .from("functiegroepen")
        .select("naam, beschrijving")
        .eq("tenant_id", profile.tenant_id)
        .eq("code", profile.functiegroep)
        .limit(1);

      if (fgData && fgData.length > 0 && fgData[0].beschrijving) {
        fgBeschrijving = fgData[0].beschrijving;
      }
    }

    // Teamleider/leidinggevende krijgt eigen prompt
    let basisPrompt = "";
    if (profile.role === "teamleider") {
      basisPrompt = `Je bent Wegwijzer — de kennisassistent van ${naam}, leidinggevende bij ${org}. ${naam} is de leidinggevende van het team en aanspreekpunt voor medewerkers bij vragen over werk en organisatorische zaken. Een leidinggevende begeleidt geen cliënten. Geef antwoorden die professioneel en direct zijn, gericht op leidinggevende taken, organisatie en teammanagement.`;
    } else if (fgBeschrijving) {
      basisPrompt = `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam}. ${naam} werkt als ${profile.functiegroep.replace(/_/g, " ")} bij ${org}. ${fgBeschrijving}`;
    } else {
      basisPrompt = `Je bent Wegwijzer — de persoonlijke kennisassistent van ${naam} bij ${org}.`;
    }

    // Weekfase context
    let weekContext = "";
    const inwerkAfgerond = profile.inwerken_afgerond || profile.inwerktraject_actief === false || wk > 6 || profile.functiegroep === "zzp_uitzendkracht";
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
    if (profile.afdeling) profielInfo += `\n- Afdeling: ${profile.afdeling}`;
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

    // ---- 6h. Toegestane websites ophalen ----
    const { data: toegestaneWebsites } = await supabaseAdmin
      .from("toegestane_websites")
      .select("naam, url")
      .eq("tenant_id", profile.tenant_id);

    let websitesContext = "";
    if (toegestaneWebsites && toegestaneWebsites.length > 0) {
      // Probeer relevante websites op te halen op basis van de vraag
      const websiteTexts: string[] = [];
      for (const site of toegestaneWebsites) {
        // Check of de vraag gerelateerd is aan deze website
        const siteNaamLower = site.naam.toLowerCase();
        if (vraagLower.includes(siteNaamLower) || keywords.some((kw: string) => siteNaamLower.includes(kw))) {
          try {
            const siteResponse = await fetch(site.url, {
              headers: { "User-Agent": "Wegwijzer-Bot/1.0" },
              signal: AbortSignal.timeout(5000),
            });
            if (siteResponse.ok) {
              const html = await siteResponse.text();
              const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 4000);
              if (text.length > 50) {
                websitesContext += `--- Website: ${site.naam} (${site.url}) ---\n${text}\n\n`;
              }
            }
          } catch { /* skip */ }
        }
      }
    }

    // Bronnen combineren
    const bronnen: string[] = [];
    if (documentContext) bronnen.push(documentContext);
    if (kennisbankContext) bronnen.push(kennisbankContext);
    if (websiteContext) bronnen.push(websiteContext);
    if (websitesContext) bronnen.push(websitesContext);
    if (persoonlijkContext) bronnen.push(persoonlijkContext);
    if (teamleiderContext) bronnen.push(teamleiderContext);

    let alleKennisbronnen = "";
    if (bronnen.length > 0) {
      alleKennisbronnen = "BESCHIKBARE KENNISBRONNEN:\n" + bronnen.join("\n\n");
    } else {
      alleKennisbronnen = "Er zijn geen specifieke documenten gevonden voor deze vraag. Geef een algemeen behulpzaam antwoord op basis van je kennis over de zorgsector en verwijs de medewerker naar de teamleider voor organisatiespecifieke informatie.";
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
- FORMATTING: Gebruik NOOIT lege regels tussen gewone zinnen. Schrijf antwoorden als doorlopende tekst. Gebruik bullets alleen bij echte opsommingen. GEEN lege regel tussen bullets onderling. Alleen een witregel bij een nieuw onderwerp met een **vetgedrukt kopje**.
- Verwerk NOOIT persoonsgegevens van cliënten.
- Als er een PERSOONLIJK INWERKTRAJECT sectie staat, gebruik die als eerste bron.
- BELANGRIJK: Als je een URL vindt in de kennisbronnen die relevant is, plak die DIRECT in je antwoord: 👉 [de volledige URL]. Verzin NOOIT zelf een URL.
- Als de medewerker vraagt naar zijn/haar teamleider, contactpersoon, of wie te bellen: geef direct de naam en het telefoonnummer uit de persoonlijke gegevens of teamleider contactinformatie.
- Als de medewerker vraagt wie de teamleider is van een specifiek team: gebruik de VOLLEDIGE TEAMLEIDERS TABEL in de kennisbronnen om het juiste antwoord te geven met naam en telefoonnummer.
- ONZEKERHEID: Als je niet volledig zeker bent van een antwoord, zeg dit ALTIJD expliciet: "Ik denk dat het zo werkt, maar ik ben hier niet volledig zeker van — controleer dit bij je teamleider." Verzin NOOIT informatie. Als het antwoord niet in de beschikbare documenten staat: "Ik kan hier geen betrouwbaar antwoord op geven op basis van de beschikbare informatie. Neem contact op met je teamleider."
- PROACTIEF AANBIEDEN: Als een medewerker vraagt over rapportage, vraag: "Wil je dat ik je help met het schrijven van die rapportage?" Als een medewerker vraagt over email of brief, vraag: "Wil je dat ik die voor je opstel?" Als een medewerker vraagt over planning, vraag: "Wil je dat ik een dagplanning voor je maak?" Als een medewerker een moeilijke situatie beschrijft, vraag: "Wil je er samen over nadenken?"
- BRONVERMELDING: Vermeld GEEN bron standaard. Alleen als de medewerker expliciet vraagt naar de bron (bijv. "waar staat dat?", "wat is de bron?"), noem dan welk document je hebt gebruikt.

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
        messages: (clientMessages && Array.isArray(clientMessages) && clientMessages.length > 0)
          ? clientMessages.map((m: { role: string; content: string }) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content
            }))
          : [{ role: "user", content: vraag.trim() }],
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
    console.log(`[Chat] AI response ontvangen, lengte: ${antwoord.length}, model: ${aiResult.model || "unknown"}`);

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
