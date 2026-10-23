// Bewaakt de rol bij (opnieuw) uitnodigen: de rij in teamleiders is de bron.
// Bug 2026-10-23: 📨 bij een leidinggevende (HR) gaf profiles.role 'medewerker',
// omdat het opnieuw-versturen-pad de rol uit een (ontbrekend) profiel nam.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bepaalUitnodigingsrol, moetRolHerstellen, zoekLeidinggevendeRij } = require('../supabase/functions/_shared/uitnodigingsrol.ts');
const { laadAdmin } = require('./helpers/admin_harness.js');

const RIJEN = [
  { id: 'r-tl', email: 'Leid.Inggevende@Test.nl ', rol: 'teamleider' },
  { id: 'r-man', email: 'manager@test.nl', rol: 'manager' },
  { id: 'r-hr', email: 'hr@test.nl', rol: 'hr' },
  { id: 'r-leeg', email: null, rol: 'manager' },
];

test('rij zoeken: exact, zonder hoofdletters en spaties; geen jokers', () => {
  assert.equal(zoekLeidinggevendeRij(RIJEN, ' leid.inggevende@test.NL').id, 'r-tl');
  assert.equal(zoekLeidinggevendeRij(RIJEN, 'hr@test.nl').id, 'r-hr');
  assert.equal(zoekLeidinggevendeRij(RIJEN, 'h_@test.nl'), null);
  assert.equal(zoekLeidinggevendeRij(RIJEN, ''), null);
});

for (const [rol, email] of [['teamleider', 'leid.inggevende@test.nl'], ['manager', 'manager@test.nl'], ['hr', 'hr@test.nl']]) {
  test(`${rol}: nieuwe uitnodiging en opnieuw versturen geven 'teamleider'`, () => {
    const rij = !!zoekLeidinggevendeRij(RIJEN, email);
    // Nieuwe uitnodiging vanuit Leidinggevenden (beheerscherm stuurt 'teamleider').
    assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: rij, gevraagdeRol: 'teamleider' }), 'teamleider');
    // Opnieuw versturen zonder profiel (de bug: viel terug op 'medewerker').
    assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: rij, profielRol: undefined }), 'teamleider');
    // Opnieuw versturen met een fout profiel ('medewerker').
    assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: rij, profielRol: 'medewerker' }), 'teamleider');
    // Een uitnodiging als medewerker voor een adres dat in teamleiders staat.
    assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: rij, gevraagdeRol: 'medewerker' }), 'teamleider');
    assert.equal(moetRolHerstellen('medewerker', rij), true);
  });
}

test('zonder rij: medewerker blijft medewerker, nooit vanzelf leidinggevende', () => {
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: false, gevraagdeRol: 'medewerker' }), 'medewerker');
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: false }), 'medewerker');
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: false, profielRol: 'medewerker' }), 'medewerker');
  assert.equal(moetRolHerstellen('medewerker', false), false);
  // Eerste uitnodiging vanuit Leidinggevenden: de rij wordt pas ná de uitnodiging opgeslagen.
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: false, gevraagdeRol: 'teamleider' }), 'teamleider');
});

test('een beheerder wordt nooit teruggezet; onbekende rol wordt medewerker', () => {
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: true, profielRol: 'admin' }), 'admin');
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: true, gevraagdeRol: 'admin' }), 'admin');
  assert.equal(moetRolHerstellen('admin', true), false);
  assert.equal(moetRolHerstellen('teamleider', true), false);
  assert.equal(bepaalUitnodigingsrol({ heeftLeidinggevendeRij: false, profielRol: 'superbaas' }), 'medewerker');
});

test('chat/index.ts: beide uitnodigingspaden halen de rol uit teamleiders', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  const uitnodigen = bron.slice(bron.indexOf('// ---- Gebruiker uitnodigen ----'), bron.indexOf('// ---- Uitnodiging opnieuw sturen ----'));
  const opnieuw = bron.slice(bron.indexOf('// ---- Uitnodiging opnieuw sturen ----'), bron.indexOf('// ---- Weekstart briefing genereren ----'));
  assert.ok(uitnodigen.length > 0 && opnieuw.length > 0, 'secties gevonden');
  for (const [naam, deel] of [['uitnodigen', uitnodigen], ['opnieuw', opnieuw]]) {
    assert.match(deel, /leidinggevendeRijVoor\(/, `${naam}: zoekt de rij in teamleiders`);
    assert.match(deel, /bepaalUitnodigingsrol\(/, `${naam}: rol via bepaalUitnodigingsrol`);
  }
  // De oude terugval op 'medewerker' uit het profiel mag niet terugkomen.
  assert.doesNotMatch(opnieuw, /resendProfile\?\.role\s*\|\|\s*["']medewerker["']/);
  assert.match(opnieuw, /moetRolHerstellen\(/);
  assert.match(opnieuw, /LEIDINGGEVENDE_ROL_HERSTELD/);
});

function maakFetch(antwoord) {
  const verzoeken = [];
  const fetch = async (url, init) => {
    verzoeken.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => antwoord, text: async () => JSON.stringify(antwoord) };
  };
  return { fetch, verzoeken };
}

test('📧 bij een leidinggevende: de melding van de server over het rolherstel wordt getoond', async () => {
  const melding = 'Dit account is al in gebruik, dus er is geen uitnodiging verstuurd. De rol is hersteld naar leidinggevende; na opnieuw inloggen is het dashboard zichtbaar.';
  const f = maakFetch({ success: true, rol_hersteld: true, message: melding });
  const a = laadAdmin({ fetch: f.fetch });
  try {
    a.ctx.confirm = () => true;
    await a.ctx.window.resendInvite('hr@test.nl', 'HR Test');
    assert.equal(f.verzoeken.length, 1);
    assert.equal(f.verzoeken[0].body.resend_invite, true);
    assert.equal(f.verzoeken[0].body.invite_role, undefined, 'de rol komt van de server, niet uit het scherm');
    assert.deepEqual(a.meldingen.alert, ['hr@test.nl: ' + melding]);
  } finally { a.stop(); }
});
