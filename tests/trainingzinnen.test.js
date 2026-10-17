// Test voor supabase/functions/_shared/trainingzinnen.ts (Node 24 leest .ts zelf).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { TRAININGEN_ZIN, verwerkTrainingZinnen, algemeneGeenTrainingZinnen, splitsZinnen } =
  require('../supabase/functions/_shared/trainingzinnen.ts');

const AGRESSIE = ['Omgaan met agressie', 'De-escaleren in de praktijk'];

test('met blok: eigen verwijzing van het model eruit, systeemzin aan het eind', () => {
  const r = verwerkTrainingZinnen('🎓 Onder dit antwoord staan trainingen die hierbij passen.\n\nBij agressie onderbreek je je werk.', AGRESSIE);
  assert.equal(r.tekst, 'Bij agressie onderbreek je je werk.\n\n' + TRAININGEN_ZIN);
  assert.equal(r.toegevoegd, true);
  assert.equal(r.verwijderd, 1);
});

test('met blok: "in de documenten/kennisbank staat geen training" mag blijven staan', () => {
  const tekst = 'In de documenten staat geen specifieke training over agressie. De kennisbank noemt geen aparte cursus.';
  const r = verwerkTrainingZinnen(tekst, AGRESSIE);
  assert.equal(r.tekst, tekst + '\n\n' + TRAININGEN_ZIN);
  assert.equal(r.vervangen, 0);
});

test('met blok: algemene "geen training"-zin wordt vervangen door de systeemzin (één keer)', () => {
  const r = verwerkTrainingZinnen('Er is geen specifieke training over agressie. Bel bij nood 112. Voor Wlz is er ook geen aparte cursus.', AGRESSIE);
  assert.equal(r.tekst, TRAININGEN_ZIN + ' Bel bij nood 112.');
  assert.equal(r.vervangen, 2);
  assert.equal(r.toegevoegd, false);
  assert.equal(r.tekst.split(TRAININGEN_ZIN).length - 1, 1);
});

test('met blok: "in StudyTube is geen training gevonden" wordt vervangen', () => {
  const r = verwerkTrainingZinnen('Bel bij nood 112.\n\nIn StudyTube heb ik geen passende training gevonden.', AGRESSIE);
  assert.equal(r.tekst, 'Bel bij nood 112.\n\n' + TRAININGEN_ZIN);
  assert.deepEqual(algemeneGeenTrainingZinnen(r.tekst), []);
});

test('met blok: herhaalde trainingslijst en de inleiding ervan verdwijnen', () => {
  const tekst = 'Ja, daar zijn trainingen voor. Onder dit antwoord staan:\n\n- **Omgaan met agressie** (45 min)\n- De-escaleren in de praktijk\n\nBel bij nood 112.';
  const r = verwerkTrainingZinnen(tekst, AGRESSIE);
  assert.equal(r.tekst, 'Ja, daar zijn trainingen voor.\n\nBel bij nood 112.\n\n' + TRAININGEN_ZIN);
});

test('zonder blok: "geen training in StudyTube" blijft, verwijzing naar hieronder gaat eruit, geen systeemzin', () => {
  const r = verwerkTrainingZinnen('In StudyTube heb ik geen passende training gevonden. Hieronder vind je trainingen die passen. Je leidinggevende kan helpen.', []);
  assert.equal(r.tekst, 'In StudyTube heb ik geen passende training gevonden. Je leidinggevende kan helpen.');
  assert.equal(r.toegevoegd, false);
  assert.ok(!r.tekst.includes(TRAININGEN_ZIN));
});

test('een gewone opsomming met "hieronder" blijft staan', () => {
  const tekst = 'Hieronder staan de stappen:\n\n1. Meld het bij je leidinggevende.\n2. Vul het meldformulier in.';
  const r = verwerkTrainingZinnen(tekst, AGRESSIE);
  assert.equal(r.tekst, tekst + '\n\n' + TRAININGEN_ZIN);
});

test('bedragen en tijden breken geen zinnen', () => {
  assert.deepEqual(splitsZinnen('Dat is €3.635 per maand. Start om 8.30 uur! Klaar'), ['Dat is €3.635 per maand. ', 'Start om 8.30 uur! ', 'Klaar']);
  const r = verwerkTrainingZinnen('FWG 35 trede 12 is €3.635.', []);
  assert.equal(r.tekst, 'FWG 35 trede 12 is €3.635.');
});

test('algemeneGeenTrainingZinnen: alleen zinnen zonder documentbron of over StudyTube', () => {
  const tekst = 'In de documenten staat geen training hierover. Er is geen cursus voor.\nIn StudyTube en de documenten is geen e-learning.';
  assert.deepEqual(algemeneGeenTrainingZinnen(tekst), ['Er is geen cursus voor.', 'In StudyTube en de documenten is geen e-learning.']);
});
