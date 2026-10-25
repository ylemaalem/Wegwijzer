import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Account verwijderen (D3, migratie 109, akkoord Younes 2026-10-25).
// De database doet alles in één transactie (verwijder_account): controle (beheerder, eigen
// organisatie, niet het eigen account), de keuze bij een leidinggevende, gesprekken
// loskoppelen (uit_dienst) of de tekst wissen (avg), het profiel verwijderen en de
// auditregel. Daarna verwijdert deze functie het inlogaccount.
// Body: { profile_id, modus?: 'uit_dienst' | 'avg', leidinggevende?: 'chattoegang_uit' | 'ook_leidinggevende' }
// Antwoord: { deleted: true } | { keuze_nodig: true, leidinggevende_rol, naam } |
//           { deleted: false, chattoegang_uit: true } | { error }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function antwoord(inhoud: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(inhoud), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Controleer aanroeper via JWT
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) return antwoord({ error: "Niet ingelogd" }, 401);

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return antwoord({ error: "Ongeldig verzoek", deleted: false }, 400);
  }
  const profielId = typeof body.profile_id === "string" ? body.profile_id : null;
  const modus = body.modus === "avg" ? "avg" : "uit_dienst";
  const leidinggevende = body.leidinggevende === "chattoegang_uit" || body.leidinggevende === "ook_leidinggevende"
    ? body.leidinggevende : null;
  if (!profielId) return antwoord({ error: "profile_id is verplicht", deleted: false }, 400);

  const { data: uitkomst, error: rpcFout } = await supabaseAdmin.rpc("verwijder_account", {
    p_beller: user.id, p_profiel: profielId, p_modus: modus, p_leidinggevende: leidinggevende,
  });
  if (rpcFout) {
    console.error("[VerwijderGebruiker] verwijder_account mislukt:", rpcFout.message);
    return antwoord({ error: "Verwijderen mislukt: " + rpcFout.message + ". Er is niets verwijderd.", deleted: false }, 500);
  }
  const u = (uitkomst || {}) as Record<string, unknown>;
  if (u.fout) {
    console.warn("[VerwijderGebruiker] Geweigerd:", u.fout, "profiel:", profielId, "door:", user.id);
    return antwoord({ error: u.fout, deleted: false }, 403);
  }
  if (u.keuze_nodig) {
    return antwoord({ keuze_nodig: true, leidinggevende_rol: u.leidinggevende_rol, naam: u.naam, deleted: false });
  }
  if (u.actie === "chattoegang_uit") {
    return antwoord({ deleted: false, chattoegang_uit: true });
  }

  // Profiel is weg; nu het inlogaccount (cascade: scores, quiz, briefings, cache).
  const doelUser = typeof u.user_id === "string" ? u.user_id : null;
  if (doelUser) {
    const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(doelUser);
    if (delError) {
      console.error("[VerwijderGebruiker] Auth delete fout:", delError.message);
      return antwoord({
        deleted: true, auth_fout: delError.message, gesprekken: u.gesprekken, modus,
        error: "Het profiel is verwijderd, maar het inlogaccount niet: " + delError.message + ". Probeer het opnieuw of meld het.",
      });
    }
  }
  console.log("[VerwijderGebruiker] Verwijderd:", profielId, "modus:", modus);
  return antwoord({ deleted: true, gesprekken: u.gesprekken, modus });
});
