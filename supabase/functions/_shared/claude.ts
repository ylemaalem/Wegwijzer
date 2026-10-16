// =============================================
// Claude-model — één centrale instelling
// Alle aanroepen naar Claude (functies chat en studytube-sync) gebruiken
// dit model. Omzetten of terugschakelen = alleen deze regel aanpassen en
// daarna beide functies opnieuw deployen.
// =============================================
export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// Leest de antwoordtekst uit een Claude-antwoord op soort ("text") in plaats
// van op positie. Nieuwere modellen zetten eerst een denkblok vóór de tekst;
// bij Haiku 4.5 is het eerste blok altijd de tekst, dus daar is de uitkomst
// gelijk aan content[0].text. Geen tekst → "" (de aanroeper kiest de terugval).
export function claudeTekst(antwoord: { content?: unknown } | null | undefined): string {
  const blokken = Array.isArray(antwoord?.content) ? antwoord!.content as Array<{ type?: string; text?: unknown }> : [];
  return blokken
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

// Soorten aanroepen, elk met eigen instellingen voor modellen die eerst
// nadenken (adaptief denken, zoals Haiku 5.5):
//   hoofdantwoord — het chatantwoord: effort "medium", ruime lengtegrens
//   tekst  — teksten voor gebruikers (weekbrief, quiz, tips, rolwissel,
//            trendanalyse): effort "low", ruimte voor denken
//   hulp   — interne hulpaanroepen (zoektermen, feiten-extractie, kennisscan,
//            StudyTube-beschrijvingen): denken uit, effort "low", grens x1,5
//   ja_nee — korte keuzes (trainingsuggesties): denken uit, ruimere grens
//   pdf    — tekst uit een PDF halen: denken uit, grens 16.000
export type ClaudeSoort = "hoofdantwoord" | "tekst" | "hulp" | "ja_nee" | "pdf";

// Modellen die standaard eerst nadenken. Bij deze modellen tellen de
// denkstappen mee in max_tokens en gebruikt de API "effort".
const MODELLEN_MET_DENKEN = ["claude-haiku-5-5"];

export function denktStandaard(model: string): boolean {
  return MODELLEN_MET_DENKEN.includes(model);
}

// Past de body van een Messages-aanroep aan voor het gekozen model. Voor
// modellen zonder standaard denken (Haiku 4.5) komt de body ongewijzigd terug.
// effortHoofdantwoord overschrijft alleen de effort van het hoofdantwoord.
export function claudeVerzoek(
  model: string,
  soort: ClaudeSoort,
  body: Record<string, unknown>,
  effortHoofdantwoord?: string | null,
): Record<string, unknown> {
  if (!denktStandaard(model)) return body;
  const max = Number(body.max_tokens) || 1024;
  const uit: Record<string, unknown> = { ...body, model };
  // Haiku 5.5 weigert temperature/top_p/top_k met een afwijkende waarde.
  delete uit.temperature; delete uit.top_p; delete uit.top_k;
  switch (soort) {
    case "hoofdantwoord":
      return { ...uit, max_tokens: Math.max(max, 8000), output_config: { effort: effortHoofdantwoord || "medium" } };
    case "tekst":
      return { ...uit, max_tokens: max + 4000, output_config: { effort: "low" } };
    case "hulp":
      return { ...uit, max_tokens: Math.ceil(max * 1.5), thinking: { type: "disabled" }, output_config: { effort: "low" } };
    case "ja_nee":
      return { ...uit, max_tokens: Math.max(max * 3, 16), thinking: { type: "disabled" }, output_config: { effort: "low" } };
    case "pdf":
      return { ...uit, max_tokens: Math.max(max, 16000), thinking: { type: "disabled" }, output_config: { effort: "low" } };
  }
}

// Prijzen in dollar per miljoen tokens (platform.claude.com/docs/en/about-claude/pricing,
// oktober 2026). Haiku 5.5 kent een hoger tarief voor aanvragen boven 100.000 invoertokens.
const PRIJZEN: Record<string, { invoer: number; uitvoer: number; grens?: number; invoerBoven?: number; uitvoerBoven?: number }> = {
  "claude-haiku-4-5-20251001": { invoer: 1.0, uitvoer: 5.0 },
  "claude-haiku-5-5": { invoer: 0.10, uitvoer: 0.50, grens: 100_000, invoerBoven: 0.50, uitvoerBoven: 2.50 },
};

// Kosten in dollar van één aanroep, op basis van het gebruikte model en de
// werkelijk verbruikte tokens (bij Haiku 5.5 inclusief de denkstappen).
export function claudeKosten(model: string, usage: { input_tokens?: number; output_tokens?: number } | undefined): number {
  const p = PRIJZEN[model];
  if (!p || !usage) return 0;
  const invoer = usage.input_tokens || 0;
  const boven = p.grens !== undefined && invoer > p.grens;
  const prijsIn = boven ? p.invoerBoven ?? p.invoer : p.invoer;
  const prijsUit = boven ? p.uitvoerBoven ?? p.uitvoer : p.uitvoer;
  return (invoer * prijsIn + (usage.output_tokens || 0) * prijsUit) / 1_000_000;
}
