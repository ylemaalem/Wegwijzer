// Synoniemen en zoektermen in de gewone zoekroute (2026-10-26).
// "O&S" staat alleen in documents.synoniemen van "Handleiding traject ondersteuning &
// stabiliteit 1.0", niet in de tekst van een stuk. Vector- en trefwoordzoeken vonden het
// document daardoor niet; alleen de terugvalroute keek naar synoniemen en zoektermen.
// Nu: noemt de vraag een synoniem of zoekterm van een document (hele woorden), dan
// - gaat de documentnaam mee in het trefwoordzoeken, en
// - doen de beste stukken van dat document mee (match_chunks_in_documenten, migratie 113).
// Geen vaste woordenlijst: een term telt alleen als hij bij weinig documenten hoort
// (gemeten 2026-10-26: "ahmn" hoort bij 23 documenten, "o&s" bij 1).
// Getest met: node --test tests/*.test.js

export type DocTermen = { id: string; naam: string; synoniemen?: string[] | null; zoektermen?: string[] | null };
export type DocViaTerm = { id: string; naam: string; termen: string[]; synoniem: boolean };

// Een term telt alleen als hij bij hoogstens zoveel documenten hoort.
export const MAX_DOCUMENTEN_PER_TERM = 2;

// Woorden in kleine letters; & hoort bij het woord (O&S), andere leestekens scheiden.
export function woorden(tekst: string | null | undefined): string[] {
  return String(tekst ?? "").toLowerCase().split(/[^\p{L}\p{N}&]+/u).map((w) => w.replace(/^&+|&+$/g, "")).filter(Boolean);
}

function bevatReeks(vraag: string[], term: string[]): boolean {
  if (term.length === 0 || term.length > vraag.length) return false;
  for (let i = 0; i + term.length <= vraag.length; i++) {
    let gelijk = true;
    for (let j = 0; j < term.length; j++) if (vraag[i + j] !== term[j]) { gelijk = false; break; }
    if (gelijk) return true;
  }
  return false;
}

// Documenten waarvan een synoniem of een specifieke zoekterm in de vraag staat.
// Volgorde: eerst via een synoniem, dan meer en langere termen. Hoogstens maxDocs.
export function documentenViaTermen(vraag: string, docs: DocTermen[], maxDocs = 3, maxPerTerm = MAX_DOCUMENTEN_PER_TERM): DocViaTerm[] {
  if (maxDocs <= 0) return [];
  const vraagWoorden = woorden(vraag);
  if (vraagWoorden.length === 0) return [];
  // term -> documenten (synoniem of zoekterm), om te tellen bij hoeveel documenten hij hoort
  const perTerm = new Map<string, Map<string, boolean>>();
  for (const d of docs) {
    const termen: Array<[string, boolean]> = [
      ...(d.synoniemen || []).map((t): [string, boolean] => [t, true]),
      ...(d.zoektermen || []).map((t): [string, boolean] => [t, false]),
    ];
    for (const [t, isSyn] of termen) {
      const sleutel = woorden(t).join(" ");
      if (sleutel.replace(/ /g, "").length < 2) continue;
      if (!perTerm.has(sleutel)) perTerm.set(sleutel, new Map());
      const m = perTerm.get(sleutel)!;
      m.set(d.id, (m.get(d.id) || false) || isSyn);
    }
  }
  const gevonden = new Map<string, DocViaTerm>();
  const naamVan = new Map(docs.map((d) => [d.id, d.naam]));
  for (const [sleutel, perDoc] of perTerm) {
    if (perDoc.size > maxPerTerm) continue;
    if (!bevatReeks(vraagWoorden, sleutel.split(" "))) continue;
    for (const [id, isSyn] of perDoc) {
      const g = gevonden.get(id) || { id, naam: naamVan.get(id) || "", termen: [], synoniem: false };
      g.termen.push(sleutel);
      g.synoniem = g.synoniem || isSyn;
      gevonden.set(id, g);
    }
  }
  const lengte = (g: DocViaTerm) => Math.max(...g.termen.map((t) => t.length));
  return [...gevonden.values()]
    .sort((a, b) => Number(b.synoniem) - Number(a.synoniem) || b.termen.length - a.termen.length || lengte(b) - lengte(a) || a.id.localeCompare(b.id))
    .slice(0, maxDocs);
}

// Documentnaam als zoekwoorden: zonder extensie en versienummers ("1.0", "v5").
export function naamVoorZoeken(naam: string): string {
  return String(naam ?? "")
    .replace(/\.(docx?|pdf|xlsx?|pptx?|txt|md|html?)$/i, "")
    .split(/[\s_]+/)
    .filter((w) => w && !/^v?\d+(?:[._]\d+)*$/i.test(w))
    .join(" ")
    .trim();
}
