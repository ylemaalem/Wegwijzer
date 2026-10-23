// Leidinggevende bewerken met een nieuw e-mailadres: de vraag "Uitnodiging nu
// versturen?" met een knop. Niet automatisch uitnodigen (besluit Younes, 2026-10-23).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadAdmin } = require('./helpers/admin_harness.js');

const RIJ = { id: 'tl1', tenant_id: 't1', naam: 'Test HR', email: null, telefoon: null, titel: null, rol: 'hr', teams: null, afdelingen: null };

function scherm(rij) {
  const verzoeken = [];
  const fetch = async (url, init) => {
    verzoeken.push(JSON.parse(init.body || '{}'));
    const data = { success: true, message: 'Uitnodigingsmail verstuurd' };
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
  const a = laadAdmin({ fetch, timers: true, confirm: true, tabellen: { teamleiders: [rij], profiles: [] } });
  return { a, verzoeken };
}

async function bewaar(a, email) {
  a.ctx.editTeamleider('tl1');
  a.ctx.document.getElementById('tl-email').value = email;
  for (const fn of a.elementen['teamleider-form'].listeners.submit) await fn({ preventDefault() {} });
  await a.wacht();
}

test('nieuw e-mailadres bij bewerken: vraag met knop, geen automatische uitnodiging', async () => {
  const { a, verzoeken } = scherm(Object.assign({}, RIJ));
  try {
    await a.start();
    await bewaar(a, 'nieuw.hr@test.nl');
    assert.equal(verzoeken.length, 0, 'niets automatisch verstuurd');
    const vraag = a.elementen['tl-uitnodiging-vraag'];
    assert.equal(vraag.style.display, '');
    assert.match(vraag.kinderen[0].textContent, /^Uitnodiging nu versturen\? Test HR \(nieuw\.hr@test\.nl\)/);
    assert.equal(vraag.kinderen[1].textContent, '📧 Uitnodiging versturen');

    // Klik op de knop: het 📧-pad, zonder tweede bevestiging, mét rol_herstellen.
    for (const fn of vraag.kinderen[1].listeners.click) await fn({});
    await a.wacht();
    assert.equal(verzoeken.length, 1);
    assert.equal(verzoeken[0].resend_invite, true);
    assert.equal(verzoeken[0].rol_herstellen, true);
    assert.equal(verzoeken[0].invite_email, 'nieuw.hr@test.nl');
    assert.equal(a.meldingen.confirm.length, 0, 'geen dubbele bevestiging');
    assert.equal(vraag.style.display, 'none');
  } finally { a.stop(); }
});

test('"Later": vraag weg, niets verstuurd', async () => {
  const { a, verzoeken } = scherm(Object.assign({}, RIJ));
  try {
    await a.start();
    await bewaar(a, 'nieuw.hr@test.nl');
    const vraag = a.elementen['tl-uitnodiging-vraag'];
    for (const fn of vraag.kinderen[2].listeners.click) await fn({});
    assert.equal(vraag.style.display, 'none');
    assert.equal(verzoeken.length, 0);
  } finally { a.stop(); }
});

test('zelfde e-mailadres (andere hoofdletters): geen vraag', async () => {
  const { a, verzoeken } = scherm(Object.assign({}, RIJ, { email: 'hr@test.nl' }));
  try {
    await a.start();
    await bewaar(a, 'HR@test.nl');
    assert.notEqual(a.elementen['tl-uitnodiging-vraag'] && a.elementen['tl-uitnodiging-vraag'].style.display, '');
    assert.equal(verzoeken.length, 0);
  } finally { a.stop(); }
});
