// HR-tabblad "Kennisbank" in het dashboard (js/teamleider.js, migratie 102):
// alleen lezen via kennisbank_overzicht() en reageren via kennisbank_reacties.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadDashboard } = require('./helpers/admin_harness.js');

const OVERZICHT = {
  documenten: [
    { id: 'd1', naam: 'Verzuim <protocol>', map: 'Personeelszaken', aangemaakt_op: '2026-04-01T10:00:00Z', revisiedatum: '2020-01-01', uitgesloten_van_zoeken: false },
    { id: 'd2', naam: 'Salaristabellen', map: 'CAO', aangemaakt_op: '2026-05-01T10:00:00Z', revisiedatum: null, uitgesloten_van_zoeken: true },
  ],
  kennisbank_items: [{ id: 'k1', vraag: 'Bij wie meld ik me ziek?', antwoord: 'Bij je teamleider.', aangemaakt_op: '2026-05-01T10:00:00Z' }],
  kennisnotities: [{ id: 'n1', onderwerp: 'Sleutelkast', notitie: 'Naast de keuken.', aangemaakt_op: '2026-05-01T10:00:00Z' }],
};

function hrDashboard(extra) {
  return laadDashboard(Object.assign({
    tabellen: { teamleiders: [{ rol: 'hr', teams: [] }], 'rpc:kennisbank_overzicht': OVERZICHT, kennisbank_reacties: [] },
  }, extra || {}));
}

function inserts(a, tabel) {
  return a.supabase.log.filter((q) => q.tabel === tabel && q.acties.includes('insert')).map((q) => q.insert[0]);
}

// Nep-klik op een 💬-knop binnen een lijst (event delegation).
async function klikReageer(a, lijstId, type, id) {
  const knop = { getAttribute: (n) => ({ 'data-kb-type': type, 'data-kb-id': id })[n] };
  const doel = { closest: () => knop };
  for (const fn of a.elementen[lijstId].listeners.click) await fn({ target: doel });
  await a.wacht();
}

test('HR ziet documenten per map met datums, zonder inhoud; HTML wordt ontsnapt', async () => {
  const a = hrDashboard();
  try {
    await a.start();
    assert.ok(a.supabase.log.some((q) => q.tabel === 'rpc:kennisbank_overzicht'));
    const html = a.elementen['kb-hr-documenten'].innerHTML;
    assert.match(html, /Personeelszaken \(1\)/);
    assert.match(html, /Verzuim &lt;protocol&gt;/);
    assert.match(html, /verlopen/);
    assert.match(html, /Geen revisiedatum/);
    assert.match(html, /niet gebruikt door de chat/);
    assert.match(a.elementen['kb-hr-items'].innerHTML, /Bij wie meld ik me ziek\?/);
    assert.match(a.elementen['kb-hr-notities'].innerHTML, /Sleutelkast/);
    assert.match(a.elementen['kb-hr-status'].textContent, /2 documenten, 1 kennisbank-items en 1 kennisnotities/);
  } finally { a.stop(); }
});

test('💬 Reageer op een document: rij met soort, verwijzing en eigen naam', async () => {
  const a = hrDashboard();
  try {
    await a.start();
    await klikReageer(a, 'kb-hr-documenten', 'document', 'd2');
    assert.equal(a.elementen['kb-hr-modal-over'].textContent, 'Document: Salaristabellen');
    a.elementen['kb-hr-soort'].value = 'moet_bijgewerkt';
    a.elementen['kb-hr-toelichting'].value = '  Tabel van mei ontbreekt  ';
    await a.klik('kb-hr-modal-verstuur');
    const rij = inserts(a, 'kennisbank_reacties')[0];
    assert.deepEqual(JSON.parse(JSON.stringify(rij)), {
      tenant_id: 't1', ingediend_door: 'p-tl', soort: 'moet_bijgewerkt', tekst: 'Tabel van mei ontbreekt',
      verwijzing_type: 'document', verwijzing_id: 'd2', verwijzing_naam: 'Salaristabellen',
    });
    assert.match(a.elementen['kb-hr-alert-message'].textContent, /Verstuurd/);
  } finally { a.stop(); }
});

test('Er ontbreekt een document: zonder tekst geen rij, met tekst wel', async () => {
  const a = hrDashboard();
  try {
    await a.start();
    await a.klik('kb-hr-ontbreekt-btn');
    await a.klik('kb-hr-modal-verstuur');
    assert.equal(inserts(a, 'kennisbank_reacties').length, 0);
    assert.match(a.elementen['kb-hr-modal-alert-message'].textContent, /welk document ontbreekt/i);
    a.elementen['kb-hr-ontbreekt-tekst'].value = 'Het nieuwe verzuimprotocol';
    await a.klik('kb-hr-modal-verstuur');
    const rij = inserts(a, 'kennisbank_reacties')[0];
    assert.equal(rij.soort, 'ontbrekend_document');
    assert.equal(rij.tekst, 'Het nieuwe verzuimprotocol');
    assert.equal(rij.verwijzing_id, undefined);
  } finally { a.stop(); }
});

test('mislukte invoer toont de fout en sluit niet', async () => {
  const a = hrDashboard({ dbFouten: { 'kennisbank_reacties:insert': { message: 'new row violates row-level security policy' } } });
  try {
    await a.start();
    await klikReageer(a, 'kb-hr-items', 'kennisbank_item', 'k1');
    a.elementen['kb-hr-toelichting'].value = 'Klopt niet meer';
    await a.klik('kb-hr-modal-verstuur');
    assert.match(a.elementen['kb-hr-modal-alert-message'].textContent, /Versturen mislukt: new row violates/);
    assert.ok(a.elementen['modal-kb-hr'].classList.contains('show'));
  } finally { a.stop(); }
});

test('teamleider (geen HR) laadt het kennisbankoverzicht niet', async () => {
  const a = laadDashboard({ tabellen: { teamleiders: [{ rol: 'teamleider', teams: ['A'] }], 'rpc:kennisbank_overzicht': OVERZICHT } });
  try {
    await a.start();
    assert.ok(!a.supabase.log.some((q) => q.tabel === 'rpc:kennisbank_overzicht'));
  } finally { a.stop(); }
});
