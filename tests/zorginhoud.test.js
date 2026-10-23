// Herkenning van zorginhoudelijke vragen (supabase/functions/_shared/zorginhoud.ts).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

test('zorginhoudelijke vragen worden herkend', async () => {
  const { isZorginhoudelijkeVraag } = await import('../supabase/functions/_shared/zorginhoud.ts');
  for (const v of [
    'Hoe ga ik om met een cliënt met autisme die overprikkeld raakt?',
    'Ik wil meer leren over verslaving bij cliënten. Waar kan ik dat vinden?',
    'Waar leer ik meer over trauma bij cliënten?',
    'Hoe herken ik een psychose bij een cliënt?',
    'Mijn cliënt is depressief, wat kan ik doen?',
    'Wat zijn signalen van suïcidaliteit?',
    'Hoe begeleid ik iemand met een persoonlijkheidsstoornis?',
  ]) assert.equal(isZorginhoudelijkeVraag(v), true, v);
});

test('praktische en organisatievragen niet', async () => {
  const { isZorginhoudelijkeVraag } = await import('../supabase/functions/_shared/zorginhoud.ts');
  for (const v of [
    'Hoe registreer ik een no-show in ONS?',
    'Wat verdien ik als ambulant begeleider in trede 1?',
    'Wat is het verschil tussen VPT en MPT?',
    'Wat doet de afdeling Zorgbemiddeling?',
    'Is er een training over hoe mijn salarisstrook werkt?',
    'Mag ik een storing in ONS melden bij de helpdesk?',
    'Wat moet ik doen bij agressie van een cliënt?',
  ]) assert.equal(isZorginhoudelijkeVraag(v), false, v);
});
