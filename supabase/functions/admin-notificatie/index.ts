import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("ADMIN_WEBHOOK_SECRET") || "";
  const incomingSecret = req.headers.get("x-webhook-secret") || "";

  if (!webhookSecret || incomingSecret !== webhookSecret) {
    return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY niet geconfigureerd" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { type, naam, email, verzoek_type, medewerker_naam, datum, vraag } = body;

    let subject = "";
    let html = "";

    if (type === "privacy_verzoek") {
      subject = `Nieuw privacyverzoek van ${naam || "onbekend"}`;
      html = `<p>Er is een nieuw privacyverzoek ontvangen in Wegwijzer.</p>
        <p><strong>Naam:</strong> ${naam || "-"}<br>
        <strong>Email:</strong> ${email || "-"}<br>
        <strong>Type:</strong> ${verzoek_type || "-"}</p>
        <p>Ga naar het <a href="https://app.mijnwegwijzer.com/admin.html">admin dashboard</a> om het verzoek te behandelen.</p>`;
    } else if (type === "document_aanvraag") {
      subject = "Nieuwe documentaanvraag in Wegwijzer";
      html = `<p>Er is een nieuwe documentaanvraag ontvangen.</p>
        <p><strong>Vraag:</strong> ${vraag || "-"}</p>
        <p>Ga naar het <a href="https://app.mijnwegwijzer.com/admin.html">admin dashboard</a> om de aanvraag te beoordelen.</p>`;
    } else if (type === "eerste_login") {
      subject = `Medewerker ${medewerker_naam || ""} heeft Wegwijzer voor het eerst gebruikt`;
      html = `<p>Medewerker <strong>${medewerker_naam || "-"}</strong> heeft Wegwijzer voor het eerst gebruikt op <strong>${datum || "-"}</strong>.</p>`;
    } else {
      return new Response(JSON.stringify({ error: "Onbekend notificatie type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "Wegwijzer <notificaties@mijnwegwijzer.com>",
        to: ["info@mijnwegwijzer.com"],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("[Admin-notificatie] Resend fout:", errText);
      return new Response(JSON.stringify({ error: "Email versturen mislukt", detail: errText }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Admin-notificatie] Exception:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
