// Onderwerp en HTML van de beheerdersmails (admin-notificatie).
// Alle ingevoerde tekst (naam, e-mail, vraag, ...) komt van gebruikers en wordt
// ge-escaped, zodat <b>, <script> of links niet als HTML in de mail belanden.
// Getest met: node --test tests/*.test.js

export function escapeHtml(waarde: unknown): string {
  return String(waarde ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Onderwerp is platte tekst: geen regeleinden, beperkte lengte.
function onderwerpTekst(waarde: unknown): string {
  return String(waarde ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

export interface Notificatie {
  type?: string;
  naam?: string;
  email?: string;
  verzoek_type?: string;
  medewerker_naam?: string;
  datum?: string;
  vraag?: string;
}

const LINK = '<a href="https://app.mijnwegwijzer.com/admin.html">admin dashboard</a>';

export function bouwMail(n: Notificatie): { subject: string; html: string } | null {
  const e = (v: unknown) => escapeHtml(v || "-");
  if (n.type === "privacy_verzoek") {
    return {
      subject: `Nieuw privacyverzoek van ${onderwerpTekst(n.naam) || "onbekend"}`,
      html: `<p>Er is een nieuw privacyverzoek ontvangen in Wegwijzer.</p>
        <p><strong>Naam:</strong> ${e(n.naam)}<br>
        <strong>Email:</strong> ${e(n.email)}<br>
        <strong>Type:</strong> ${e(n.verzoek_type)}</p>
        <p>Ga naar het ${LINK} om het verzoek te behandelen.</p>`,
    };
  }
  if (n.type === "document_aanvraag") {
    return {
      subject: "Nieuwe documentaanvraag in Wegwijzer",
      html: `<p>Er is een nieuwe documentaanvraag ontvangen.</p>
        <p><strong>Vraag:</strong> ${e(n.vraag)}</p>
        <p>Ga naar het ${LINK} om de aanvraag te beoordelen.</p>`,
    };
  }
  // Type heet 'eerste_login', maar de chatfunctie stuurt hem bij de eerste vraag.
  if (n.type === "eerste_login") {
    return {
      subject: `${onderwerpTekst(n.medewerker_naam) || "Een medewerker"} heeft de eerste vraag aan Wegwijzer gesteld`,
      html: `<p><strong>${e(n.medewerker_naam)}</strong> heeft op <strong>${e(n.datum)}</strong> de eerste vraag aan Wegwijzer gesteld.</p>`,
    };
  }
  return null;
}
