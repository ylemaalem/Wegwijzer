// Accounts met alleen het dashboard (D2, migratie 108, akkoord Younes 2026-10-25).
// profiles.alleen_dashboard = true: geen kennisassistent. De chatfunctie weigert alles
// na de dashboardroutes (teamleden, gespreksgegevens, Naam inzien, trendanalyse) met 403:
// vragen, briefing, quiz, tips, documentconcept, rolwissel en de PDF-extractie.
// De testmodus gebruikt een nagebootst profiel en valt erbuiten.
// Getest met: node --test tests/*.test.js

export const ALLEEN_DASHBOARD_MELDING =
  "Dit account heeft alleen toegang tot het dashboard, niet tot de kennisassistent.";

export function alleenDashboardGeweigerd(profiel: { alleen_dashboard?: unknown; role?: unknown } | null | undefined, isTest: boolean): boolean {
  if (isTest || !profiel) return false;
  return profiel.alleen_dashboard === true && profiel.role !== "admin";
}

// Wat de beheerder mag meesturen bij een uitnodiging: alleen voor role 'teamleider'.
export function uitnodigingAlleenDashboard(gevraagd: unknown, rol: string): boolean {
  return gevraagd === true && rol === "teamleider";
}

// Einddatum (F keuze 8, 2026-10-25): gelijk aan de factuur. Geldt voor vaste én tijdelijke
// accounts; de laatste dag heeft de hele dag toegang, in Nederlandse tijd. Voorheen alleen
// bij 'tijdelijk' en vergeleken met middernacht UTC (laatste dag vanaf 02:00 verlopen).
export function vandaagNl(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(nu);
}

export function accountVerlopen(einddatum: unknown, nu: Date = new Date()): boolean {
  if (einddatum == null || einddatum === "") return false;
  const dag = String(einddatum).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) return false;
  return dag < vandaagNl(nu);
}
