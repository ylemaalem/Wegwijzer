// Zorgwekkende onderwerpen voor de patroonmelding aan de teamleider (H1, termenlijst
// akkoord Younes 2026-10-25).
// Voorheen een lijst met includes(): 'nood' pakte 'noodzakelijk', 'slaan' pakte 'opslaan'
// en 'overslaan'. Nu hele woorden of woordstammen met woordgrenzen (geen letter ervoor of
// erna), zoals in zorginhoud.ts. Weggelaten op verzoek: 'dreig*' ("er dreigt een tekort"),
// 'nood' ("nood in de familie") en 'levenseinde' (palliatieve zorg).
// Getest met: node --test tests/*.test.js

const L = "\\p{L}*";

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
