import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

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
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Niet ingelogd" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // Controleer of aanroeper admin is
  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return new Response(JSON.stringify({ error: "Alleen admins kunnen gebruikers verwijderen" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { user_id, profile_id } = body;

  if (!user_id) {
    return new Response(JSON.stringify({ error: "user_id is verplicht" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verwijder profiel (cascade verwijdert conversations)
  if (profile_id) {
    await supabaseAdmin.from("profiles").delete().eq("id", profile_id);
  } else {
    await supabaseAdmin.from("profiles").delete().eq("user_id", user_id);
  }

  // Verwijder auth gebruiker permanent
  const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
  if (delError) {
    console.error("[VerwijderGebruiker] Auth delete fout:", delError.message);
    return new Response(JSON.stringify({ error: delError.message, deleted: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[VerwijderGebruiker] Gebruiker verwijderd:", user_id);
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
