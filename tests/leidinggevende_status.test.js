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
