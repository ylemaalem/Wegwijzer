// Periodekeuze voor de trendanalyse in het dashboard.
// Getest met: node --test tests/*.test.js

export const TREND_PERIODES = ["30d", "3m", "6m", "alles"] as const;
export type TrendPeriode = typeof TREND_PERIODES[number];

export function leesPeriode(waarde: unknown): TrendPeriode {
  return (TREND_PERIODES as readonly string[]).includes(waarde as string) ? waarde as TrendPeriode : "30d";
}

// Begin van de periode (null = alles).
export function periodeSinds(periode: TrendPeriode, nu: Date): Date | null {
  const d = new Date(nu.getTime());
  if (periode === "30d") { d.setDate(d.getDate() - 30); return d; }
  if (periode === "3m") { d.setMonth(d.getMonth() - 3); return d; }
  if (periode === "6m") { d.setMonth(d.getMonth() - 6); return d; }
  return null;
}

// "de afgelopen 30 dagen" enz., voor meldingen en de prompt.
export function periodeTekst(periode: TrendPeriode): string {
  return { "30d": "de afgelopen 30 dagen", "3m": "de afgelopen 3 maanden", "6m": "de afgelopen 6 maanden", "alles": "sinds het begin" }[periode];
}

// Meer vragen dan max: neem ze gelijkmatig verspreid over de lijst (die op datum
// gesorteerd is), zodat een lange periode niet alleen uit de laatste weken bestaat.
export function spreidVragen<T>(vragen: T[], max: number): T[] {
  if (vragen.length <= max) return vragen;
  const stap = vragen.length / max;
  return Array.from({ length: max }, (_, i) => vragen[Math.floor(i * stap)]);
}

// Startdatum live (instelling per organisatie: settings.startdatum_live, "JJJJ-MM-DD").
// Het dashboard telt alleen gesprekken vanaf het begin van die dag (Nederlandse tijd).
// Leeg of ongeldig = alles tonen. Er wordt niets verwijderd.
export function leesStartdatumLive(waarde: unknown): Date | null {
  if (typeof waarde !== "string") return null;
  const w = waarde.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(utc);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  // Middernacht in Amsterdam = middernacht UTC min de tijdverschuiving van die dag.
  return new Date(utc - amsterdamVerschilMinuten(new Date(utc + 12 * 3600000)) * 60000);
}

function amsterdamVerschilMinuten(d: Date): number {
  const delen = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(delen.find((x) => x.type === t)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(d.getTime() / 60000) * 60000) / 60000;
}

// De laatste van twee begindatums (null = geen grens).
export function laatsteBegin(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// "1 november 2026"
export function datumTekst(d: Date): string {
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}
