// Wie mag een leidinggevende in het dashboard volgen (anonieme statistieken en
// trendanalyse)? Alle leidinggevenden hebben profiles.role 'teamleider'; het
// onderscheid staat in teamleiders.rol.
// - teamleider: medewerkers met minstens één gedeeld team;
// - manager, hr en admin: alle medewerkers van de organisatie.
// Het eigen profiel telt nooit mee.
// Getest met: node --test tests/*.test.js

export type DashboardRolNaam = "admin" | "teamleider" | "manager" | "hr";

export interface DashboardRol {
  rol: DashboardRolNaam;
  teams: string[];
}

// profielRol: profiles.role; rijRol/rijTeams: de teamleiders-rij (of null).
export function normaliseerDashboardRol(
  profielRol: string | null,
  rij: { rol: string | null; teams: string[] | null } | null,
): DashboardRol {
  if (profielRol === "admin") return { rol: "admin", teams: [] };
  const rol: DashboardRolNaam = rij?.rol === "manager" || rij?.rol === "hr" ? rij.rol : "teamleider";
  return { rol, teams: rij?.teams || [] };
}

export function kiesMonitorIds(
  dashboardRol: DashboardRol,
  medewerkers: Array<{ id: string; teams: string[] | null }>,
  eigenProfielId: string,
): string[] {
  const zichtbaar = dashboardRol.rol === "teamleider"
    ? medewerkers.filter((m) => Array.isArray(m.teams) && m.teams.some((t) => dashboardRol.teams.includes(t)))
    : medewerkers;
  return zichtbaar.map((m) => m.id).filter((id) => id !== eigenProfielId);
}

// D3 (migratie 109): gesprekken van een verwijderd account hebben geen user_id meer
// (losgekoppeld). Ze horen bij geen team meer, dus alleen een organisatiebreed bereik
// (manager, hr, admin) telt ze mee; een teamleider ziet ze niet.
export function telLosgekoppeldMee(dashboardRol: DashboardRol): boolean {
  return dashboardRol.rol !== "teamleider";
}

// PostgREST-filter: user_id in de lijst, plus (organisatiebreed) user_id leeg.
export function gebruikerFilter(ids: string[], metLosgekoppeld: boolean): string {
  const lijst = `user_id.in.(${ids.join(",")})`;
  return metLosgekoppeld ? `${lijst},user_id.is.null` : lijst;
}

export function bereikTekst(dashboardRol: DashboardRol): string {
  return dashboardRol.rol === "teamleider" ? "binnen jouw team" : "binnen de hele organisatie";
}
