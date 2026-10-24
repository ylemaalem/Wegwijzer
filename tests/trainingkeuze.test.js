// Trainingskeuze op onderwerp en vervolgvragen (F2 stap 2, 2026-10-24).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { vorigeVraagUitGesprek, VORIGE_VRAAG_MAX_MS, leesOnderwerp, leesKeuze, trainingOnderwerpPrompt, trainingSelectiePrompt } = require('../supabase/functions/_shared/trainingkeuze.ts');

const NU = 1_800_000_000_000;
const gesprek = (minuten) => [
  { role: 'user', content: 'Een autistische cliënt wil op hetzelfde tijdstip afspreken.', t: NU - minuten * 60_000 },
  { role: 'assistant', content: 'Bied een alternatief aan.', t: NU - minuten * 60_000 + 5000 },
  { role: 'user', content: 'Het gaat mij om de cliënt.', t: NU },
];

test('vorige vraag: binnen 60 minuten wel, daarna niet', () => {
  assert.equal(vorigeVraagUitGesprek(gesprek(5), NU), 'Een autistische cliënt wil op hetzelfde tijdstip afspreken.');
  assert.equal(vorigeVraagUitGesprek(gesprek(59), NU), 'Een autistische cliënt wil op hetzelfde tijdstip afspreken.');
  assert.equal(vorigeVraagUitGesprek(gesprek(61), NU), null);
  assert.equal(VORIGE_VRAAG_MAX_MS, 60 * 60 * 1000);
});

test('vorige vraag: zonder tijden (oude app), zonder client_tijd of met één bericht niet', () => {
  const zonderT = gesprek(5).map(({ t, ...m }) => m);
  assert.equal(vorigeVraagUitGesprek(zonderT, NU), null);
  assert.equal(vorigeVraagUitGesprek(gesprek(5), undefined), null);
  assert.equal(vorigeVraagUitGesprek([{ role: 'user', content: 'x', t: NU }], NU), null);
  assert.equal(vorigeVraagUitGesprek(null, NU), null);
  // Tijd in de toekomst (meer dan een minuut): niet vertrouwen.
  assert.equal(vorigeVraagUitGesprek(gesprek(-5), NU), null);
});

test('onderwerp lezen: GEEN = null, tekens opgeschoond', () => {
  assert.equal(leesOnderwerp('GEEN'), null);
  assert.equal(leesOnderwerp('Geen.'), null);
  assert.equal(leesOnderwerp('"schizofrenie, psychische stoornissen".'), 'schizofrenie, psychische stoornissen');
  assert.equal(leesOnderwerp('autisme; drop table'), 'autisme drop table');
  assert.equal(leesOnderwerp(''), null);
  assert.ok(leesOnderwerp('a'.repeat(200)).length <= 80);
});

test('keuze lezen: hoogstens 3, uniek, binnen bereik; geen = leeg', () => {
  assert.deepEqual(leesKeuze('2, 5', 10), [1, 4]);
  assert.deepEqual(leesKeuze('geen', 10), []);
  assert.deepEqual(leesKeuze('1,1,2,3,4', 10), [0, 1, 2]);
  assert.deepEqual(leesKeuze('0, 11, 3', 10), [2]);
});

test('prompts: vorige vraag alleen als die er is; keuze krijgt beschrijving en "liever geen"', () => {
  assert.doesNotMatch(trainingOnderwerpPrompt('Hoe declareer ik?', null), /Vorige vraag/);
  assert.match(trainingOnderwerpPrompt('Het gaat mij om de cliënt', 'autistische cliënt'), /Vorige vraag: autistische cliënt/);
  assert.match(trainingOnderwerpPrompt('x', null), /declareren/);
  const p = trainingSelectiePrompt('vraag', 'schizofrenie, psychische stoornissen', null, [{ naam: 'Psychische stoornissen en trauma - Inleiding', beschrijving: 'Psychische stoornissen, trauma' }]);
  assert.match(p, /1\. Psychische stoornissen en trauma - Inleiding — Psychische stoornissen, trauma/);
  assert.match(p, /Liever "geen"/);
});

test('chat/index.ts: onderwerp-route achter de schakelaar, vorige vraag alleen uit messages', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.match(bron, /const vorigeVraag: string \| null = trainingOnderwerpAan \? vorigeVraagUitGesprek\(clientMessages, body\.client_tijd\) : null;/);
  assert.match(bron, /if \(trainingOnderwerpAan\) return zoekTrainingenOpOnderwerp\(\);/);
  // De vorige vraag komt niet uit het servergeheugen (recenteGesprekken).
  const blok = bron.slice(bron.indexOf('const zoekTrainingenOpOnderwerp'), bron.indexOf('const zoekTrainingen = async'));
  assert.doesNotMatch(blok, /recenteGesprekken|geheugenContext/);
  assert.match(blok, /\.select\("naam, beschrijving"\)/);
});

test('medewerker.js: berichten met tijd en client_tijd in het verzoek', () => {
  const mw = fs.readFileSync(path.join(__dirname, '..', 'js', 'medewerker.js'), 'utf8');
  assert.match(mw, /conversatieHistorie\.push\(\{ role: 'user', content: vraag, t: Date\.now\(\) \}\)/);
  assert.match(mw, /client_tijd: Date\.now\(\)/);
});
