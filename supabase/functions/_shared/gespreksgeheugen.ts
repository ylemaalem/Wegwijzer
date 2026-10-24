// Servergeheugen (F2 stap 2b, 2026-10-24): de laatste opgeslagen gesprekken van deze
// medewerker in de systeemprompt. Voorheen altijd de laatste 3, ook van weken geleden
// (gemeten: bij ±1 op 4 vragen kwam dat geheugen van een eerdere dag), en binnen één
// sessie dubbel met het browsergeheugen (messages).
// Nu: alleen gesprekken van de laatste 60 minuten, en niet de vragen die de app al in
// messages meestuurt. Het servergeheugen helpt dan alleen nog na herladen of de knop
// Terug, binnen hetzelfde gesprek.
// Getest met: node --test tests/*.test.js

import { VORIGE_VRAAG_MAX_MS } from "./trainingkeuze.ts";

export const SERVERGEHEUGEN_MAX_MS = VORIGE_VRAAG_MAX_MS; // 60 minuten
export const SERVERGEHEUGEN_MAX_AANTAL = 3;

export type GeheugenRij = { vraag: string | null; antwoord: string | null; created_at: string };

function normaal(t: unknown): string {
  return String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// rijen: nieuwste eerst (zoals de query ze geeft). Geeft oudste eerst terug.
export function kiesServerGeheugen(rijen: GeheugenRij[], clientMessages: unknown, nuMs: number): GeheugenRij[] {
  const inBrowser = new Set(
    (Array.isArray(clientMessages) ? clientMessages : [])
      .filter((m) => m && (m as { role?: unknown }).role === "user")
      .map((m) => normaal((m as { content?: unknown }).content)),
  );
  return rijen
    .filter((r) => {
      const t = Date.parse(r.created_at);
      return Number.isFinite(t) && nuMs - t <= SERVERGEHEUGEN_MAX_MS && nuMs - t >= -60_000;
    })
    .filter((r) => !inBrowser.has(normaal(r.vraag)))
    .slice(0, SERVERGEHEUGEN_MAX_AANTAL)
    .reverse();
}

export function geheugenTekst(rijen: GeheugenRij[]): string {
  if (rijen.length === 0) return "";
  return "\n\nGESPREKSGEHEUGEN — eerder in dit gesprek (laatste 60 minuten, oudste eerst):\n" + rijen
    .map((g, i) => `[${i + 1}] Vraag: ${(g.vraag || "").substring(0, 150)}\n    Antwoord: ${(g.antwoord || "").substring(0, 200)}`)
    .join("\n\n");
}

// Oude regel (schakelaar uit), letterlijk zoals vóór 2b.
export const GESPREKSGEHEUGEN_REGEL_OUD = "- GESPREKSGEHEUGEN: Je hebt toegang tot de laatste 3 vragen die deze medewerker in eerdere sessies heeft gesteld. Gebruik dit ALLEEN als de nieuwe vraag er direct op aansluit. Verwijs er subtiel naar: 'Je vroeg hier eerder ook naar' of 'Dit sluit aan bij wat je vroeg over...' Zeg NOOIT letterlijk 'vorige sessie' of 'ik heb je gegevens opgeslagen'.";

export const GESPREKSGEHEUGEN_REGEL ="- GESPREKSGEHEUGEN: Soms zie je vragen die deze medewerker eerder in dit gesprek heeft gesteld (laatste 60 minuten). Gebruik dit ALLEEN als de nieuwe vraag er direct op aansluit. Verwijs er subtiel naar: 'Je vroeg hier eerder ook naar' of 'Dit sluit aan bij wat je vroeg over...' Zeg NOOIT letterlijk 'vorige sessie' of 'ik heb je gegevens opgeslagen'.";
