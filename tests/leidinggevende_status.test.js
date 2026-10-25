// Accountstatus in het tabblad Leidinggevende/HR (D1, 2026-10-25).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leidinggevendeStatus } = require('../js/leidinggevende-status.js');

const profielen = [
  { email: 'Actief@Example.nl', role: 'teamleider', eerste_login_op: '2026-10-01T08:00:00Z', laatste_actief: null },
  { email: 'nieuw@example.nl', role: 'teamleider', eerste_login_op: null, laatste_actief: null },
  { email: 'fout@example.nl', role: 'medewerker', eerste_login_op: '2026-10-01T08:00:00Z' },
  { email: 'baas@example.nl', role: 'admin' },
];

test('geen profiel: geen account, knop Uitnodigen (geval younesl@msn.com na verwijderen)', () => {
  const s = leidinggevendeStatus({ email: 'weg@example.nl' }, profielen);
  assert.equal(s.code, 'geen_account');
  assert.equal(s.label, 'Geen account');
  assert.equal(s.knopTekst, '📧 Uitnodigen');
});

test('e-mail zonder hoofdletters en spaties vergeleken', () => {
  assert.equal(leidinggevendeStatus({ email: ' actief@example.NL ' }, profielen).code, 'actief');
});

test('uitgenodigd, rol medewerker, beheerder, geen e-mail', () => {
  assert.equal(leidinggevendeStatus({ email: 'nieuw@example.nl' }, profielen).code, 'uitgenodigd');
  const fout = leidinggevendeStatus({ email: 'fout@example.nl' }, profielen);
  assert.equal(fout.code, 'rol_medewerker');
  assert.equal(fout.knopTekst, '📧 Herstellen');
  assert.equal(leidinggevendeStatus({ email: 'baas@example.nl' }, profielen).code, 'beheerder');
  const leeg = leidinggevendeStatus({ email: null }, profielen);
  assert.equal(leeg.code, 'geen_email');
  assert.equal(leeg.knopTekst, null);
});

test('lege of ontbrekende profiellijst: geen account', () => {
  assert.equal(leidinggevendeStatus({ email: 'a@b.nl' }, null).code, 'geen_account');
});

test('admin.html laadt de module vóór admin.js; admin.js gebruikt de status en 📧 met rol_herstellen', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const iModule = html.indexOf('js/leidinggevende-status.js');
  const iAdmin = html.indexOf('js/admin.js?v=');
  assert.ok(iModule > 0 && iModule < iAdmin, 'module staat vóór admin.js');
  assert.match(html, /<th>Account<\/th>/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(js, /WegwijzerLeidinggevende\.leidinggevendeStatus\(tl, accountProfielen\)/);
  assert.match(js, /rol_herstellen: true/);
});

test('D2: alleen dashboard zichtbaar in het label en als vlag', () => {
  const p = [{ email: 'd@example.nl', role: 'teamleider', eerste_login_op: '2026-10-01', alleen_dashboard: true }];
  const s = leidinggevendeStatus({ email: 'd@example.nl' }, p);
  assert.equal(s.code, 'actief');
  assert.equal(s.label, 'Account actief · alleen dashboard');
  assert.equal(s.alleenDashboard, true);
  assert.equal(s.profiel, undefined);
  assert.equal(leidinggevendeStatus({ email: 'x@example.nl' }, p).alleenDashboard, false);
});

// ---- Verwijderkeuzes (a)/(b) en alleen-dashboard buiten de lijst Medewerkers (2026-10-25) ----
test('verwijderKeuzes: per status de juiste knoppen, (a) en (b) gelijk aan Medewerkers', () => {
  const { leidinggevendeStatus: st, verwijderKeuzes, verwijderKeuzesMedewerker } = require('../js/leidinggevende-status.js');
  const keys = (s) => verwijderKeuzes(s).map((k) => k.key);
  const p = (extra) => [{ id: 'p1', email: 'a@x.nl', role: 'teamleider', laatste_actief: '2026-10-01', ...extra }];
  assert.deepEqual(keys(st({ email: 'a@x.nl' }, [])), ['rij'], 'geen account');
  assert.deepEqual(keys(st({ email: '' }, [])), ['rij'], 'geen e-mail');
  assert.deepEqual(keys(st({ email: 'a@x.nl' }, p())), ['chattoegang_uit', 'ook_leidinggevende', 'rij']);
  assert.deepEqual(keys(st({ email: 'a@x.nl' }, p({ alleen_dashboard: true }))), ['ook_leidinggevende', 'rij'], 'alleen dashboard: (a) is al zo');
  assert.deepEqual(keys(st({ email: 'a@x.nl' }, p({ role: 'medewerker' }))), ['ook_leidinggevende', 'rij']);
  assert.deepEqual(keys(st({ email: 'a@x.nl' }, p({ role: 'admin' }))), ['rij'], 'beheerder nooit via hier verwijderen');
  assert.equal(st({ email: 'a@x.nl' }, p()).profielId, 'p1');
  assert.deepEqual(verwijderKeuzesMedewerker().map((k) => k.key), ['chattoegang_uit', 'ook_leidinggevende']);
  for (const k of verwijderKeuzes(st({ email: 'a@x.nl' }, p()))) assert.ok(k.titel && k.uitleg, k.key);
  assert.match(verwijderKeuzesMedewerker()[0].titel, /^\(a\)/);
  assert.match(verwijderKeuzesMedewerker()[1].titel, /^\(b\)/);
});

test('admin.js: alleen-dashboard niet in Medewerkers; Leidinggevende/HR verwijdert via (a)/(b) of alleen de rij', () => {
  const s = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(s, /var zichtbaar = result\.data\.filter\(function \(p\) \{ return p\.alleen_dashboard !== true; \}\);/);
  assert.match(s, /var sorted = zichtbaar\.slice\(\)/);
  assert.match(s, /verwijderAccount\(wegSt\.profielId, 'uit_dienst', keuze\)/);
  assert.match(s, /\.select\('id, email, role, eerste_login_op, laatste_actief, alleen_dashboard'\)/);
  assert.doesNotMatch(s, /Annuleren = een andere keuze/);
  const h = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(h, /id="modal-verwijder-keuze"/);
});
