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
