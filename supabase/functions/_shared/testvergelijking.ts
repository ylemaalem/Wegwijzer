// Vergelijking in de regressietest (besluit Younes 2026-10-23): antwoord én kernfeiten
// (en verboden zinnen) worden op dezelfde manier genormaliseerd, zodat alleen de inhoud
// telt en niet de schrijfwijze:
// - kleine letters, geen accenten (é, ë, ï → e, e, i);
// - "&" wordt "en";
// - streepjes en schuine strepen worden spaties;
// - meerdere spaties (ook regeleinden) worden één spatie.
// Getest met: node --test tests/*.test.js

export function normaliseerTest(tekst: unknown): string {
  return String(tekst ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " en ")
    .replace(/[-‐‑‒–—―−/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Staat de (genormaliseerde) zin in het (genormaliseerde) antwoord?
export function bevatTest(antwoordGenormaliseerd: string, zin: unknown): boolean {
  const z = normaliseerTest(zin);
  return z.length > 0 && antwoordGenormaliseerd.includes(z);
}
