// Documenten per team: relevantie in de chat (migratie 114, 2026-10-27).
// documents.teams leeg = voor iedereen. Met teams: alleen voor wie minstens één van die
// teams heeft. Dit is GEEN afscherming (RLS blijft gelijk); het bepaalt alleen welke
// documenten de chat voor deze medewerker gebruikt.
// - Medewerker: de teams op het profiel (alle teams tellen mee).
// - Leidinggevende (profiles.role 'teamleider'): de rij in teamleiders, op e-mail, net
//   als het teamleiderdashboard (js/teamleider.js, bepaalDashboardRol). rol 'hr' of
//   'manager' (MT) = alles; anders de teams in die rij plus de eigen profielteams.
// - Beheerder: alles.
// - Noemt de vraag zelf een team van een document (bijv. "Gele Weiland"), dan doet dat
//   document toch mee. Teamnamen vergelijken zonder "Team " en zonder hoofdletters.
// Getest met: node --test tests/*.test.js
import { woorden } from "./synoniemzoek.ts";

export type TeamBereik = { alles: boolean; teams: string[] };
export type DocTeams = { id: string; teams?: string[] | null };

// "Team Gele Weiland" -> "gele weiland"; "Team VAN" -> "van".
export function teamSleutel(team: string | null | undefined): string {
  return woorden(String(team ?? "").replace(/^\s*team\s+/i, "")).join(" ");
}

export function teamBereik(
  profielRol: string | null | undefined,
  profielTeams: string[] | null | undefined,
  leidinggevendeRij: { rol: string | null; teams: string[] | null } | null,
): TeamBereik {
  if (profielRol === "admin" || profielRol === "superadmin") return { alles: true, teams: [] };
  const eigen = profielTeams || [];
  if (profielRol === "teamleider" && leidinggevendeRij) {
    if (leidinggevendeRij.rol === "hr" || leidinggevendeRij.rol === "manager") return { alles: true, teams: [] };
    return { alles: false, teams: uniek([...eigen, ...(leidinggevendeRij.teams || [])]) };
  }
  return { alles: false, teams: uniek(eigen) };
}

function uniek(teams: string[]): string[] {
  return [...new Set(teams.map(teamSleutel).filter(Boolean))];
}

// Noemt de vraag dit team duidelijk? Hele woorden, in volgorde. Een korte naam van één
// woord (VAN, FAN, FANMN) is vaak ook een gewoon woord ("van", ook in "het team van"):
// die telt alleen in hoofdletters zoals geschreven ("VAN", "FANMN" of "FAN MN"), en niet
// als er nog een afkorting in hoofdletters op volgt ("FAN MN" is niet "FAN").
export function teamGenoemd(vraag: string | null | undefined, team: string): boolean {
  const sleutel = teamSleutel(team).split(" ").filter(Boolean);
  if (sleutel.length === 0) return false;
  if (sleutel.length === 1 && sleutel[0].length <= 5) {
    const naam = sleutel[0].toUpperCase();
    const t = String(vraag ?? "").split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
    const afkorting = (w: string | undefined) => !!w && /^[\p{Lu}\p{N}]{2,}$/u.test(w);
    for (let i = 0; i < t.length; i++) {
      if (t[i] === naam && !afkorting(t[i + 1])) return true;
      if (afkorting(t[i]) && afkorting(t[i + 1]) && t[i] + t[i + 1] === naam) return true;
    }
    return false;
  }
  return bevat(woorden(vraag), sleutel);
}

function bevat(vw: string[], reeks: string[]): boolean {
  for (let i = 0; i + reeks.length <= vw.length; i++) {
    if (reeks.every((w, j) => vw[i + j] === w)) return true;
  }
  return false;
}

// Document-ids die voor deze medewerker en deze vraag niet meedoen.
export function uitgeslotenDocumenten(docs: DocTeams[], bereik: TeamBereik, vraag: string | null | undefined): string[] {
  if (bereik.alles) return [];
  const eigen = new Set(bereik.teams);
  return docs
    .filter((d) => Array.isArray(d.teams) && d.teams.length > 0)
    .filter((d) => !d.teams!.some((t) => eigen.has(teamSleutel(t))))
    .filter((d) => !d.teams!.some((t) => teamGenoemd(vraag, t)))
    .map((d) => d.id);
}

// Deel van de cachesleutel: dezelfde vraag met een ander teambereik of andere uitgesloten
// documenten (de naamsvermelding hangt af van hoofdletters, de cache niet) is een ander antwoord.
export function teamBereikSleutel(bereik: TeamBereik, uitsluiten: string[] = []): string {
  const b = bereik.alles ? "alles" : [...bereik.teams].sort().join("|") || "geen";
  return uitsluiten.length > 0 ? `${b}#${[...uitsluiten].sort().join(",")}` : b;
}
