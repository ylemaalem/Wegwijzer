// Test voor supabase/functions/_shared/accountcheck.ts: wanneer mag een bestaand
// account bij (opnieuw) uitnodigen verwijderd worden?
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { beoordeelBestaandAccount, meldingVoorBeheerder } = require('../supabase/functions/_shared/accountcheck.ts');

const T = 'tenant-1';
const profiel = (extra) => Object.assign({ id: 'p1', tenant_id: T, eerste_login_op: null, laatste_actief: null }, extra || {});

test('geen account: gewoon uitnodigen', () => {
  assert.equal(beoordeelBestaandAccount(null, [], 0, T).actie, 'nieuw');
});

test('nooit ingelogd, geen profiel, geen gesprekken: verwijderen mag', () => {
  assert.equal(beoordeelBestaandAccount({ id: 'u1', last_sign_in_at: null }, [], 0, T).actie, 'verwijderen');
});

test('ooit ingelogd (auth): in gebruik, niets verwijderen', () => {
  const b = beoordeelBestaandAccount({ id: 'u1', last_sign_in_at: '2026-10-01T10:00:00Z' }, [profiel()], 0, T);
  assert.equal(b.actie, 'in_gebruik');
  assert.equal(b.laatstIngelogd, '2026-10-01T10:00:00Z');
});

test('ingelogd volgens het profiel (eerste_login_op / laatste_actief): in gebruik', () => {
  assert.equal(beoordeelBestaandAccount({ id: 'u1' }, [profiel({ eerste_login_op: '2026-09-01T08:00:00Z' })], 0, T).actie, 'in_gebruik');
  assert.equal(beoordeelBestaandAccount({ id: 'u1' }, [profiel({ laatste_actief: '2026-10-02T08:00:00Z' })], 0, T).actie, 'in_gebruik');
});

test('gesprekken zonder login-gegevens: in gebruik', () => {
  assert.equal(beoordeelBestaandAccount({ id: 'u1' }, [profiel()], 3, T).actie, 'in_gebruik');
});

test('openstaande uitnodiging in de eigen organisatie: opnieuw sturen, niet verwijderen', () => {
  const b = beoordeelBestaandAccount({ id: 'u1', last_sign_in_at: null }, [profiel()], 0, T);
  assert.equal(b.actie, 'opnieuw_sturen');
});

test('profiel in een andere organisatie: nooit verwijderen, ook niet als het nooit gebruikt is', () => {
  const b = beoordeelBestaandAccount({ id: 'u1', last_sign_in_at: null }, [profiel({ tenant_id: 'andere' })], 0, T);
  assert.equal(b.actie, 'andere_organisatie');
});

test('meldingen zeggen dat er niets is verwijderd', () => {
  const inGebruik = beoordeelBestaandAccount({ id: 'u1', last_sign_in_at: '2026-10-17T18:00:00Z' }, [profiel()], 0, T);
  assert.match(meldingVoorBeheerder(inGebruik, 'uitnodigen'), /in gebruik is \(laatst actief op 17 oktober 2026\)\. Er is niets verwijderd/);
  assert.match(meldingVoorBeheerder({ actie: 'andere_organisatie' }, 'opnieuw'), /andere organisatie\. Er is niets verwijderd/);
  const open = beoordeelBestaandAccount({ id: 'u1' }, [profiel()], 0, T);
  assert.match(meldingVoorBeheerder(open, 'uitnodigen'), /uitnodiging open .* Er is niets verwijderd/);
});
