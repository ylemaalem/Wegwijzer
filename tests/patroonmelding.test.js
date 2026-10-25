// Patroonmelding: zorgwekkende termen met woordgrenzen (H1, termenlijst akkoord Younes 2026-10-25).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zorgwekkendeOnderwerpen, isZorgwekkend } = require('../supabase/functions/_shared/patroonmelding.ts');

test('GEEN melding (testset Younes)', () => {
  for (const v of [
    'Hoe kan ik mijn rooster opslaan?',
    'Is dat noodzakelijk?',
    'Mag ik een dienst overslaan?',
    'Er dreigt een tekort aan personeel',
    'Hoe vraag ik zorgverlof aan bij nood in de familie?',
    'Wat is het levenseinde-beleid?',
    'Mag ik de nooduitgang gebruiken?',
    'Ik heb mijn uren opgeslagen',
    'Hoe sla ik een document op?',
  ]) assert.deepEqual(zorgwekkendeOnderwerpen(v), [], v);
});

test('WEL melding (testset Younes), met het juiste onderwerp', () => {
  const verwacht = [
    ['Hoe ga ik om met een agressieve cliënt?', 'agressie'],
    ['Wat doe ik bij geweld?', 'agressie'],
    ['Waar vind ik het crisisplan?', 'crisissituaties'],
    ['Mijn cliënt is suïcidaal, wat nu?', 'suïcidaliteit'],
    ['Hij dreigt te slaan.', 'agressie'],
    ['Hij dreigt mij te slaan', 'agressie'],
    ['Ik word bedreigd door een cliënt', 'agressie'],
    ['Er is een dreiging van een cliënt', 'agressie'],
    ['Bij een noodgeval bel ik wie?', 'crisissituaties'],
    ['Mijn cliënt wil niet meer leven', 'suïcidaliteit'],
    ['Een cliënt praat over zelfmoordgedachten', 'suïcidaliteit'],
    ['AGRESSIVITEIT in de wijk', 'agressie'],
  ];
  for (const [v, o] of verwacht) assert.equal(zorgwekkendeOnderwerpen(v)[0], o, v);
  assert.equal(isZorgwekkend(null), false);
});

test('chat/index.ts gebruikt de module, geen includes() op de oude lijst', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.doesNotMatch(s, /ZORGWEKKENDE_TERMEN/);
  assert.match(s, /const gevondenOnderwerpen = zorgwekkendeOnderwerpen\(vraag\);/);
  assert.match(s, /meldingNodig\(weekConvs as Array/);
});

test('H2/H3: bestaande melding per groep gezocht; week en push volgens de module en teamleiders', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.match(s, /\.in\("team", groep\.teams\)\.gte\("created_at", weekStart\.toISOString\(\)\)/);
  assert.match(s, /const weekStart = weekBeginNl\(\);/);
  assert.doesNotMatch(s, /weekStart\.setHours\(0, 0, 0, 0\)/);
  assert.match(s, /from\("teamleiders"\)\s*\.select\("email, teams"\)\.eq\("tenant_id", profile\.tenant_id\)\.eq\("rol", "teamleider"\)/);
  assert.doesNotMatch(s, /\.contains\("teams", \[teamVoorMelding\]\)/, 'push niet meer via profiles.teams');
});

const { teltVoorDrempel, kiesGroep, meldingNodig, weekBeginNl } = require('../supabase/functions/_shared/patroonmelding.ts');
const NU = new Date('2026-10-25T12:00:00Z');
const mw = (id, teams, extra = {}) => ({ id, role: 'medewerker', teams, eerste_login_op: '2026-10-01T08:00:00Z', ...extra });

test('H3: wie telt mee voor de drempel', () => {
  assert.equal(teltVoorDrempel(mw('a', ['A']), NU), true);
  assert.equal(teltVoorDrempel(mw('a', ['A'], { eerste_login_op: null, laatste_actief: null }), NU), false, 'nooit ingelogd');
  assert.equal(teltVoorDrempel(mw('a', ['A'], { einddatum: '2026-10-24' }), NU), false, 'verlopen');
  assert.equal(teltVoorDrempel(mw('a', ['A'], { einddatum: '2026-10-25' }), NU), true, 'laatste dag');
  assert.equal(teltVoorDrempel(mw('a', ['A'], { role: 'teamleider' }), NU), false);
  assert.equal(teltVoorDrempel(mw('a', ['A'], { alleen_dashboard: true }), NU), false);
});

test('H3: groep = team bij 5 actieven, anders de teams van de teamleider samen, anders geen melding', () => {
  const vijf = ['1', '2', '3', '4', '5'].map((i) => mw(i, ['A']));
  assert.deepEqual(kiesGroep('A', [], vijf, '1', NU), { teams: ['A'], leden: ['1', '2', '3', '4', '5'], samengevoegd: false });
  const klein = [mw('1', ['A']), mw('2', ['A']), mw('3', ['B']), mw('4', ['B']), mw('5', ['C']), mw('6', ['B'], { eerste_login_op: null })];
  assert.equal(kiesGroep('A', [['A']], klein, '1', NU), null, 'alleen team A: te klein');
  assert.equal(kiesGroep('A', [['A', 'B'], ['C']], klein, '1', NU), null, 'A+B: 4 actieven (nooit ingelogd telt niet), te klein');
  const g = kiesGroep('A', [['A', 'B'], ['A', 'C']], klein, '1', NU);
  assert.deepEqual(g.teams, ['A', 'B', 'C'], 'twee teamleiders van A: al hun teams samen');
  assert.equal(g.leden.length, 5);
  assert.equal(g.samengevoegd, true);
  // De vraagsteller zelf telt altijd mee (net ingelogd, eerste_login_op nog leeg).
  const nieuw = [mw('1', ['A'], { eerste_login_op: null }), ...['2', '3', '4', '5'].map((i) => mw(i, ['A']))];
  assert.equal(kiesGroep('A', [], nieuw, '1', NU).leden.length, 5);
});

test('H3: minstens 3 zorgwekkende vragen van minstens 2 medewerkers', () => {
  const z = (u) => ({ user_id: u, vraag: 'Hoe ga ik om met agressie?' });
  assert.equal(meldingNodig([z('a'), z('b')], 'a'), true);
  assert.equal(meldingNodig([z('a'), z('a')], 'a'), false, 'alleen één persoon');
  assert.equal(meldingNodig([z('b')], 'a'), false, 'maar 2 vragen');
  assert.equal(meldingNodig([z('b'), { user_id: 'c', vraag: 'Hoe kan ik mijn rooster opslaan?' }], 'a'), false);
});

test('H3: week begint maandag 00:00 Nederlandse tijd (zomer- en wintertijd)', () => {
  // Zondag 25 okt 2026 (dag van de overgang): maandag 19 okt 00:00 NL = 18 okt 22:00 UTC (zomertijd).
  assert.equal(weekBeginNl(new Date('2026-10-25T12:00:00Z')).toISOString(), '2026-10-18T22:00:00.000Z');
  // Maandag 26 okt 00:30 NL (wintertijd) = 25 okt 23:30 UTC: week begint 25 okt 23:00 UTC.
  assert.equal(weekBeginNl(new Date('2026-10-25T23:30:00Z')).toISOString(), '2026-10-25T23:00:00.000Z');
  // Woensdag 4 nov: maandag 2 nov 00:00 NL = 1 nov 23:00 UTC.
  assert.equal(weekBeginNl(new Date('2026-11-04T09:00:00Z')).toISOString(), '2026-11-01T23:00:00.000Z');
});
