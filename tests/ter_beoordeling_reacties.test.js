// Beheer "Ter beoordeling": reacties en voorstellen van HR (js/admin.js, migratie 102).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

const REACTIES = [
  { id: 'r1', soort: 'voorstel_kennisbank_item', onderwerp: 'Bij wie meld ik me ziek?', tekst: 'Bij je teamleider.', status: 'nieuw', aangemaakt_op: '2026-10-20T10:00:00Z', ingediend_door: 'p-hr' },
  { id: 'r2', soort: 'verouderd', verwijzing_type: 'document', verwijzing_id: 'd1', verwijzing_naam: 'Verzuim <oud>', tekst: 'Verlopen', status: 'nieuw', aangemaakt_op: '2026-10-21T10:00:00Z', ingediend_door: 'p-hr' },
  { id: 'r3', soort: 'ontbrekend_document', tekst: 'Protocol X', status: 'afgewezen', antwoord_beheerder: 'Bestaat niet meer', aangemaakt_op: '2026-10-19T10:00:00Z', ingediend_door: 'p-hr' },
];

function beheer(extra) {
  const a = laadAdmin(Object.assign({
    tabellen: { kennisbank_reacties: REACTIES.map((r) => ({ ...r })), profiles: [{ id: 'p-hr', naam: 'Hanna HR' }], document_aanvragen_beheer: [], kennisbank_items: [{ id: 'k-nieuw' }], kennisnotities: [{ id: 'n-nieuw' }] },
    detail: { profile: { id: 'p-admin', tenant_id: 't1', role: 'admin', naam: 'Test Beheer' }, user: { id: 'u1', email: 'beheer@test' } },
  }, extra || {}));
  // Beginwaarden van de filters zoals in admin.html.
  a.ctx.document.getElementById('kb-reacties-filter-status').value = 'nieuw';
  a.ctx.document.getElementById('kb-reacties-filter-soort').value = '';
  return a;
}

function acties(a, tabel, actie) {
  return a.supabase.log.filter((q) => q.tabel === tabel && q.acties.includes(actie));
}

test('lijst met teller, standaard alleen nieuw, ontsnapte namen', async () => {
  const a = beheer();
  try {
    await a.start();
    const html = a.elementen['kb-reacties-body'].innerHTML;
    assert.match(html, /Voorstel kennisbank-item/);
    assert.match(html, /Document: Verzuim &lt;oud&gt;/);
    assert.match(html, /Hanna HR/);
    assert.doesNotMatch(html, /Protocol X/);          // afgewezen valt buiten filter "nieuw"
    assert.equal(a.elementen['kb-reacties-teller'].textContent, '2 nieuw');
  } finally { a.stop(); }
});

test('filters: alle statussen en alleen reacties', async () => {
  const a = beheer();
  try {
    await a.start();
    a.elementen['kb-reacties-filter-status'].value = '';
    for (const fn of a.elementen['kb-reacties-filter-status'].listeners.change) fn();
    assert.match(a.elementen['kb-reacties-body'].innerHTML, /Protocol X/);
    a.elementen['kb-reacties-filter-soort'].value = 'reactie';
    for (const fn of a.elementen['kb-reacties-filter-soort'].listeners.change) fn();
    const html = a.elementen['kb-reacties-body'].innerHTML;
    assert.match(html, /Verouderd/);
    assert.doesNotMatch(html, /Voorstel kennisbank-item|Protocol X/);
  } finally { a.stop(); }
});

test('Overnemen: eerst bewerkbaar, dan item aanmaken en status overgenomen', async () => {
  const a = beheer();
  try {
    await a.start();
    a.ctx.kbReactieOvernemen('r1');
    assert.equal(a.elementen['kb-overnemen-type'].value, 'kennisbank_item');
    assert.equal(a.elementen['kb-overnemen-titel'].value, 'Bij wie meld ik me ziek?');
    assert.ok(a.elementen['modal-kb-overnemen'].classList.contains('show'));
    assert.equal(acties(a, 'kennisbank_items', 'insert').length, 0);   // nog niets opgeslagen
    a.elementen['kb-overnemen-tekst'].value = 'Bel vóór 8.00 uur je teamleider.';
    await a.klik('kb-overnemen-opslaan');
    const item = acties(a, 'kennisbank_items', 'insert')[0].insert[0];
    assert.equal(item.vraag, 'Bij wie meld ik me ziek?');
    assert.equal(item.antwoord, 'Bel vóór 8.00 uur je teamleider.');
    const upd = acties(a, 'kennisbank_reacties', 'update')[0];
    assert.equal(upd.update[0].status, 'overgenomen');
    assert.equal(upd.update[0].antwoord_beheerder, 'Overgenomen als kennisbank-item.');
    assert.equal(upd.update[0].afgehandeld_door, 'p-admin');
    assert.deepEqual([...upd.eq], ['id', 'r1']);
    assert.ok(!a.elementen['modal-kb-overnemen'].classList.contains('show'));
  } finally { a.stop(); }
});

test('Afwijzen vraagt een reden; zonder reden niets bijgewerkt', async () => {
  const a = beheer();
  try {
    await a.start();
    a.ctx.prompt = () => '   ';
    await a.ctx.kbReactieAfwijzen('r2');
    assert.equal(acties(a, 'kennisbank_reacties', 'update').length, 0);
    assert.match(a.meldingen.alert[0], /reden is verplicht/);
    a.ctx.prompt = () => 'Nieuwe versie komt eraan';
    await a.ctx.kbReactieAfwijzen('r2');
    const upd = acties(a, 'kennisbank_reacties', 'update')[0].update[0];
    assert.equal(upd.status, 'afgewezen');
    assert.equal(upd.antwoord_beheerder, 'Nieuwe versie komt eraan');
  } finally { a.stop(); }
});

test('Afgehandeld met optioneel antwoord; annuleren doet niets', async () => {
  const a = beheer();
  try {
    await a.start();
    a.ctx.prompt = () => null;
    await a.ctx.kbReactieAfhandelen('r2');
    assert.equal(acties(a, 'kennisbank_reacties', 'update').length, 0);
    a.ctx.prompt = () => '';
    await a.ctx.kbReactieAfhandelen('r2');
    const upd = acties(a, 'kennisbank_reacties', 'update')[0].update[0];
    assert.equal(upd.status, 'afgehandeld');
    assert.equal(upd.antwoord_beheerder, null);
  } finally { a.stop(); }
});
