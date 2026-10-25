// Zorgwekkende onderwerpen voor de patroonmelding aan de teamleider (H1, termenlijst
// akkoord Younes 2026-10-25).
// Voorheen een lijst met includes(): 'nood' pakte 'noodzakelijk', 'slaan' pakte 'opslaan'
// en 'overslaan'. Nu hele woorden of woordstammen met woordgrenzen (geen letter ervoor of
// erna), zoals in zorginhoud.ts. Weggelaten op verzoek: 'dreig*' ("er dreigt een tekort"),
// 'nood' ("nood in de familie") en 'levenseinde' (palliatieve zorg).
// Getest met: node --test tests/*.test.js

import { accountVerlopen } from "./chattoegang.ts";

const L ="\\p{L}*";

export const ZORGWEKKEND_PER_ONDERWERP: Record<string, string[]> = {
  "agressie": [
    "agressi" + L, "geweld" + L, "slaan", "slaat", "sloeg", "geslagen", "schopt", "schoppen",
    "mishandel" + L, "bedreig" + L, "dreiging" + L, "handtastelijk" + L,
  ],
  "crisissituaties": ["crisis" + L, "noodsituatie" + L, "noodgeval" + L],
  "suïcidaliteit": ["su[iï]cid" + L, "zelfdoding" + L, "zelfmoord" + L, "doodswens", "niet meer (?:willen )?leven"],
};

function patroon(termen: string[]): RegExp {
  return new RegExp("(?<![\\p{L}])(?:" + termen.join("|") + ")(?![\\p{L}])", "iu");
}

const PATRONEN: Array<[string, RegExp]> = Object.entries(ZORGWEKKEND_PER_ONDERWERP).map(([o, t]) => [o, patroon(t)]);

// De onderwerpen die in de tekst voorkomen, in vaste volgorde (agressie, crisis, suïcide).
export function zorgwekkendeOnderwerpen(tekst: string | null | undefined): string[] {
  const t = String(tekst ?? "");
  return PATRONEN.filter(([, re]) => re.test(t)).map(([o]) => o);
}

export function isZorgwekkend(tekst: string | null | undefined): boolean {
  return zorgwekkendeOnderwerpen(tekst).length > 0;
}

// ---- H3 (voorstel A, akkoord Younes 2026-10-25): wie telt mee en wanneer een melding ----
// - Mee tellen alleen medewerkers (role 'medewerker', geen alleen_dashboard) die minstens
//   één keer hebben ingelogd en waarvan de einddatum niet verlopen is. Leidinggevenden,
//   beheerders en nooit gebruikte accounts tellen niet.
// - Drempel 5 per groep. De groep is het team; is dat kleiner, dan alle teams van de
//   teamleider(s) van dat team samen ("in jouw teams"). Anders geen melding.
// - Melding bij minstens 3 zorgwekkende vragen deze week van minstens 2 verschillende
//   medewerkers, zodat één persoon niet in z'n eentje een melding veroorzaakt.
// - De week begint op maandag 00:00 Nederlandse tijd.

export const MIN_ACTIEVE_MEDEWERKERS = 5;
export const MIN_ZORGWEKKENDE_VRAGEN = 3;
export const MIN_VERSCHILLENDE_MEDEWERKERS = 2;

export type DrempelProfiel = {
  id: string; role: string | null; alleen_dashboard?: boolean | null; teams: string[] | null;
  eerste_login_op?: string | null; laatste_actief?: string | null; einddatum?: string | null;
};

export function teltVoorDrempel(p: DrempelProfiel, nu: Date = new Date()): boolean {
  return p.role === "medewerker" && p.alleen_dashboard !== true
    && !!(p.eerste_login_op || p.laatste_actief) && !accountVerlopen(p.einddatum, nu);
}

// Teams van de groep voor deze melding. teamleiderTeams: per teamleider-rij (rol
// 'teamleider') de teams. Geeft null als ook de grotere groep te klein is.
export function kiesGroep(
  team: string, teamleiderTeams: Array<string[] | null>, profielen: DrempelProfiel[], vraagstellerId: string, nu: Date = new Date(),
): { teams: string[]; leden: string[]; samengevoegd: boolean } | null {
  const ledenVan = (teams: string[]) => profielen
    .filter((p) => (p.id === vraagstellerId || teltVoorDrempel(p, nu)) && Array.isArray(p.teams) && p.teams.some((t) => teams.includes(t)))
    .map((p) => p.id);
  const eigen = ledenVan([team]);
  if (eigen.length >= MIN_ACTIEVE_MEDEWERKERS) return { teams: [team], leden: eigen, samengevoegd: false };
  const breed = new Set<string>([team]);
  for (const t of teamleiderTeams) if (Array.isArray(t) && t.includes(team)) t.forEach((x) => breed.add(x));
  if (breed.size === 1) return null;
  const teams = [...breed].sort();
  const leden = ledenVan(teams);
  return leden.length >= MIN_ACTIEVE_MEDEWERKERS ? { teams, leden, samengevoegd: true } : null;
}

// weekVragen: opgeslagen vragen van de groepsleden deze week (zonder de huidige vraag).
export function meldingNodig(weekVragen: Array<{ user_id: string | null; vraag: string | null }>, vraagstellerId: string): boolean {
  const zorg = weekVragen.filter((c) => c.user_id && isZorgwekkend(c.vraag));
  const personen = new Set(zorg.map((c) => c.user_id as string));
  personen.add(vraagstellerId);
  return zorg.length + 1 >= MIN_ZORGWEKKENDE_VRAGEN && personen.size >= MIN_VERSCHILLENDE_MEDEWERKERS;
}

// Maandag 00:00 Nederlandse tijd van de week van 'nu', als tijdstip.
export function weekBeginNl(nu: Date = new Date()): Date {
  const delen = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const nl = delen(nu);
  const dagIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(nl.weekday);
  const maandagUtc = Date.UTC(Number(nl.year), Number(nl.month) - 1, Number(nl.day) - dagIndex);
  // Verschil tussen NL-kloktijd en UTC rond dat moment (1 of 2 uur).
  let tijd = maandagUtc;
  for (let i = 0; i < 2; i++) {
    const k = delen(new Date(tijd));
    const klok = Date.UTC(Number(k.year), Number(k.month) - 1, Number(k.day), Number(k.hour), Number(k.minute));
    tijd = maandagUtc - (klok - tijd);
  }
  return new Date(tijd);
}
