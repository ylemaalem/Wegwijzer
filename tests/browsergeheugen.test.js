// Browsergeheugen van de chat (F2 stap 2c, 2026-10-24): wissen na 60 minuten zonder
// vraag, en een mislukte vraag uit het geheugen halen.
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { moetGeheugenWissen, haalBerichtWeg, GEHEUGEN_MAX_STIL_MS } = require('../js/gespreksgeheugen.js');

const NU = 1_800_000_000_000;
const MIN = 60_000;

test('wissen pas na meer dan 60 minuten zonder vraag', () => {
  assert.equal(GEHEUGEN_MAX_STIL_MS, 60 * MIN);
  assert.equal(moetGeheugenWissen(NU - 59 * MIN, NU), false);
  assert.equal(moetGeheugenWissen(NU - 60 * MIN, NU), false, 'precies 60 minuten telt nog mee, net als op de server');
  assert.equal(moetGeheugenWissen(NU - 61 * MIN, NU), true);
  assert.equal(moetGeheugenWissen(0, NU), false, 'nog geen vraag in dit scherm');
});

test('mislukte vraag: precies dat bericht eruit, een eerdere gelijke vraag blijft', () => {
  const eerder = { role: 'user', content: 'Hoe declareer ik?', t: NU - 5 * MIN };
  const antwoord = { role: 'assistant', content: 'Zo.', t: NU - 5 * MIN };
  const mislukt = { role: 'user', content: 'Hoe declareer ik?', t: NU };
  const h = [eerder, antwoord, mislukt];
  haalBerichtWeg(h, mislukt);
  assert.deepEqual(h, [eerder, antwoord]);
  haalBerichtWeg(h, { role: 'user', content: 'Hoe declareer ik?' });
  assert.equal(h.length, 2, 'een ander object met dezelfde tekst haalt niets weg');
});

test('scenario: mislukte vraag telt niet als vorige vraag op de server', () => {
  const { vorigeVraagUitGesprek } = require('../supabase/functions/_shared/trainingkeuze.ts');
  const h = [];
  const v1 = { role: 'user', content: 'Een autistische cliënt wil vaste tijden.', t: NU - 2 * MIN };
  h.push(v1); haalBerichtWeg(h, v1); // mislukt (bijv. verbindingsfout)
  const v2 = { role: 'user', content: 'Hoe declareer ik reiskosten?', t: NU };
  h.push(v2);
  assert.equal(vorigeVraagUitGesprek(h, NU), null);
});

const mw = fs.readFileSync(path.join(__dirname, '..', 'js', 'medewerker.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'medewerker.html'), 'utf8');

test('medewerker.js: wissen vóór de nieuwe vraag, met scheidingsregel; mislukte vraag eruit', () => {
  const f = mw.slice(mw.indexOf('async function verstuurVraag'), mw.indexOf('// BERICHTEN RENDEREN'));
  const wis = f.indexOf('WegwijzerGeheugen.moetGeheugenWissen(laatsteVraagTijd, Date.now())');
  assert.ok(wis > 0 && wis < f.lastIndexOf('renderGebruikersBericht(vraag, null)'), 'controle vóór het tonen van de vraag');
  assert.match(f, /conversatieHistorie = \[\];\s*toonNieuwGesprekScheiding\(\);/);
  assert.match(f, /vraagGelukt = true;/);
  assert.match(f, /if \(!vraagGelukt && vraagBericht\) WegwijzerGeheugen\.haalBerichtWeg\(conversatieHistorie, vraagBericht\);/);
  // vraagGelukt alleen in de tak met een echt antwoord.
  assert.equal((f.match(/vraagGelukt = true;/g) || []).length, 1);
  assert.ok(f.indexOf('vraagGelukt = true;') > f.indexOf("conversatieHistorie.push({ role: 'assistant', content: data.antwoord"));
  assert.match(mw, /'— Nieuw gesprek \(na een uur zonder vragen\) —'/);
});

test('medewerker.html: gespreksgeheugen.js vóór medewerker.js, nieuwe versies', () => {
  assert.ok(html.indexOf('js/gespreksgeheugen.js?v=1') > 0);
  assert.ok(html.indexOf('js/gespreksgeheugen.js?v=1') < html.indexOf('js/medewerker.js?v=21'));
});
