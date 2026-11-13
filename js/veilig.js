// =============================================
// WEGWIJZER — Veilig tekst in de pagina zetten
// =============================================
// Eén gedeelde plek voor alle schermen (audit B-01, november 2026):
// - escapeHtml: maakt tekst onschadelijk voor HTML én voor attributen
//   (& < > " '). De oude versie per scherm liet " en ' staan.
// - veiligeUrl: laat alleen http(s)-adressen door (logo's, links).
// - actieAttr + koppelActies: klik-acties zonder tekst in onclick="...".
//   De gegevens staan als JSON in een data-attribuut; één luisteraar op het
//   document roept de functie aan. Tekst uit de database kan zo nooit als
//   code worden gelezen.
// Los bestand zodat het zonder browser getest kan worden:
// node --test tests/*.test.js

(function (root) {
  'use strict';

  var VERVANG = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Zelfde gedrag als voorheen voor lege waarden: null, undefined, '' en 0 geven ''.
  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, function (c) { return VERVANG[c]; });
  }

  // Alleen http:// en https://. Al het andere (javascript:, data:, relatief) geeft ''.
  function veiligeUrl(url) {
    var u = String(url == null ? '' : url).trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  // Geeft de attributen voor een knop: data-actie="naam" data-actie-args="[...]".
  // args is een lijst met gewone waarden (tekst, getal, true/false).
  // Een ontbrekende waarde (null/undefined) wordt '', net als voorheen in de knoppen.
  function actieAttr(naam, args) {
    var lijst = (args || []).map(function (a) { return a === null || a === undefined ? '' : a; });
    return ' data-actie="' + escapeHtml(naam) + '" data-actie-args="' + escapeHtml(JSON.stringify(lijst)) + '"';
  }

  // Eén klik-luisteraar op het document. toegestaan: lijst met functienamen;
  // doel: het object waar die functies op staan (window). De functie wordt
  // aangeroepen met de knop als this. Onbekende namen doen niets.
  function koppelActies(doc, toegestaan, doel) {
    doc.addEventListener('click', function (e) {
      var start = e && e.target;
      var el = start && typeof start.closest === 'function' ? start.closest('[data-actie]') : null;
      if (!el) return;
      var naam = el.getAttribute('data-actie');
      if (toegestaan.indexOf(naam) === -1) return;
      var fn = doel[naam];
      if (typeof fn !== 'function') return;
      var args;
      try { args = JSON.parse(el.getAttribute('data-actie-args') || '[]'); } catch (_) { return; }
      if (!Array.isArray(args)) return;
      fn.apply(el, args);
    });
  }

  var api = { escapeHtml: escapeHtml, veiligeUrl: veiligeUrl, actieAttr: actieAttr, koppelActies: koppelActies };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WegwijzerVeilig = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
