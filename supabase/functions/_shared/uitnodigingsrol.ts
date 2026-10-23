// Welke rol krijgt een account bij (opnieuw) uitnodigen?
//
// Bron van waarheid voor leidinggevenden is de tabel teamleiders: staat het
// e-mailadres daar in de eigen organisatie, dan is de rol in profiles 'teamleider'
// (teamleider, manager en HR; het onderscheid staat in teamleiders.rol). Zonder
// rij geeft role 'teamleider' geen rechten (migratie 096).
// Een beheerder wordt nooit teruggezet.
//
// Bug 2026-10-23: 📨 opnieuw versturen nam de rol uit een bestaand profiel en viel
// zonder profiel terug op 'medewerker', ook als er een rij in teamleiders stond.
// Getest met: node --test tests/*.test.js

export interface LeidinggevendeRij {
  id: string;
  email: string | null;
  rol?: string | null;
}

// Gelijk aan profiles_role_check en de CHECK op uitnodigingen.role (migratie 083).
export const TOEGESTANE_UITNODIGINGSROLLEN = ["medewerker", "teamleider", "admin"];

function normaalEmail(e: string | null | undefined): string {
  return String(e ?? "").trim().toLowerCase();
}

// De rij in teamleiders bij dit e-mailadres (exact, zonder hoofdletters/spaties),
// of null. Exact vergelijken, niet met ilike: '_' en '%' zijn daar jokers.
export function zoekLeidinggevendeRij(rijen: LeidinggevendeRij[], email: string): LeidinggevendeRij | null {
  const doel = normaalEmail(email);
  if (!doel) return null;
  return rijen.find((r) => normaalEmail(r.email) === doel) ?? null;
}

// gevraagdeRol: wat het beheerscherm meestuurt (alleen bij een eerste uitnodiging).
// profielRol: de rol van een bestaand profiel (bij opnieuw versturen).
export function bepaalUitnodigingsrol(opties: {
  heeftLeidinggevendeRij: boolean;
  gevraagdeRol?: string | null;
  profielRol?: string | null;
}): string {
  const { heeftLeidinggevendeRij, gevraagdeRol, profielRol } = opties;
  if (gevraagdeRol === "admin" || profielRol === "admin") return "admin";
  if (heeftLeidinggevendeRij) return "teamleider";
  const kandidaat = gevraagdeRol || profielRol || "medewerker";
  return TOEGESTANE_UITNODIGINGSROLLEN.includes(kandidaat) ? kandidaat : "medewerker";
}

// Moet een bestaand profiel van de eigen organisatie naar 'teamleider'? Alleen een
// 'medewerker' met een rij in teamleiders; nooit een beheerder.
export function moetRolHerstellen(profielRol: string | null | undefined, heeftLeidinggevendeRij: boolean): boolean {
  return heeftLeidinggevendeRij && (profielRol ?? "medewerker") === "medewerker";
}
