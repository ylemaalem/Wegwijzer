// Uitspraken over trainingen in het antwoord afstemmen op het trainingsblok
// (StudyTube) dat onder het antwoord staat.
//
// Onderscheid (besluit Younes, 2026-10-17):
// - "In de documenten staat geen specifieke training over X" mag altijd: dat
//   gaat over de kennisbank.
// - "Er is geen training over X" (zonder bron) of "In StudyTube is geen training
//   gevonden" mag niet als er wél trainingen gevonden zijn: zo'n zin wordt
//   vervangen door TRAININGEN_ZIN.
// - De zin dat er trainingen onder het antwoord staan, zet het systeem zelf neer,
//   en alleen als er een blok is. Verwijzingen van het model zelf gaan eruit.
// Getest met: node --test tests/*.test.js

export const TRAININGEN_ZIN = "Onder dit antwoord staan trainingen uit StudyTube die hierbij passen.";

// "geen (specifieke/aparte/passende) training/cursus/opleiding/e-learning"
export const GEEN_TRAINING_PATROON = /\bgeen\s+(?:[\p{L}-]+\s+){0,2}(?:trainingen|training|cursussen|cursus|e-learnings?|opleidingen|opleiding)\b/iu;
// Een uitspraak met deze bron gaat over de documenten (kennisbank).
const DOCUMENT_BRON_PATROON = /\b(?:documenten|document|kennisbank|organisatiedocumenten|beleid\p{L}*|protocol\p{L}*|regeling\p{L}*|handboek\p{L}*|richtlijn\p{L}*)\b/iu;
// Een uitspraak met deze bron gaat over het leerplatform.
const STUDYTUBE_PATROON = /\b(?:studytube|leerplatform|opleidingsaanbod|trainingsaanbod)\b/iu;
// Verwijzing naar trainingen onder het antwoord ("Onder dit antwoord staan trainingen …").
const ONDER_PATROON = /\b(?:hieronder|onder dit antwoord|onder het antwoord|onderaan)\b/iu;
const TRAINING_WOORD_PATROON = /\b(?:trainingen|training|cursussen|cursus|opleidingen|opleiding|e-learnings?)\b/iu;
const OPSOMMING_PATROON = /^\s*(?:[-*•]|\d+[.)])\s+/;

export interface TrainingZinnen {
  tekst: string;
  vervangen: number;   // algemene "geen training"-zinnen vervangen door TRAININGEN_ZIN
  verwijderd: number;  // eigen verwijzingen en herhaalde trainingsnamen van het model
  toegevoegd: boolean; // TRAININGEN_ZIN aan het eind toegevoegd
}

// Zinnen binnen één regel. Een zin eindigt op . ! of ? gevolgd door witruimte of
// het regeleinde, zodat bedragen als "3.635" en tijden als "8.30" heel blijven.
export function splitsZinnen(regel: string): string[] {
  const zinnen = regel.match(/[^]*?(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [];
  return zinnen.filter((z) => z.length > 0);
}

function kaal(tekst: string): string {
  return tekst.replace(/[*_`]/g, "");
}

// Zegt deze zin dat er geen training is, zonder dat die over de documenten gaat?
export function zegtAlgemeenGeenTraining(zin: string): boolean {
  const z = kaal(zin);
  return GEEN_TRAINING_PATROON.test(z) && (!DOCUMENT_BRON_PATROON.test(z) || STUDYTUBE_PATROON.test(z));
}

export function algemeneGeenTrainingZinnen(tekst: string): string[] {
  return tekst.split("\n").flatMap(splitsZinnen).filter(zegtAlgemeenGeenTraining).map((z) => z.trim());
}

function verwijstNaarTrainingen(zin: string): boolean {
  const z = kaal(zin);
  return ONDER_PATROON.test(z) && TRAINING_WOORD_PATROON.test(z);
}

// Opsommingsregel die alleen een getoonde trainingsnaam herhaalt ("- **Naam** (30 min)").
function isHerhaaldeTraining(regel: string, namen: string[]): boolean {
  if (!OPSOMMING_PATROON.test(regel)) return false;
  const inhoud = kaal(regel.replace(OPSOMMING_PATROON, "")).trim().toLowerCase();
  return namen.some((n) => inhoud.startsWith(n) && (inhoud.length === n.length || /^[\s(:,.–-]/.test(inhoud.slice(n.length))));
}

export function verwerkTrainingZinnen(antwoord: string, trainingNamen: string[]): TrainingZinnen {
  const heeftBlok = trainingNamen.length > 0;
  const namen = trainingNamen.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0);
  const regels = antwoord.split("\n");
  const herhaald = regels.map((r) => heeftBlok && isHerhaaldeTraining(r, namen));
  let vervangen = 0;
  let verwijderd = 0;
  let zinGeplaatst = false;
  const uit: string[] = [];

  for (let i = 0; i < regels.length; i++) {
    if (herhaald[i]) { verwijderd++; continue; }
    // Een inleiding als "Onder dit antwoord staan:" vóór een herhaalde trainingslijst.
    let volgende = i + 1;
    while (volgende < regels.length && regels[volgende].trim() === "") volgende++;
    const leidtLijstIn = volgende < regels.length && herhaald[volgende];

    const zinnen = splitsZinnen(regels[i]);
    const behouden: string[] = [];
    for (const zin of zinnen) {
      const isInleiding = leidtLijstIn && ONDER_PATROON.test(kaal(zin)) && /:\s*$/.test(zin);
      if (verwijstNaarTrainingen(zin) || isInleiding) { verwijderd++; continue; }
      if (heeftBlok && zegtAlgemeenGeenTraining(zin)) {
        if (!zinGeplaatst) {
          behouden.push(TRAININGEN_ZIN + (zin.match(/\s*$/)?.[0] || " "));
          zinGeplaatst = true;
        }
        vervangen++;
        continue;
      }
      behouden.push(zin);
    }
    const nieuweRegel = behouden.join("").trimEnd();
    // Een regel die alleen uit verwijderde zinnen bestond, verdwijnt helemaal.
    if (zinnen.length > 0 && behouden.length === 0) continue;
    uit.push(nieuweRegel);
  }

  let tekst = uit.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let toegevoegd = false;
  if (heeftBlok && !zinGeplaatst) {
    tekst = tekst.length > 0 ? `${tekst}\n\n${TRAININGEN_ZIN}` : TRAININGEN_ZIN;
    toegevoegd = true;
  }
  return { tekst, vervangen, verwijderd, toegevoegd };
}
