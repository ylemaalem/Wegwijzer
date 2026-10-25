// =============================================
// WEGWIJZER — Facturatie: dezelfde regels als de database (migratie 110)
// =============================================
// Gebruikt door de prijsschatting in Beheer (admin.js) en het overzicht voor de
// superadmin (superadmin.js). De factuur zelf rekent de database uit
// (facturatie_maandoverzicht); dit is alleen weergave en schatting.
// Los te testen: node --test tests/*.test.js

(function (root) {
  'use strict';

  // Standaard als er nog geen tarief is ingesteld: maandcontract €19,50, minimum 15.
  var STANDAARD_TARIEF = { contract: 'maand', prijs_cent: 1950, minimum: 15, factureren: true };

  // Gelijk aan telt_voor_factuur(rol, alleen_dashboard) in de database.
  function teltVoorFactuur(profiel) {
    if (!profiel) return false;
    if (profiel.role === 'medewerker') return true;
    return profiel.role === 'teamleider' && profiel.alleen_dashboard !== true;
  }

  // Het tarief dat vandaag geldt (laatste geldig_vanaf <= vandaag), of de standaard.
  function geldendTarief(tarieven, vandaagIso) {
    var dag = String(vandaagIso || new Date().toISOString()).slice(0, 10);
    var geldig = (tarieven || []).filter(function (t) { return String(t.geldig_vanaf || '').slice(0, 10) <= dag; });
    geldig.sort(function (a, b) { return String(b.geldig_vanaf).localeCompare(String(a.geldig_vanaf)); });
    return geldig[0] || STANDAARD_TARIEF;
  }

  function schatting(aantal, tarief) {
    var t = tarief || STANDAARD_TARIEF;
    var teFactureren = Math.max(aantal || 0, t.minimum == null ? 15 : t.minimum);
    return { teFactureren: teFactureren, bedragCent: teFactureren * t.prijs_cent, contract: t.contract, prijsCent: t.prijs_cent };
  }

  function euro(cent) {
    return '€' + (cent / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function contractTekst(contract) {
    return contract === 'jaar' ? 'jaarcontract' : 'maandcontract';
  }

  var api = { STANDAARD_TARIEF: STANDAARD_TARIEF, teltVoorFactuur: teltVoorFactuur, geldendTarief: geldendTarief,
    schatting: schatting, euro: euro, contractTekst: contractTekst };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WegwijzerFacturatie = api;
})(typeof window !== 'undefined' ? window : globalThis);
