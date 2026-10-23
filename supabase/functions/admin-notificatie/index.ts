import { bouwMail } from "./mail.ts";

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
    // Ingevoerde tekst wordt in mail.ts ge-escaped (geen HTML van gebruikers in de mail).
    const mail = bouwMail(body);
    if (!mail) {
      return new Response(JSON.stringify({ error: "Onbekend notificatie type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { subject, html } = mail;

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
