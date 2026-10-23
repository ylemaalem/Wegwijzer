// Beheerdersmails (supabase/functions/admin-notificatie/mail.ts): ingevoerde tekst
// wordt ge-escaped, zodat er geen HTML of script van gebruikers in de mail komt.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { bouwMail, escapeHtml } = require('../supabase/functions/admin-notificatie/mail.ts');

const KWAAD = '<b>x</b> <script>alert(1)</script> <a href="https://evil.example">klik</a> & \'q\'';

test('escapeHtml: tekens die HTML maken worden onschadelijk', () => {
  assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & "b" \'c\''), 'a &amp; &quot;b&quot; &#39;c&#39;');
  assert.equal(escapeHtml(null), '');
});

for (const [type, velden] of [
  ['privacy_verzoek', { naam: KWAAD, email: KWAAD, verzoek_type: KWAAD }],
  ['document_aanvraag', { vraag: KWAAD }],
  ['eerste_login', { medewerker_naam: KWAAD, datum: KWAAD }],
]) {
  test(`${type}: geen <b>, <script> of eigen link in de HTML`, () => {
    const m = bouwMail(Object.assign({ type }, velden));
    assert.ok(m);
    assert.doesNotMatch(m.html, /<b>|<script|evil\.example">/);
    assert.match(m.html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(m.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    // De eigen link naar het dashboard blijft echte HTML.
    if (type !== 'eerste_login') assert.match(m.html, /<a href="https:\/\/app\.mijnwegwijzer\.com\/admin\.html">/);
    assert.doesNotMatch(m.subject, /[\r\n]/);
  });
}

test('onderwerp zonder regeleinden; lege velden worden "-"', () => {
  const m = bouwMail({ type: 'privacy_verzoek', naam: 'Jan\r\nBcc: x@y.nl' });
  assert.equal(m.subject, 'Nieuw privacyverzoek van Jan Bcc: x@y.nl');
  assert.match(m.html, /<strong>Email:<\/strong> -<br>/);
});

test('onbekend type: geen mail', () => {
  assert.equal(bouwMail({ type: 'iets' }), null);
});
