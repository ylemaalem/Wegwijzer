// Sparringsmodus (26-10-2026): de server zet "Onder dit antwoord staan trainingen" in de
// tekst; de app moet die trainingen dan ook tonen, net als bij een gewone vraag.
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'medewerker.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'medewerker.html'), 'utf8');

test('sparring: antwoord met trainingen en herkomst renderen', () => {
  const start = js.indexOf('async function voltooiSparring');
  const eind = js.indexOf('async function verstuurVraag');
  assert.ok(start > 0 && eind > start);
  const blok = js.slice(start, eind);
  assert.match(blok, /renderBotBericht\(data\.antwoord, data\.conversation_id, null, null, data\.trainingen \|\| \[\], data\.herkomst \|\| null\)/);
  assert.doesNotMatch(blok, /renderBotBericht\(data\.antwoord, data\.conversation_id, null, null\);/);
});

test('medewerker.js versie opgehoogd', () => {
  assert.match(html, /js\/medewerker\.js\?v=23/);
});
