// Zorginhoudelijke vragen (besluit Younes 2026-10-23): vragen over problematiek,
// ziektebeelden, doelgroepen of begeleiding daarvan. Daarvoor geldt de organisatie
// als bron, niet de eigen kennis van het model:
// - staat het in de documenten: dat antwoord;
// - anders, met een passende StudyTube-training: het trainingsblok en de zin dat de
//   inhoud in StudyTube staat;
// - anders: eerlijk "staat niet in de documenten" en een verwijzing naar de afdeling
//   Kennis en Expertise of de teamleider. Nooit zelfbedachte inhoud ("volgens AHMN").
// Getest met: node --test tests/*.test.js

import { VORIGE_VRAAG_REGEL } from "./trainingkeuze.ts";

export const ZORGINHOUDELIJK_PATROON = new RegExp(
  "(?<![\\p{L}])(" + [
    "autis\\p{L}*", "asperger", "adhd", "verslav\\p{L}*", "middelengebruik", "drugsgebruik", "alcoholgebruik",
    "alcoholprobl\\p{L}*", "trauma\\p{L}*", "ptss", "psychos\\p{L}*", "psychotisch\\p{L}*", "schizofren\\p{L}*",
    "bipola\\p{L}*", "manisch\\p{L}*", "depressi\\p{L}*", "depressief", "angststoornis\\p{L}*", "paniekaanval\\p{L}*",
    "borderline", "persoonlijkheidsstoornis\\p{L}*", "eetstoornis\\p{L}*", "anorexia", "boulimia",
    "suïcid\\p{L}*", "suicid\\p{L}*", "zelfbeschadig\\p{L}*", "zelfmoord\\p{L}*", "dementie", "alzheimer",
    "hersenletsel", "hechtingsprobl\\p{L}*", "hechtingsstoornis\\p{L}*", "overprikkel\\p{L}*", "prikkelverwerking",
    "dissocia\\p{L}*", "dwangstoornis\\p{L}*", "ocd", "hallucina\\p{L}*", "wanen", "stemmen horen",
    "probleemgedrag", "ziektebeeld\\p{L}*", "stoornis\\p{L}*",
  ].join("|") + ")(?![\\p{L}])",
  "iu",
);

export function isZorginhoudelijkeVraag(vraag: string): boolean {
  return ZORGINHOUDELIJK_PATROON.test(vraag || "");
}

// Tweede stap naast de lijst (2026-10-24): staat er geen term uit de lijst in de vraag,
// dan beslist het model met een korte ja/nee-vraag. Vangt o.a. "dubbele diagnose",
// "NAH" en "gedragsproblemen" die de lijst mist. Praktische werkvragen zijn uitdrukkelijk
// NEE, zodat ze geen StudyTube-blok en geen zorginhoud-regel krijgen.
// F2 stap 2 (2026-10-24): met vorigeVraag (alleen uit het browsergeheugen, binnen 60
// minuten) kan een vervolgvraag als "het gaat mij om de cliënt die hier moeilijk mee
// kan omgaan" ook herkend worden. Zonder vorigeVraag is de prompt ongewijzigd.
export function zorginhoudClassificatiePrompt(vraag: string, vorigeVraag: string | null = null): string {
  const criteria = `JA: de vraag gaat over problematiek van cliënten, ziektebeelden, diagnoses, beperkingen, psychische of lichamelijke aandoeningen, doelgroepen, of over hoe je cliënten met zo'n probleem begeleidt of benadert (bijvoorbeeld dubbele diagnose, NAH, LVB, gedragsproblemen, psychiatrie).
NEE: praktische of organisatorische vragen over het werk zelf, zoals verlof, vakantie, ziekmelden, uren schrijven, declareren, reiskosten, salaris, rooster, diensten, systemen, inloggen, formulieren, wie je moet bellen of waar iets staat.`;
  if (!vorigeVraag) {
    return `Is de vraag hieronder zorginhoudelijk? Antwoord met alleen JA of NEE.

${criteria}

Vraag: ${vraag}`;
  }
  return `Is de huidige vraag hieronder zorginhoudelijk? Antwoord met alleen JA of NEE.

${criteria}

${VORIGE_VRAAG_REGEL}

Vorige vraag: ${vorigeVraag}
Huidige vraag: ${vraag}`;
}

// JA -> true, NEE -> false, iets anders -> null (dan geldt alleen de lijst).
export function leesJaNee(tekst: string | null | undefined): boolean | null {
  const t = String(tekst ?? "").trim().toUpperCase();
  if (t.startsWith("JA")) return true;
  if (t.startsWith("NEE")) return false;
  return null;
}

// Gaat in de systeemprompt in plaats van de regel "EIGEN KENNIS GEBRUIKEN".
export const ZORGINHOUDELIJK_BLOK = `ZORGINHOUDELIJKE VRAAG (DEZE REGEL GAAT VOOR ALLE ANDERE REGELS OVER EIGEN KENNIS):
Deze vraag gaat over zorginhoud (problematiek, ziektebeelden, doelgroepen of begeleiding daarvan). Daarvoor zijn de documenten van de organisatie en StudyTube de bron, niet je eigen kennis.
- Staat het antwoord in de KENNISBRONNEN (documenten van de organisatie): geef dat antwoord met de bron, en vul het niet aan met eigen kennis.
- Staat het er niet in en zijn er TRAININGEN UIT STUDYTUBE: zeg kort dat dit niet in de documenten staat en dat de inhoud over dit onderwerp in StudyTube staat. Het systeem zet de trainingen zelf onder je antwoord. Geef zelf geen uitleg, tips, signalen, oorzaken of stappenplan.
- Staat het er niet in en zijn er geen trainingen: zeg eerlijk dat dit niet in de documenten staat, en verwijs voor deze vraag naar de afdeling Kennis en Expertise of je teamleider. Geef zelf geen uitleg, tips, signalen, oorzaken of stappenplan.
- Schrijf nooit "volgens AHMN", "bij AHMN", "de organisatie adviseert" of iets dergelijks over inhoud die niet in de documenten staat.
- Een afkorting uit de lijst hieronder mag je in één zin uitschrijven; verder geen eigen uitleg.`;

// Vervangt in GEEN_DOC_INSTRUCTIE de regel over algemene vakkennis.
export const ZORGINHOUDELIJK_GEEN_DOC = `- Deze vraag is zorginhoudelijk: volg de regel ZORGINHOUDELIJKE VRAAG. Geef GEEN antwoord uit algemene vakkennis.`;
