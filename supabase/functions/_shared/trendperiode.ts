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
