// Test voor het opslaan van een medewerker-bewerking (js/medewerker-opslaan.js).
// Draaien: node --test tests/*.test.js
// Gebruikt een nep-Supabase-client die alle aanroepen in volgorde vastlegt.

const test = require('node:test');
const assert = require('node:assert/strict');
const { slaMedewerkerOp } = require('../js/medewerker-opslaan.js');

// opties.huidig: de rij die profiles.select teruggeeft (null = niet gevonden)
// opties.updateFout / opties.updateRijen / opties.historieFout: gedrag van de database
function nepClient(opties) {
  const log = [];
  function query(tabel) {
    const q = { tabel, actie: null, data: null, filters: [] };
    const builder = {
      select(kolommen) { if (!q.actie) q.actie = 'select'; q.select = kolommen; return builder; },
      update(data) { q.actie = 'update'; q.data = data; return builder; },
      insert(data) { q.actie = 'insert'; q.data = data; return builder; },
      eq(kolom, waarde) { q.filters.push([kolom, waarde]); return builder; },
      maybeSingle() { q.single = true; return builder; },
      then(resolve, reject) {
        log.push(q);
        let res;
        if (q.tabel === 'profiles' && q.actie === 'select') {
          res = { data: opties.huidig === undefined ? null : opties.huidig, error: null };
        } else if (q.tabel === 'profiles' && q.actie === 'update') {
          res = opties.updateFout
            ? { data: null, error: { message: opties.updateFout } }
            : { data: opties.updateRijen !== undefined ? opties.updateRijen : [{ id: 'p1' }], error: null };
        } else if (q.tabel === 'functie_historie' && q.actie === 'insert') {
          res = { data: null, error: opties.historieFout ? { message: opties.historieFout } : null };
        } else {
          res = { data: null, error: { message: 'onverwachte aanroep' } };
        }
        return Promise.resolve(res).then(resolve, reject);
      }
    };
    return builder;
  }
  return { from: query, log };
}

const basis = { naam: 'Test Medewerker', functiegroep: 'hr_medewerker' };

test('gewijzigde functiegroep: rolwissel in de update, daarna één rij in functie_historie', async () => {
  const client = nepClient({ huidig: { functiegroep: 'ambulant_persoonlijk_begeleider' } });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.equal(res.fout, null);
  assert.equal(res.functiegroepGewijzigd, true);
  assert.equal(res.historieFout, null);

  const acties = client.log.map(q => q.tabel + ':' + q.actie);
  assert.deepEqual(acties, ['profiles:select', 'profiles:update', 'functie_historie:insert']);

  const update = client.log[1];
  assert.deepEqual(update.filters, [['id', 'p1']]);
  assert.equal(update.data.functiegroep, 'hr_medewerker');
  assert.equal(update.data.vorige_functiegroep, 'ambulant_persoonlijk_begeleider');
  assert.equal(update.data.rolwissel_gezien, false);

  const historie = client.log[2].data;
  assert.equal(historie.profile_id, 'p1');
  assert.equal(historie.vorige_functie, 'ambulant_persoonlijk_begeleider');
  assert.equal(historie.nieuwe_functie, 'hr_medewerker');
});

test('mislukte profielupdate: geen rij in functie_historie en een foutmelding', async () => {
  const client = nepClient({ huidig: { functiegroep: 'ambulant_persoonlijk_begeleider' }, updateFout: 'PROFIEL_BEVEILIGD' });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.equal(res.fout, 'PROFIEL_BEVEILIGD');
  assert.ok(!client.log.some(q => q.tabel === 'functie_historie'));
});

test('update zonder bijgewerkte rij (bijv. geen rechten): fout en geen historie', async () => {
  const client = nepClient({ huidig: { functiegroep: 'ambulant_persoonlijk_begeleider' }, updateRijen: [] });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.match(res.fout, /niet bijgewerkt/);
  assert.ok(!client.log.some(q => q.tabel === 'functie_historie'));
});

test('ongewijzigde functiegroep: geen rolwissel en geen historie', async () => {
  const client = nepClient({ huidig: { functiegroep: 'hr_medewerker' } });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.equal(res.fout, null);
  assert.equal(res.functiegroepGewijzigd, false);
  const update = client.log.find(q => q.actie === 'update');
  assert.ok(!('vorige_functiegroep' in update.data));
  assert.ok(!('rolwissel_gezien' in update.data));
  assert.ok(!client.log.some(q => q.tabel === 'functie_historie'));
});

test('profiel had nog geen functiegroep: geen rolwissel en geen historie', async () => {
  const client = nepClient({ huidig: { functiegroep: null } });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.equal(res.fout, null);
  assert.equal(res.functiegroepGewijzigd, false);
  assert.ok(!client.log.some(q => q.tabel === 'functie_historie'));
});

test('historie-insert mislukt na geslaagde update: opgeslagen, met historieFout', async () => {
  const client = nepClient({ huidig: { functiegroep: 'ambulant_persoonlijk_begeleider' }, historieFout: 'RLS' });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.equal(res.fout, null);
  assert.equal(res.historieFout, 'RLS');
});

test('medewerker niet gevonden: geen update en geen historie', async () => {
  const client = nepClient({ huidig: null });
  const res = await slaMedewerkerOp(client, 'p1', basis);

  assert.match(res.fout, /niet gevonden/);
  assert.deepEqual(client.log.map(q => q.actie), ['select']);
});

test('updateData van de aanroeper wordt niet aangepast', async () => {
  const client = nepClient({ huidig: { functiegroep: 'ambulant_persoonlijk_begeleider' } });
  const invoer = { ...basis };
  await slaMedewerkerOp(client, 'p1', invoer);
  assert.deepEqual(invoer, basis);
});
