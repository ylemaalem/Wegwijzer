// Vinkje "Uitsluiten van zoeken" in Beheer > Kennisbank > ✏️ (migratie 097).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

const DOC = { id: 'd1', naam: 'Salaristabellen.pdf', bestandspad: 'x/d1.pdf', content: 'tekst', uitgesloten_van_zoeken: false, map: 'Organisatie' };

async function bewaar(a, aanvinken) {
  a.ctx.editDocument('d1');
  a.ctx.document.getElementById('edit-doc-uitgesloten').checked = aanvinken;
  for (const fn of a.elementen['edit-doc-form'].listeners.submit) await fn({ preventDefault() {} });
  await a.wacht();
}

const updates = (a) => a.supabase.log.filter((q) => q.tabel === 'documents' && q.acties.includes('update'));
const audit = (a) => a.supabase.log.filter((q) => q.tabel === 'audit_log' && q.acties.includes('insert')).map((q) => q.insert[0]);

test('aanvinken: document uitgesloten, auditregel DOCUMENT_UITGESLOTEN', async () => {
  const a = laadAdmin({ tabellen: { documents: [DOC] } });
  try {
    await a.start();
    await bewaar(a, true);
    assert.equal(updates(a).length, 1);
    assert.equal(updates(a)[0].update[0].uitgesloten_van_zoeken, true);
    assert.deepEqual(audit(a).map((r) => r.actie), ['DOCUMENT_UITGESLOTEN']);
  } finally { a.stop(); }
});

test('vinkje niet veranderd: geen auditregel', async () => {
  const a = laadAdmin({ tabellen: { documents: [DOC] } });
  try {
    await a.start();
    await bewaar(a, false);
    assert.equal(updates(a)[0].update[0].uitgesloten_van_zoeken, false);
    assert.equal(audit(a).length, 0);
  } finally { a.stop(); }
});

test('uitgesloten document: vinkje staat aan bij openen', async () => {
  const a = laadAdmin({ tabellen: { documents: [{ ...DOC, uitgesloten_van_zoeken: true }] } });
  try {
    await a.start();
    a.ctx.editDocument('d1');
    assert.equal(a.ctx.document.getElementById('edit-doc-uitgesloten').checked, true);
  } finally { a.stop(); }
});
