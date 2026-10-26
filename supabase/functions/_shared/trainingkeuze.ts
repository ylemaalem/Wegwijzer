// Trainingskeuze op onderwerp (F2 stap 2, 2026-10-24).
// Voorheen werd gezocht met de embedding van de hele vraag. Woorden als "begeleid" en
// "cliënt" trokken daarbij naar casussen over andere thema's (schizofrenie: het thema
// "Psychische stoornissen en trauma" op plaats 152), en een vervolgvraag zonder het
// onderwerp ("het gaat mij om de cliënt die hier moeilijk mee kan omgaan") vond niets.
// Nu:
// 1. het model geeft het onderwerp plus het overkoepelende thema ("schizofrenie,
//    psychische stoornissen"), of GEEN als een training niet zinvol is; de vorige vraag
//    telt alleen mee als de huidige vraag erop doorgaat (en alleen binnen 60 minuten,
//    zie vorigeVraagUitGesprek);
// 2. gezocht wordt met de embedding van dat onderwerp;
// 3. de keuzestap ziet naam én beschrijving en kiest liever geen training dan een foute.
// Getest met: node --test tests/*.test.js

// De vorige vraag uit het browsergeheugen (messages) telt alleen mee als die binnen
// dit aantal minuten is gesteld. Het servergeheugen (laatste 3 opgeslagen gesprekken)
// wordt hier bewust niet gebruikt.
export const VORIGE_VRAAG_MAX_MS = 60 * 60 * 1000;
// Kleine klokafwijking binnen dezelfde browser (t en client_tijd komen van dezelfde klok).
const KLOK_MARGE_MS = 60 * 1000;

type Bericht = { role?: unknown; content?: unknown; t?: unknown };

// messages: het meegestuurde gesprek; het laatste bericht is de huidige vraag.
// clientTijd: Date.now() van de browser bij het versturen. Elk bericht heeft t =
// Date.now() van het moment van stellen. Zonder tijden (oude app-versie) geen vorige vraag.
export function vorigeVraagUitGesprek(messages: unknown, clientTijd: unknown): string | null {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const nu = Number(clientTijd);
  if (!Number.isFinite(nu) || nu <= 0) return null;
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i] as Bericht | null;
    if (!m || m.role !== "user") continue;
    const t = Number(m.t);
    if (!Number.isFinite(t) || t <= 0) return null;
    const leeftijd = nu - t;
    if (leeftijd < -KLOK_MARGE_MS || leeftijd > VORIGE_VRAAG_MAX_MS) return null;
    const tekst = String(m.content ?? "").replace(/\s+/g, " ").trim();
    return tekst ? tekst.slice(0, 500) : null;
  }
  return null;
}

// Gedeelde regel voor zorginhoud-herkenning en onderwerp: wanneer telt de vorige vraag mee.
export const VORIGE_VRAAG_REGEL = `Gebruik de vorige vraag alleen als de huidige vraag er duidelijk op doorgaat en zelf geen nieuw onderwerp noemt (bijvoorbeeld "die cliënt", "hiermee", "het gaat mij om ..."). Noemt de huidige vraag een ander onderwerp, of gaat ze over iets praktisch of organisatorisch, beoordeel dan alleen de huidige vraag.`;

export function trainingOnderwerpPrompt(vraag: string, vorigeVraag: string | null): string {
  return `Je bepaalt het onderwerp waarmee trainingen in StudyTube worden gezocht.

Trainingen zijn zinvol bij:
- Vakinhoudelijke thema's (ziektebeelden, doelgroepen, problematiek, methodieken)
- Persoonlijke ontwikkeling en vaardigheden
- Vragen die gaan over HOE je iets doet als zorgprofessional (zorgplan opstellen, gesprekstechniek, agressiehantering, rapporteren)
- Wetten, financiering en indicaties in de zorg (Wlz, Wmo, Jeugdwet, PGB, VPT en MPT, indicatiestelling)

Trainingen zijn NIET zinvol bij:
- Systeemvragen (hoe log ik in, hoe installeer ik een app)
- Administratieve vragen (pauze, verlof, rooster, salaris, declareren, reiskosten, uren)
- Organisatorische procesvragen (wie bel ik, waar meld ik X)
${vorigeVraag ? `\n${VORIGE_VRAAG_REGEL}\n\nVorige vraag: ${vorigeVraag}\n` : ""}
Huidige vraag: ${vraag}

Antwoord op één regel, zonder labels, in de vorm: onderwerp, overkoepelend thema.
- Het onderwerp is het ziektebeeld, de doelgroep, de problematiek of de vaardigheid zelf, in 1 tot 3 woorden. Niet het detail van de situatie.
- Het overkoepelende thema is de bredere categorie waar het onderwerp onder valt, in 1 tot 3 woorden. Nooit algemene woorden als begeleiding, begeleiden, cliënt, omgaan met, situatie of aanpak.
- Gaat de vraag over een wet, financiering of indicatie, dan is het overkoepelende thema die wet of regeling (bijvoorbeeld Wlz, Wmo of PGB).
Voorbeelden: "schizofrenie, psychische stoornissen", "eetstoornis, psychische stoornissen", "autisme, autismespectrumstoornis", "alcoholgebruik, verslaving", "agressie, spanningsvol gedrag", "rapporteren, rapportage", "VPT en MPT, Wlz langdurige zorg", "PGB, financiering zorg", "Wmo-indicatie, Wmo", "indicatie, Wlz".
Is een training niet zinvol, antwoord dan alleen GEEN.`;
}

// Onderwerp uit het antwoord van het model; null = geen training zinvol of onleesbaar.
// Alleen letters, cijfers, spaties, komma's, koppel- en apostroftekens (het gaat naar
// de embedding en in de keuzeprompt, nooit in een filter).
export function leesOnderwerp(tekst: string | null | undefined): string | null {
  // Het model zet er soms labels voor ("Onderwerp: x" / "Overkoepelend thema: y") op
  // aparte regels: labels weg, regels samen met een komma.
  const regels = String(tekst ?? "").split(/\r?\n/)
    .map((r) => r.replace(/^\s*[-*]?\s*(overkoepelend thema|onderwerp|thema)\s*[:=-]\s*/i, "").trim())
    .filter(Boolean);
  const t = regels.join(", ").replace(/["“”.]/g, " ").replace(/\s+/g, " ").trim();
  // GEEN als los woord, ook niet vooraan ("Training niet zinvol: GEEN"): geen training.
  if (!t || /(^|[^\p{L}])geen([^\p{L}]|$)/iu.test(t)) return null;
  const schoon = t.replace(/[^\p{L}\p{N} ,'’&-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return schoon.length >= 2 ? schoon : null;
}

export type CursusKandidaat = { naam: string; beschrijving?: string | null };

// Gemeten 2026-10-24 (testoptie test_keuze_prompt, 6 vragen x3): met de lijst vóór de
// regels en "alleen nummers, geen uitleg" kiest het model bij schizofrenie en eetstoornis
// de algemene trainingen over psychische stoornissen, bij tinnitus niets. De eerdere
// versie gaf daar "geen" of een uitleg zonder nummers.
// De vorige vraag staat niet in deze prompt: het onderwerp bevat de context al.
export function genummerdeTrainingen(kandidaten: CursusKandidaat[]): string {
  return kandidaten
    .map((c, i) => `${i + 1}. ${String(c.naam).replace(/\s+/g, " ")}${c.beschrijving ? " — " + String(c.beschrijving).replace(/\s+/g, " ").slice(0, 160) : ""}`)
    .join("\n");
}

export function trainingSelectiePrompt(vraag: string, onderwerp: string, kandidaten: CursusKandidaat[]): string {
  const genummerd = genummerdeTrainingen(kandidaten);
  return `Hieronder staan trainingen uit StudyTube, met naam en beschrijving. Kies maximaal 3 trainingen voor de medewerker.

Onderwerp en overkoepelend thema: ${onderwerp}
Vraag: "${vraag}"

Trainingen:
${genummerd}

Regels:
- Een training past als de naam of de beschrijving over het onderwerp gaat. De training hoeft niet over het precieze detail van de vraag te gaan.
- Is er geen training over het onderwerp zelf, dan past een algemene training over het overkoepelende thema (bij schizofrenie of een eetstoornis bijvoorbeeld een algemene training over psychische stoornissen).
- Een training over een ander ziektebeeld, een andere doelgroep of een ander thema is fout, ook als die er zijdelings mee te maken heeft. Past er niets, antwoord dan geen.

Antwoord met alleen de nummers gescheiden door komma's (bijvoorbeeld: 2, 5, 7), of met alleen het woord geen. Geen uitleg.`;
}

// Nummers uit de keuze ("2, 5" of "geen") -> indexen, hoogstens 3, binnen bereik, uniek.
export function leesKeuze(tekst: string | null | undefined, aantal: number): number[] {
  const t = String(tekst ?? "").trim().toLowerCase();
  if (!t || t.startsWith("geen")) return [];
  const uit: number[] = [];
  for (const n of t.match(/\d+/g) || []) {
    const i = parseInt(n, 10) - 1;
    if (i >= 0 && i < aantal && !uit.includes(i)) uit.push(i);
    if (uit.length === 3) break;
  }
  return uit;
}
