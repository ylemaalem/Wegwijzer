// Test voor de herindexeerknoppen in het beheerscherm (js/admin.js).
// Vóór 2026-10-17 verwezen die naar chunkCountMap en showAlert, die daar niet
// bestonden (ReferenceError, knop deed stil niets).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

function doc(id, extra) {
  return Object.assign({
    id, naam: id + '.docx', content: 'tekst', user_id: null, indexering_status: 'voltooid',
    zoektermen: ['a'], heeft_embeddings: true, aantal_chunks: 3, created_at: '2026-10-01',
  }, extra || {});
}

async function scherm(tabellen) {
  const a = laadAdmin({ tabellen });
  await a.start();
  return a;
}

function referentieFouten(a) {
  return a.fouten.filter((e) => e && e.name === 'ReferenceError').map((e) => e.message);
}

test('opstarten van het beheerscherm geeft geen ReferenceError', async () => {
  const a = await scherm({ documents: [doc('d1')] });
  try {
    assert.deepEqual(referentieFouten(a), []);
  } finally { a.stop(); }
});

test('"Alleen mislukte herindexeren": alles in orde → melding, geen fout', async () => {
  const a = await scherm({ documents: [doc('d1'), doc('d2')] });
  try {
    await a.klik('bulk-herindexeer-mislukte-btn');
    assert.deepEqual(a.toasts(), ['Alle documenten zijn al geïndexeerd ✅']);
    assert.deepEqual(a.meldingen.confirm, []);
    assert.deepEqual(referentieFouten(a), []);
  } finally { a.stop(); }
});

test('"Alleen mislukte herindexeren": document zonder embeddings en zonder chunks telt als mislukt', async () => {
  const a = await scherm({ documents: [doc('d1'), doc('d2', { heeft_embeddings: false, aantal_chunks: 0 })] });
  try {
    await a.klik('bulk-herindexeer-mislukte-btn');
    assert.equal(a.meldingen.confirm.length, 1);
    assert.match(a.meldingen.confirm[0], /\(1 documenten\)/);
    assert.deepEqual(referentieFouten(a), []);
  } finally { a.stop(); }
});

test('"Alleen mislukte herindexeren": chunks uit document_chunks tellen mee (chunkCountMap)', async () => {
  const a = await scherm({
    documents: [doc('d1'), doc('d2', { heeft_embeddings: false, aantal_chunks: 0 })],
    document_chunks: [{ document_id: 'd2' }, { document_id: 'd2' }],
  });
  try {
    await a.klik('bulk-herindexeer-mislukte-btn');
    assert.deepEqual(a.meldingen.confirm, []);
    assert.deepEqual(a.toasts(), ['Alle documenten zijn al geïndexeerd ✅']);
  } finally { a.stop(); }
});

test('"Semantisch herindexeren" zonder documenten → melding in plaats van stille fout', async () => {
  const a = await scherm({ documents: [] });
  try {
    await a.klik('bulk-herindexeer-alles-btn');
    assert.deepEqual(a.toasts(), ['Geen documenten gevonden om te herindexeren.']);
    assert.deepEqual(referentieFouten(a), []);
  } finally { a.stop(); }
});

test('"Volledig herindexeren" zonder documenten → melding', async () => {
  const a = await scherm({ documents: [] });
  try {
    await a.klik('bulk-volledig-btn');
    assert.deepEqual(a.toasts(), ['Geen documenten gevonden om te herindexeren.']);
  } finally { a.stop(); }
});

test('window.indexAllDocuments: alles geïndexeerd → melding', async () => {
  const a = await scherm({ documents: [doc('d1')] });
  try {
    await a.ctx.window.indexAllDocuments();
    await a.wacht();
    assert.deepEqual(a.toasts(), ['Alle documenten zijn al semantisch geïndexeerd.']);
  } finally { a.stop(); }
});
