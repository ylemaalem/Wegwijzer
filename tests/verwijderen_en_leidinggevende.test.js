// Test voor "Leidinggevende toevoegen" in js/admin.js: bij een geweigerde
// uitnodiging wordt niets opgeslagen. De organisatiecontrole bij het verwijderen
// van een account wordt getest in tests/sql/accountverwijdering.sql.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

// ---- (b) Leidinggevende toevoegen ----

function leidingScherm(fetchAntwoord) {
  const volgorde = [];
  let a;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    if (body.invite_user) {
      volgorde.push('uitnodiging');
      if (fetchAntwoord instanceof Error) throw fetchAntwoord;
    }
    const data = body.invite_user ? fetchAntwoord : {};
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
  a = laadAdmin({ fetch, timers: true });
  return { a, volgorde };
}

async function voegToe(a, velden) {
  for (const [id, waarde] of Object.entries(velden)) a.ctx.document.getElementById(id).value = waarde;
  for (const fn of a.elementen['teamleider-form'].listeners.submit) await fn({ preventDefault() {} });
  await a.wacht();
}

const VELDEN = { 'tl-id': '', 'tl-naam': 'Nieuwe HR', 'tl-email': 'actief@test.nl', 'tl-telefoon': '', 'tl-titel': '', 'tl-rol': 'hr' };
const inserts = (a) => a.supabase.log.filter((q) => q.tabel === 'teamleiders' && q.acties.includes('insert'));

test('(b) geweigerde uitnodiging (account in gebruik): geen rij opgeslagen, melding, knop vrij', async () => {
  const { a } = leidingScherm({ error: 'Voor dit e-mailadres bestaat al een account dat in gebruik is. Er is niets verwijderd.', invited: false, account_status: 'in_gebruik' });
  try {
    await a.start();
    await voegToe(a, VELDEN);
    assert.equal(inserts(a).length, 0);
    assert.match(a.meldingen.alert[0], /^Niet opgeslagen: Voor dit e-mailadres bestaat al een account/);
    assert.ok(!a.supabase.log.some((q) => q.tabel === 'profiles' && q.acties.includes('update')), 'geen rolwijziging van het bestaande profiel');
    assert.equal(a.elementen['tl-submit-btn'].disabled, false);
  } finally { a.stop(); }
});

test('(b) netwerkfout bij uitnodigen: geen rij opgeslagen', async () => {
  const { a } = leidingScherm(new Error('offline'));
  try {
    await a.start();
    await voegToe(a, VELDEN);
    assert.equal(inserts(a).length, 0);
    assert.match(a.meldingen.alert[0], /Niet opgeslagen: .*offline/);
  } finally { a.stop(); }
});

test('(b) geslaagde uitnodiging: eerst uitnodigen, daarna de rij opslaan', async () => {
  const { a, volgorde } = leidingScherm({ invited: true, user_id: 'u-nieuw' });
  try {
    await a.start();
    const voorInsert = () => a.supabase.log.findIndex((q) => q.tabel === 'teamleiders' && q.acties.includes('insert'));
    await voegToe(a, { ...VELDEN, 'tl-email': 'nieuw@test.nl' });
    assert.deepEqual(volgorde, ['uitnodiging']);
    assert.equal(inserts(a).length, 1);
    assert.ok(voorInsert() >= 0);
    assert.match(a.meldingen.alert[0], /HR Medewerker toegevoegd/);
  } finally { a.stop(); }
});

test('(b) zonder e-mail: geen uitnodiging, wel opslaan', async () => {
  const { a, volgorde } = leidingScherm({});
  try {
    await a.start();
    await voegToe(a, { ...VELDEN, 'tl-email': '' });
    assert.deepEqual(volgorde, []);
    assert.equal(inserts(a).length, 1);
  } finally { a.stop(); }
});
