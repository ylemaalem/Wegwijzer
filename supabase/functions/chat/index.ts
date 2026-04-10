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

    // ---- 4. Request body ----
    const body = await req.json();
    const { vraag, functiegroep, weeknummer, extend_limit, messages: clientMessages } = body;

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
        // Strip markdown code fences als aanwezig
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        // Probeer JSON array te vinden
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

        // Filter en lowercase
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

    // ---- Teamleider: team medewerkers ophalen (via service role, omzeilt RLS) ----
    if (body.get_team_medewerkers) {
      if (profile.role !== "teamleider" && profile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Geen toegang" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Alle medewerkers in tenant ophalen — frontend filtert op team/naam
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

    // ---- 5. Rate limiting per rol (configureerbaar per profiel) ----
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

    // ---- Weekstart briefing genereren ----
    if (body.generate_briefing && body.week_nummer) {
      const wk = body.week_nummer;
      const fg = profile.functiegroep || "medewerker";
      console.log("[Briefing] Genereren voor week", wk, "functiegroep:", fg);

      // Check of briefing al bestaat
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

      // Haal top 3 documenten op basis van weeknummer + functiegroep
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
          searchTerm.split(/\s+/).forEach((w: string) => {
            if (w.length > 2 && lower.indexOf(w) !== -1) score++;
          });
          return { ...d, score };
        }).sort((a: {score:number}, b: {score:number}) => b.score - a.score).slice(0, 3);

        docContext = scored.map((d: {naam:string; content:string}) =>
          "--- " + d.naam + " ---\n" + d.content.substring(0, 3000)
        ).join("\n\n");
      }

      try {
        const briefResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            messages: [{
              role: "user",
              content: `Je bent een inwerkcoach voor een zorgmedewerker. Week: ${wk}. Functiegroep: ${fg.replace(/_/g, " ")}. Gebruik de onderstaande documenten om concrete focuspunten te benoemen voor deze week. Wees kort, warm en praktisch. Maximaal 4 zinnen. Begin met: 'Goedemorgen, je bent nu in week ${wk} van je inwerktraject.'\n\n${docContext || "Geen documenten beschikbaar."}`
            }],
          }),
        });

        const briefResult = await briefResp.json();
        const briefText = briefResult.content?.[0]?.text || "Welkom in week " + wk + "!";

        await supabaseAdmin.from("weekstart_briefings").insert({
          user_id: user.id,
          week_nummer: wk,
          briefing_tekst: briefText,
        });

        return new Response(
          JSON.stringify({ briefing: briefText, cached: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[Briefing] Fout:", err);
        return new Response(
          JSON.stringify({ briefing: "Welkom in week " + wk + "! Succes deze week.", cached: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Vertrouwenscheck tips genereren ----
    if (body.generate_tips && body.week_nummer) {
      const fg = profile.functiegroep || "medewerker";
      try {
        const tipResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            messages: [{
              role: "user",
              content: `Geef 3 concrete praktische tips voor een ${fg.replace(/_/g, " ")} in week ${body.week_nummer} van het inwerktraject. Kort en bemoedigend. Nederlands.`
            }],
          }),
        });
        const tipResult = await tipResp.json();
        return new Response(
          JSON.stringify({ tips: tipResult.content?.[0]?.text || "" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch { /* skip */ }
    }

    // ---- Document aanvraag insert (geen AI concept generatie meer) ----
    if (body.generate_document_concept && body.vraag_tekst) {
      // Backwards-compat: deze action wordt niet meer gebruikt door de frontend
      // (medewerker.js inserts nu direct), maar we blijven het ondersteunen.
      try {
        await supabaseAdmin.from("document_aanvragen").insert({
          user_id: user.id,
          vraag: body.vraag_tekst,
        });
        return new Response(
          JSON.stringify({ saved: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[DocAanvraag] Fout:", err);
        return new Response(
          JSON.stringify({ error: "Aanvraag opslaan mislukt" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Rol-wissel vergelijking genereren ----
    if (body.generate_rolwissel && body.oude_functie && body.nieuwe_functie) {
      try {
        const rwResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 512,
            messages: [{
              role: "user",
              content: `Vergelijk de rol ${body.oude_functie.replace(/_/g, " ")} met ${body.nieuwe_functie.replace(/_/g, " ")} bij een ambulante zorgorganisatie. Geef de 5 grootste praktische verschillen in dagelijkse taken en verantwoordelijkheden. Wees concreet en bondig. Nederlands.`
            }],
          }),
        });
        const rwResult = await rwResp.json();
        return new Response(
          JSON.stringify({ vergelijking: rwResult.content?.[0]?.text || "" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

        // Stap 1: Teamleiders ophalen uit teamleiders tabel (Leidinggevende/HR tab)
        console.log("[Terugblik] Stap 1: teamleiders ophalen...");
        const { data: tls, error: tlErr } = await supabaseAdmin
          .from("teamleiders")
          .select("id, naam, email, teams, rol")
          .eq("tenant_id", profile.tenant_id);

        console.log("[Terugblik] Teamleiders gevonden:", tls ? tls.length : 0, tlErr ? "FOUT: " + tlErr.message : "");

        if (!tls || tls.length === 0) {
          console.log("[Terugblik] Geen teamleiders gevonden in teamleiders tabel");
          return new Response(
            JSON.stringify({ error: "Geen teamleiders gevonden. Voeg eerst teamleiders toe via de Leidinggevende/HR tab.", aantal_ontvangers: 0 }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Filter op specifieke teamleider als meegegeven
        let doelTeamleiders = tls;
        if (body.teamleider_id) {
          doelTeamleiders = tls.filter((t: { id: string }) => t.id === body.teamleider_id);
        }
        if (body.team_filter) {
          doelTeamleiders = doelTeamleiders.filter((t: { teams: string[] | null }) =>
            t.teams && t.teams.includes(body.team_filter)
          );
        }

        const metEmail = doelTeamleiders.filter((t: { email: string | null }) => t.email && t.email.trim());
        console.log("[Terugblik] Doel teamleiders:", doelTeamleiders.length, "met email:", metEmail.length);

        if (metEmail.length === 0) {
          return new Response(
            JSON.stringify({ error: "Geen teamleiders met emailadres gevonden.", aantal_ontvangers: 0, teamleiders: doelTeamleiders.map((t: {naam:string}) => t.naam) }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Stap 2: Data ophalen
        console.log("[Terugblik] Stap 2: gesprekken en profielen ophalen...");
        const { data: convs } = await supabaseAdmin.from("conversations").select("id, feedback, created_at, user_id").eq("tenant_id", profile.tenant_id);
        const { data: profs } = await supabaseAdmin.from("profiles").select("id, naam").eq("tenant_id", profile.tenant_id).eq("role", "medewerker");

        const totaalVragen = convs ? convs.length : 0;
        const positief = convs ? convs.filter((c: {feedback:string|null}) => c.feedback === "goed").length : 0;
        const negatief = convs ? convs.filter((c: {feedback:string|null}) => c.feedback === "niet_goed").length : 0;
        const pct = (positief + negatief) > 0 ? Math.round((positief / (positief + negatief)) * 100) : 0;

        const actiefMedewerkers = profs ? profs.filter((p: {id:string}) => convs?.some((c: {user_id:string}) => c.user_id === p.id)).length : 0;
        const tijdBespaard = Math.round(totaalVragen * 8 / 60);
        const kostenBespaard = tijdBespaard * 35;

        console.log("[Terugblik] Data: vragen=" + totaalVragen + " positief=" + positief + " negatief=" + negatief);

        // Stap 3: Inhoud samenstellen
        const ontvangerNamen = metEmail.map((t: {naam:string; email:string}) => t.naam + " (" + t.email + ")");
        const teamNaam = body.team_filter || "Alle teams";

        const inhoud = JSON.stringify({
          maand: maand,
          team: teamNaam,
          statistieken: {
            totaal_vragen: totaalVragen,
            positief_feedback: positief,
            negatief_feedback: negatief,
            positief_percentage: pct,
            actieve_medewerkers: actiefMedewerkers,
            totaal_medewerkers: profs ? profs.length : 0,
          },
          tijdwinst: {
            uren: tijdBespaard,
            kosten_euro: kostenBespaard,
          },
          ontvangers: ontvangerNamen,
        });

        // Stap 4: Log opslaan met inhoud
        const status = body.is_test ? "test" : "verstuurd";
        await supabaseAdmin.from("terugblik_log").insert({
          tenant_id: profile.tenant_id,
          maand: maand,
          aantal_ontvangers: metEmail.length,
          status: status,
          inhoud: inhoud,
          ontvangers: ontvangerNamen,
          team: teamNaam,
        });

        console.log("[Terugblik] Klaar, ontvangers:", ontvangerNamen.join(", "));

        return new Response(
          JSON.stringify({
            success: true,
            aantal_ontvangers: metEmail.length,
            ontvangers: ontvangerNamen,
            maand: maand,
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
        return new Response(
          JSON.stringify({ error: "Niet geautoriseerd" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(body.update_user_id, {
          user_metadata: body.user_metadata || {},
        });

        if (updateErr) {
          console.error("[UpdateMeta] Fout:", updateErr.message);
          return new Response(
            JSON.stringify({ error: updateErr.message }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("[UpdateMeta] OK voor user:", body.update_user_id);
        return new Response(
          JSON.stringify({ updated: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("[UpdateMeta] Exception:", err);
        return new Response(
          JSON.stringify({ error: "Update mislukt" }),
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
      .select("naam, content, synoniemen, zoektermen")
      .eq("tenant_id", profile.tenant_id)
      .is("user_id", null)
      .not("content", "is", null);

    // ---- 6e. Persoonlijke documenten van deze medewerker ----
    const { data: persDocs } = await supabaseAdmin
      .from("documents")
      .select("naam, content, synoniemen, zoektermen")
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
        .map((d: { naam: string; content: string; synoniemen?: string[]; zoektermen?: string[] }) => {
          const lowerContent = d.content.toLowerCase();
          const lowerNaam = d.naam.toLowerCase();
          // Combineer auto-zoektermen + handmatige synoniemen (alles lowercase)
          const indexTerms: string[] = [
            ...((d.zoektermen || []) as string[]),
            ...((d.synoniemen || []) as string[]),
          ].map((t: string) => (t || "").toLowerCase()).filter((t: string) => t.length > 0);
          let score = 0;

          for (const kw of keywords) {
            // 1. Zoek in zoektermen/synoniemen (zwaarste bonus)
            for (const term of indexTerms) {
              if (term === kw || term.includes(kw) || kw.includes(term)) {
                score += 10;
              }
            }

            // 2. Zoek in documentinhoud
            let pos = 0;
            while ((pos = lowerContent.indexOf(kw, pos)) !== -1) { score++; pos += kw.length; }

            // 3. Bonus: zoek in documentnaam (zwaarder gewogen)
            if (lowerNaam.indexOf(kw) !== -1) { score += 5; }

            // 4. Stam-matching: als keyword > 4 tekens, zoek ook op de eerste 4+ letters
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
      .select("naam, titel, email, telefoon, teams, rol")
      .eq("tenant_id", profile.tenant_id);

    let teamleiderContext = "";
    if (teamleiders && teamleiders.length > 0) {
      // Stuur ALLE leidinggevenden mee met hun titel
      teamleiderContext = "--- LEIDINGGEVENDEN EN MANAGERS ---\n" +
        teamleiders.map((tl: { naam: string; titel: string; email: string; telefoon: string; teams: string[]; rol: string }) => {
          const label = tl.titel || (tl.rol === 'manager' ? 'Manager' : tl.rol === 'hr' ? 'HR Medewerker' : 'Teamleider');
          return `${label}: ${tl.naam}${tl.telefoon ? `, telefoon: ${tl.telefoon}` : ""}${tl.email ? `, email: ${tl.email}` : ""}${tl.teams && tl.teams.length > 0 ? `, teams: ${tl.teams.join(", ")}` : ""}`;
        }).join("\n");

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
        const directeLabel = directeTl.titel || (directeTl.rol === 'manager' ? 'Manager' : 'Teamleider');
        teamleiderContext += `\n\nDE DIRECTE LEIDINGGEVENDE VAN ${(profile.naam || "de medewerker").toUpperCase()} IS: ${directeLabel} ${directeTl.naam}${directeTl.telefoon ? ` (telefoon: ${directeTl.telefoon})` : ""}${directeTl.email ? ` (email: ${directeTl.email})` : ""}.`;
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
    // Inwerktraject alleen als expliciet aangevinkt (inwerktraject_actief === true) en niet afgerond
    const inwerkAfgerond = profile.inwerktraject_actief !== true || profile.inwerken_afgerond || wk > 6;
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

    // ---- 6i. Kennisnotities ophalen ----
    const { data: kennisnotities } = await supabaseAdmin
      .from("kennisnotities")
      .select("originele_vraag, notitie")
      .eq("tenant_id", profile.tenant_id)
      .eq("actief", true);

    let kennisnotitieContext = "";
    if (kennisnotities && kennisnotities.length > 0) {
      kennisnotitieContext = "--- KENNISNOTITIES VAN DE ORGANISATIE ---\n" +
        kennisnotities.map((kn: { originele_vraag: string; notitie: string }) =>
          `📝 Over "${kn.originele_vraag}": ${kn.notitie}`
        ).join("\n");
    }

    // Bronnen combineren
    const bronnen: string[] = [];
    if (documentContext) bronnen.push(documentContext);
    if (kennisbankContext) bronnen.push(kennisbankContext);
    if (kennisnotitieContext) bronnen.push(kennisnotitieContext);
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
- Bij vragen over het eigen profiel (werkuren, team, teamleider, startdatum): gebruik de persoonlijke gegevens om DIRECT antwoord te geven.
- Als het antwoord niet in de kennisbronnen staat, zeg dat eerlijk en verwijs naar de teamleider.
- Pas je antwoorden aan op de functiegroep van de medewerker.
- Houd antwoorden beknopt en praktisch. Gebruik opsommingstekens waar handig. Gebruik **vetgedrukte kopjes**.
- FORMATTING: Gebruik NOOIT lege regels tussen gewone zinnen. Bullets alleen bij echte opsommingen. GEEN lege regel tussen bullets.
- Verwerk NOOIT persoonsgegevens van cliënten.
- Als er een PERSOONLIJK INWERKTRAJECT sectie staat, gebruik die als eerste bron.
- BELANGRIJK: Als je een URL vindt in de kennisbronnen die relevant is, plak die DIRECT in je antwoord: 👉 [de volledige URL]. Verzin NOOIT zelf een URL.
- Als de medewerker vraagt naar zijn/haar teamleider: geef direct de naam en het telefoonnummer.
- ONZEKERHEID: Als je niet volledig zeker bent, zeg dit expliciet. Verzin NOOIT informatie.

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

    // ---- 9b. Kennishiaat detectie ----
    if (antwoord.includes("ℹ️") && antwoord.includes("Niet gevonden in organisatie-documenten")) {
      console.log("[Chat] Kennishiaat gedetecteerd voor vraag:", vraag.substring(0, 80));
      try {
        await supabaseAdmin.from("kenniskloof_meldingen").insert({
          tenant_id: profile.tenant_id,
          onderwerp: vraag.trim().substring(0, 200),
          aantal_vragen: 1,
        });
      } catch { /* kenniskloof tabel bestaat mogelijk niet */ }
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
