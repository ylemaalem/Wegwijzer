// Blok "Gesprekken" (tabel Datum / Medewerker / Aantal vragen / Feedback) is uit het
// teamleiderdashboard gehaald, met de eigen ophaalcode (verzoek Younes 2026-10-26).
// Statistieken en trendanalyse blijven. Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bron = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('teamleider: geen gesprekkentabel en geen loadTeamGesprekken meer', () => {
  const h = bron('teamleider.html');
  const js = bron('js/teamleider.js');
  assert.doesNotMatch(h, /tl-gesprekken-body|tl-gesprekken-subtitle|Gegevens zijn geanonimiseerd/);
  assert.doesNotMatch(js, /loadTeamGesprekken|tl-gesprekken-body/);
  assert.match(h, /js\/teamleider\.js\?v=25/);
  // De rest blijft: trendanalyse in hetzelfde tabblad, statistieken met hun eigen ophaalcode.
  assert.match(h, /id="tl-trendanalyse-periode"/);
  assert.match(js, /async function loadTeamStatistieken\(\)/);
  assert.equal((js.match(/get_team_gesprek_metadata: true/g) || []).length, 1, 'alleen nog de statistieken halen metadata op');
});
