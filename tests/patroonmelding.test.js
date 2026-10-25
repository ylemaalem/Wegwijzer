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
  assert.match(s, /if \(isZorgwekkend\(conv\.vraag\)\) zorgCount\+\+;/);
});
