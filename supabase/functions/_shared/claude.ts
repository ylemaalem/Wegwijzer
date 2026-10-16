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
