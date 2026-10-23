// Normalisatie van de regressietest (supabase/functions/_shared/testvergelijking.ts).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

test('kleine letters, geen accenten, & = en, streepjes en schuine strepen = spatie', async () => {
  const { normaliseerTest } = await import('../supabase/functions/_shared/testvergelijking.ts');
  assert.equal(normaliseerTest('Eén keer per Jaar'), 'een keer per jaar');
  assert.equal(normaliseerTest('cliënt  ëïé'), 'client eie');
  assert.equal(normaliseerTest('Kennis & Expertise'), 'kennis en expertise');
  assert.equal(normaliseerTest('O&S'), 'o en s');
  assert.equal(normaliseerTest('no-show / no–show'), 'no show no show');
  assert.equal(normaliseerTest('regel\n\n  twee'), 'regel twee');
  assert.equal(normaliseerTest('€3.564'), '€3.564');
  assert.equal(normaliseerTest(null), '');
});

test('vergelijking werkt aan beide kanten', async () => {
  const { normaliseerTest, bevatTest } = await import('../supabase/functions/_shared/testvergelijking.ts');
  const a = normaliseerTest('Je evalueert **ten minste één keer per jaar** via WIZ; meld het bij Kennis & Expertise of registreer een No-Show.');
  assert.ok(bevatTest(a, 'een keer per jaar'));
  assert.ok(bevatTest(a, 'kennis en expertise'));
  assert.ok(bevatTest(a, 'Kennis & Expertise'));
  assert.ok(bevatTest(a, 'no show'));
  assert.ok(bevatTest(a, 'no-show'));
  assert.ok(!bevatTest(a, 'noshow'));
  assert.ok(!bevatTest(a, ''));
});
