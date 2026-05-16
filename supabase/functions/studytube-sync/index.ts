import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const STUDYTUBE_OAUTH_URL = "https://backend.studytube.nl/gateway/oauth/token";
const STUDYTUBE_COURSES_URL = "https://public-api.studytube.nl/api/v2/courses";
const STUDYTUBE_DEEPLINK_BASE = "https://app.studytube.nl/nl/courses";

const STOPWOORDEN = new Set([
  "de", "het", "een", "en", "in", "van", "voor", "met", "op", "aan", "bij",
  "uit", "over", "naar", "als", "je", "zijn", "is", "dat", "te", "om", "hoe",
  "wat", "wie", "er", "zo", "of", "maar", "ook", "al", "dan", "nog", "door",
]);

function genereerTrefwoorden(cursusnaam: string): string[] {
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
  const clientId = Deno.env.get("STUDYTUBE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("STUDYTUBE_CLIENT_SECRET")!;

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

    // ── 3. Trefwoorden genereren uit cursusnaam (snel, geen externe API) ──
    const keywordMap = new Map<number, string[]>();
    for (const course of allCourses) {
      keywordMap.set(course.id, genereerTrefwoorden(course.name));
    }

    // ── 4. Upsert in studytube_cursussen ──
    const rows = allCourses.map((c) => ({
      tenant_id: tenantId,
      studytube_course_id: String(c.id),
      naam: c.name,
      duur_minuten: c.duration ? Math.round(c.duration / 60) : null,
      deeplink_url: `${STUDYTUBE_DEEPLINK_BASE}/${c.id}`,
      trefwoorden: keywordMap.get(c.id) || [],
      laatst_gesynchroniseerd: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabaseAdmin
      .from("studytube_cursussen")
      .upsert(rows, { onConflict: "tenant_id,studytube_course_id" });

    if (upsertErr) {
      return new Response(JSON.stringify({ error: "Upsert mislukt: " + upsertErr.message }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ cursussen_gesynchroniseerd: allCourses.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[StudyTube Sync] Fout:", err);
    return new Response(JSON.stringify({ error: "Synchronisatie mislukt: " + String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
