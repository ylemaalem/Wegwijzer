// Browsergeheugen van de chat (F2 stap 2c, 2026-10-24).
// - Na 60 minuten zonder vraag begint het geheugen opnieuw: de vragen van daarvoor
//   gaan niet meer mee naar de server (messages). Gelijk aan de grens op de server
//   (vorige vraag en servergeheugen, 60 minuten).
// - Een mislukte vraag (fout, limiet, geen verbinding) gaat uit het geheugen, zodat
//   die niet als "vorige vraag" meetelt bij de volgende vraag.
// Getest met: node --test tests/*.test.js
(function (root) {
  var GEHEUGEN_MAX_STIL_MS = 60 * 60 * 1000;

  // laatsteVraag: Date.now() van de vorige vraag in dit scherm (0 = nog geen).
  function moetGeheugenWissen(laatsteVraag, nu) {
    return typeof laatsteVraag === 'number' && laatsteVraag > 0 && (nu - laatsteVraag) > GEHEUGEN_MAX_STIL_MS;
  }

  // Haalt precies dit bericht (hetzelfde object) uit de historie; andere berichten
  // met dezelfde tekst blijven staan.
  function haalBerichtWeg(historie, bericht) {
    if (!Array.isArray(historie)) return historie;
    var i = historie.lastIndexOf(bericht);
    if (i !== -1) historie.splice(i, 1);
    return historie;
  }

  var api = { GEHEUGEN_MAX_STIL_MS: GEHEUGEN_MAX_STIL_MS, moetGeheugenWissen: moetGeheugenWissen, haalBerichtWeg: haalBerichtWeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WegwijzerGeheugen = api;
})(this);
