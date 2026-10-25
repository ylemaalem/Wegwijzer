// Facturatie (opdracht F, migratie 110, 2026-10-25).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../js/facturatie.js');

const root = path.join(__dirname, '..');
const bron = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('telregel gelijk aan telt_voor_factuur in de database', () => {
  assert.equal(F.teltVoorFactuur({ role: 'medewerker' }), true);
  assert.equal(F.teltVoorFactuur({ role: 'teamleider', alleen_dashboard: false }), true);
  assert.equal(F.teltVoorFactuur({ role: 'teamleider', alleen_dashboard: true }), false);
  assert.equal(F.teltVoorFactuur({ role: 'admin' }), false);
  assert.equal(F.teltVoorFactuur(null), false);
  const m = bron('supabase/migrations/110_facturatie.sql');
  assert.match(m, /SELECT p_rol = 'medewerker' OR \(p_rol = 'teamleider' AND NOT COALESCE\(p_alleen_dashboard, false\)\);/);
});

test('tarief: laatste geldig_vanaf tot en met vandaag, anders standaard €19,50 maand', () => {
  const t = [
    { contract: 'maand', prijs_cent: 1950, minimum: 15, geldig_vanaf: '2026-01-01' },
    { contract: 'jaar', prijs_cent: 1750, minimum: 15, geldig_vanaf: '2026-11-01' },
  ];
  assert.equal(F.geldendTarief(t, '2026-10-25').contract, 'maand');
  assert.equal(F.geldendTarief(t, '2026-11-01').prijs_cent, 1750);
  assert.deepEqual(F.geldendTarief([], '2026-10-25'), F.STANDAARD_TARIEF);
  assert.equal(F.STANDAARD_TARIEF.prijs_cent, 1950);
});

test('minimum 15 en bedragen in centen', () => {
  assert.deepEqual(F.schatting(9, F.STANDAARD_TARIEF).teFactureren, 15);
  assert.equal(F.schatting(9, F.STANDAARD_TARIEF).bedragCent, 29250);
  assert.equal(F.schatting(20, { contract: 'jaar', prijs_cent: 1750, minimum: 15 }).bedragCent, 35000);
  assert.equal(F.euro(29250).replace(/\s/g, ''), '€292,50');
});

test('admin.js: geen €15 en geen 10% jaarkorting meer; prijs uit facturatie_tarief', () => {
  const js = bron('js/admin.js');
  assert.doesNotMatch(js, /aantalVoorPrijs \* 15/);
  assert.doesNotMatch(js, /0\.9\)/);
  assert.match(js, /from\('facturatie_tarief'\)/);
  assert.match(js, /WegwijzerFacturatie\.teltVoorFactuur\(p\)/);
  const html = bron('admin.html');
  assert.doesNotMatch(html, /€15\/pp\/mnd/);
  assert.ok(html.indexOf('js/facturatie.js') > 0 && html.indexOf('js/facturatie.js') < html.indexOf('js/admin.js?v='));
});

test('superadmin: overzicht via facturatie_maandoverzicht', () => {
  assert.match(bron('js/superadmin.js'), /rpc\('facturatie_maandoverzicht', \{ p_maand: input\.value \+ '-01' \}\)/);
  assert.match(bron('superadmin.html'), /id="sa-fact-maand"/);
});
