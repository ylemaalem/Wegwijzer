// Servergeheugen alleen eerder in dit gesprek (F2 stap 2b, 2026-10-24).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { kiesServerGeheugen, geheugenTekst, GESPREKSGEHEUGEN_REGEL, SERVERGEHEUGEN_MAX_MS } = require('../supabase/functions/_shared/gespreksgeheugen.ts');

const NU = Date.parse('2026-10-24T12:00:00Z');
const rij = (vraag, minuten) => ({ vraag, antwoord: 'antwoord op ' + vraag, created_at: new Date(NU - minuten * 60_000).toISOString() });

test('alleen de laatste 60 minuten, oudste eerst, hoogstens 3', () => {
  const rijen = [rij('d', 1), rij('c', 10), rij('b', 59), rij('a', 61), rij('gisteren', 60 * 24)];
  assert.deepEqual(kiesServerGeheugen(rijen, [], NU).map((r) => r.vraag), ['b', 'c', 'd']);
  assert.deepEqual(kiesServerGeheugen([rij('e', 1), ...rijen], [], NU).map((r) => r.vraag), ['c', 'd', 'e']);
  assert.equal(SERVERGEHEUGEN_MAX_MS, 60 * 60 * 1000);
});

test('niet dubbel met het browsergeheugen (zelfde vraag, spaties/hoofdletters genegeerd)', () => {
  const rijen = [rij('Hoe declareer ik?', 2), rij('Wat is een no-show?', 5)];
  const messages = [{ role: 'user', content: '  hoe  declareer ik? ' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'nieuwe vraag' }];
  assert.deepEqual(kiesServerGeheugen(rijen, messages, NU).map((r) => r.vraag), ['Wat is een no-show?']);
  // Een antwoordtekst in messages telt niet als vraag.
  assert.equal(kiesServerGeheugen([rij('x', 2)], [{ role: 'assistant', content: 'x' }], NU).length, 1);
});

test('tekst: "eerder in dit gesprek", leeg zonder rijen; regel zonder "eerdere sessies"', () => {
  assert.equal(geheugenTekst([]), '');
  assert.match(geheugenTekst([rij('a', 1)]), /GESPREKSGEHEUGEN — eerder in dit gesprek \(laatste 60 minuten, oudste eerst\)/);
  assert.match(GESPREKSGEHEUGEN_REGEL, /eerder in dit gesprek/);
  assert.doesNotMatch(GESPREKSGEHEUGEN_REGEL, /eerdere sessies/);
});

test('chat/index.ts: query begrensd op 60 minuten', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.match(bron, /\.gte\("created_at", new Date\(nuGeheugen - SERVERGEHEUGEN_MAX_MS\)\.toISOString\(\)\)/);
  assert.match(bron, /kiesServerGeheugen\(geheugenRijen, clientMessages, nuGeheugen\)/);
  assert.match(bron, /\$\{geheugenRegel\}/);
});

test('schakelaar: uit = oud gedrag letterlijk; runner geeft de testoptie door', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  const { GESPREKSGEHEUGEN_REGEL_OUD } = require('../supabase/functions/_shared/gespreksgeheugen.ts');
  assert.match(GESPREKSGEHEUGEN_REGEL_OUD, /in eerdere sessies heeft gesteld/);
  assert.match(bron, /const servergeheugen60Aan: boolean = isTest && typeof body\.test_servergeheugen_60 === "boolean"/);
  assert.match(bron, /const geheugenRegel = servergeheugen60Aan \? GESPREKSGEHEUGEN_REGEL : GESPREKSGEHEUGEN_REGEL_OUD;/);
  assert.equal((bron.match(/test_servergeheugen_60: isTest && servergeheugen60Aan !== SERVERGEHEUGEN_60_AAN/g) || []).length, 2);
});
