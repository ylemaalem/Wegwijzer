// Test voor de knoppen 📨 Uitnodiging en 🔑 Reset in de medewerkerslijst (js/admin.js).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

function maakFetch(antwoord) {
  const verzoeken = [];
  const fetch = async (url, init) => {
    verzoeken.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => antwoord, text: async () => JSON.stringify(antwoord) };
  };
  return { fetch, verzoeken };
}

function knop() {
  return { textContent: '🔑 Reset', disabled: false };
}

test('🔑 Reset vraagt de server om een resetmail (reset_wachtwoord), niet om een nieuw account', async () => {
  const f = maakFetch({ success: true, message: 'Resetmail verstuurd. Het account is niet gewijzigd.' });
  const a = laadAdmin({ fetch: f.fetch });
  try {
    await a.ctx.window.stuurUitnodiging(knop(), 'medewerker@test.nl', 'Mede Werker', true);
    assert.equal(f.verzoeken.length, 1);
    assert.equal(f.verzoeken[0].body.resend_invite, true);
    assert.equal(f.verzoeken[0].body.reset_wachtwoord, true);
    assert.deepEqual(a.toasts(), ['✅ Resetmail verstuurd. Het account is niet gewijzigd. (medewerker@test.nl)']);
  } finally { a.stop(); }
});

test('📨 Uitnodiging stuurt reset_wachtwoord=false', async () => {
  const f = maakFetch({ success: true, message: 'Uitnodiging opnieuw verstuurd' });
  const a = laadAdmin({ fetch: f.fetch });
  try {
    await a.ctx.window.stuurUitnodiging(knop(), 'nieuw@test.nl', 'Nieuw', false);
    assert.equal(f.verzoeken[0].body.reset_wachtwoord, false);
  } finally { a.stop(); }
});

test('account in gebruik: de melding van de server verschijnt als venster', async () => {
  const melding = 'Voor dit e-mailadres bestaat al een account dat in gebruik is. Er is niets verwijderd.';
  const f = maakFetch({ error: melding, account_status: 'in_gebruik' });
  const a = laadAdmin({ fetch: f.fetch });
  try {
    const k = knop();
    await a.ctx.window.stuurUitnodiging(k, 'actief@test.nl', 'Actief', false);
    assert.deepEqual(a.meldingen.alert, [melding]);
    assert.equal(k.disabled, false);
  } finally { a.stop(); }
});
