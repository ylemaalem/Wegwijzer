// Daglimiet chatvragen en "extra vragen" (bug 2026-10-24): teamleider/HR kregen het
// aanbod maar konden niet uitbreiden; uitbreiden faalde voor iedereen (todayStr niet
// in bereik); het scherm meldde altijd "geactiveerd" met vaste getallen.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bouwMail } = require('../supabase/functions/admin-notificatie/mail.ts');

const chat = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
const mw = fs.readFileSync(path.join(__dirname, '..', 'js', 'medewerker.js'), 'utf8');

test('server: uitbreiden voor alle rollen behalve de beheerder, met eigen datum', () => {
  const blok = chat.slice(chat.indexOf('// Rate limit uitbreiden'), chat.indexOf('// ---- PDF extractie via Claude ----'));
  assert.ok(blok.length > 0);
  assert.match(blok, /if \(extend_limit\) \{/);
  assert.doesNotMatch(blok, /role === "medewerker"/);
  assert.match(blok, /profile\.role === "admin"/);
  assert.match(blok, /vandaagVoorLimiet\(\)/, 'datum hier zelf bepaald (todayStr bestond hier niet)');
  assert.doesNotMatch(blok, /datum: todayStr/);
  assert.match(blok, /extended: true, basis_limiet: basisLimiet, extra_vragen: extraVragen/);
  assert.match(blok, /extended: false/);
});

test('server: zachte limiet stuurt de getallen mee; limiet geldt voor alle rollen behalve beheerder', () => {
  assert.match(chat, /soft_limit: true, basis_limiet: basisLimiet, extra_vragen: extraVragen/);
  assert.match(chat, /if \(profile\.role !== "admin"\) \{\s*const \{ count: todayCount \}/);
});

test('scherm: getallen van de server, "geactiveerd" alleen bij extended === true', () => {
  const popup = mw.slice(mw.indexOf('function toonRateLimitPopup'), mw.indexOf('// HULPFUNCTIES'));
  assert.equal((mw.match(/toonRateLimitPopup\(token, data\)/g) || []).length, 2);
  assert.doesNotMatch(popup, /dagelijkse 30 vragen|nog 20 extra/);
  assert.match(popup, /info\.basis_limiet/);
  assert.match(popup, /info\.extra_vragen/);
  assert.match(popup, /if \(uitkomst && uitkomst\.extended === true\)/);
  // De melding "geactiveerd" staat alleen in de tak van extended === true.
  const jaTak = popup.slice(popup.indexOf('uitkomst.extended === true'), popup.indexOf('} else {', popup.indexOf('uitkomst.extended === true')));
  assert.match(jaTak, /geactiveerd/);
  assert.equal((popup.match(/renderBotBericht\([^)]*geactiveerd/g) || []).length, 1);
});

test('mail bij eerste vraag: zegt "eerste vraag", niet "eerste login" of "voor het eerst gebruikt"', () => {
  const m = bouwMail({ type: 'eerste_login', medewerker_naam: 'Sam', datum: '24 oktober 2026' });
  assert.equal(m.subject, 'Sam heeft de eerste vraag aan Wegwijzer gesteld');
  assert.match(m.html, /heeft op <strong>24 oktober 2026<\/strong> de eerste vraag aan Wegwijzer gesteld/);
  assert.doesNotMatch(m.subject + m.html, /login|voor het eerst gebruikt/i);
});
