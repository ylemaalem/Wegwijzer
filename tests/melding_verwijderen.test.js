// Beheer: melding verwijderen (js/admin.js, migratie 105).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

test('verwijderen gelukt: auditregel; geweigerd (0 rijen): melding, geen auditregel', async () => {
  const a = laadAdmin({ confirm: true, tabellen: { meldingen: [{ id: 'm1' }] } });
  try {
    await a.start();
    await a.ctx.deleteMelding('m1');
    assert.equal(a.supabase.log.filter((q) => q.tabel === 'audit_log' && q.acties.includes('insert')).filter((q) => q.insert[0].actie === 'MELDING_VERWIJDERD').length, 1);
  } finally { a.stop(); }
  const b = laadAdmin({ confirm: true, tabellen: { meldingen: [] } });
  try {
    await b.start();
    await b.ctx.deleteMelding('m1');
    assert.match(b.meldingen.alert[0], /Verwijderen mislukt/);
    assert.equal(b.supabase.log.filter((q) => q.tabel === 'audit_log' && q.acties.includes('insert') && q.insert[0].actie === 'MELDING_VERWIJDERD').length, 0);
  } finally { b.stop(); }
});
