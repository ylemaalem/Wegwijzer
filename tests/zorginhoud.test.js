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

// ---- Tweede stap: oordeel van het model als de lijst niets vindt (2026-10-24) ----
const { leesJaNee, zorginhoudClassificatiePrompt } = require('../supabase/functions/_shared/zorginhoud.ts');

test('leesJaNee: JA/NEE herkennen, anders null', () => {
  assert.equal(leesJaNee('JA'), true);
  assert.equal(leesJaNee(' ja.'), true);
  assert.equal(leesJaNee('NEE'), false);
  assert.equal(leesJaNee('Nee, dit is praktisch'), false);
  assert.equal(leesJaNee(''), null);
  assert.equal(leesJaNee(null), null);
  assert.equal(leesJaNee('Misschien'), null);
});

test('classificatieprompt: noemt de gemiste voorbeelden en sluit praktische werkvragen uit', () => {
  const p = zorginhoudClassificatiePrompt('Hoe begeleid ik iemand met NAH?');
  for (const w of ['dubbele diagnose', 'NAH', 'gedragsproblemen', 'verlof', 'uren schrijven', 'declareren', 'salaris', 'rooster']) {
    assert.ok(p.includes(w), w);
  }
  assert.match(p, /alleen JA of NEE/);
  assert.match(p, /Vraag: Hoe begeleid ik iemand met NAH\?$/);
});

test('chat/index.ts: lijst eerst, model alleen zonder lijsttreffer en alleen als ZORG_MODEL_AAN of testoptie', () => {
  const bron = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.match(bron, /const zorgModelPromise: Promise<boolean \| null> = \(!zorgLijst && zorgModelAan\) \? vraagZorgModel\(vraag\) : Promise\.resolve\(null\);/);
  assert.match(bron, /if \(!isZorginhoudelijk && zorgModelOordeel === true\) isZorginhoudelijk = true;/);
  assert.match(bron, /const zorgModelAan: boolean = isTest && typeof body\.test_zorg_model === "boolean" \? body\.test_zorg_model : ZORG_MODEL_AAN;/);
  // Het oordeel moet vóór het eerste gebruik in de systeemprompt afgewacht zijn.
  assert.ok(bron.indexOf('const zorgModelOordeel = await zorgModelPromise;') < bron.indexOf('ZORGINHOUDELIJK_GEEN_DOC : `'));
});
