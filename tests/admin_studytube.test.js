// Test voor "cursus verbergen" in Beheer → Instellingen → StudyTube (js/admin.js).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

const CURSUSSEN = [
  { id: 'c1', naam: 'Testcursus', duur_minuten: null, trefwoorden: [], verborgen: false },
  { id: 'c2', naam: 'Omgaan met agressie', duur_minuten: 45, trefwoorden: [], verborgen: true },
];

async function scherm() {
  const a = laadAdmin({ tabellen: { studytube_cursussen: CURSUSSEN } });
  await a.start();
  return a;
}

function knop(a, rij) {
  return a.elementen['studytube-cursussen-body'].kinderen[rij].kinderen[0].kinderen[0];
}

test('cursuslijst toont het aantal verborgen cursussen en per cursus de juiste knop', async () => {
  const a = await scherm();
  try {
    assert.match(a.elementen['studytube-cursussen-header'].textContent, /2 cursussen gesynchroniseerd \(1 verborgen\)/);
    assert.equal(knop(a, 0).textContent, 'Verbergen');
    assert.equal(knop(a, 1).textContent, 'Tonen');
  } finally { a.stop(); }
});

test('"Verbergen" roept zet_studytube_cursus_verborgen aan en legt het vast in het auditlog', async () => {
  const a = await scherm();
  try {
    knop(a, 0).listeners.click[0]();
    await a.wacht();
    const rpc = a.supabase.log.filter((q) => q.tabel === 'rpc:zet_studytube_cursus_verborgen');
    assert.equal(rpc.length, 1);
    assert.deepEqual({ ...rpc[0].args }, { p_cursus_id: 'c1', p_verborgen: true });
    const audit = a.supabase.log.find((q) => q.tabel === 'audit_log');
    assert.equal(audit.insert[0].actie, 'STUDYTUBE_CURSUS_VERBORGEN');
    assert.deepEqual(a.toasts(), ['"Testcursus" wordt niet meer als training getoond.']);
  } finally { a.stop(); }
});

test('"Tonen" zet een verborgen cursus weer zichtbaar', async () => {
  const a = await scherm();
  try {
    knop(a, 1).listeners.click[0]();
    await a.wacht();
    const rpc = a.supabase.log.find((q) => q.tabel === 'rpc:zet_studytube_cursus_verborgen');
    assert.deepEqual({ ...rpc.args }, { p_cursus_id: 'c2', p_verborgen: false });
  } finally { a.stop(); }
});
