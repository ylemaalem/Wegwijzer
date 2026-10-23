// Beheer: datum van laatste wijziging en lijst "ouder dan 6 maanden" (js/admin.js).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

const OUD = '2025-01-15T10:00:00Z';
const NIEUW = new Date(Date.now() - 7 * 864e5).toISOString();

test('items en notities ouder dan 6 maanden, oudste eerst; recente niet', async () => {
  const a = laadAdmin({ tabellen: {
    kennisbank_items: [
      { id: 'k1', vraag: 'Oude vraag', antwoord: 'x', created_at: OUD, updated_at: OUD },
      { id: 'k2', vraag: 'Bijgewerkte vraag', antwoord: 'x', created_at: OUD, updated_at: NIEUW },
    ],
    kennisnotities: [{ id: 'n1', originele_vraag: 'Oude <notitie>', notitie: 'x', actief: true, created_at: '2024-06-01T10:00:00Z', updated_at: '2024-06-01T10:00:00Z' }],
  } });
  try {
    await a.start();
    const html = a.elementen['kennis-oud-lijst'].innerHTML;
    assert.match(html, /Kennisnotitie:<\/span> Oude &lt;notitie&gt;/);
    assert.match(html, /Kennisbank-item:<\/span> Oude vraag/);
    assert.doesNotMatch(html, /Bijgewerkte vraag/);
    assert.ok(html.indexOf('Oude &lt;notitie&gt;') < html.indexOf('Oude vraag'));
    assert.equal(a.elementen['kennis-oud-teller'].textContent, '2');
    assert.match(a.elementen['kennisnotities-lijst'].innerHTML, /Gewijzigd 1 jun 2024/);
  } finally { a.stop(); }
});

test('niets oud: melding en geen teller', async () => {
  const a = laadAdmin({ tabellen: { kennisbank_items: [{ id: 'k', vraag: 'v', antwoord: 'x', created_at: NIEUW, updated_at: NIEUW }], kennisnotities: [] } });
  try {
    await a.start();
    assert.match(a.elementen['kennis-oud-lijst'].innerHTML, /Niets ouder dan 6 maanden/);
    assert.equal(a.elementen['kennis-oud-teller'].style.display, 'none');
  } finally { a.stop(); }
});
