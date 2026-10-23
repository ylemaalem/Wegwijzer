// Startdatum live (settings.startdatum_live): het dashboard telt pas vanaf die dag.
// Zie supabase/functions/_shared/trendperiode.ts. Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

test('startdatum = middernacht Nederlandse tijd (winter- en zomertijd)', async () => {
  const { leesStartdatumLive } = await import('../supabase/functions/_shared/trendperiode.ts');
  assert.equal(leesStartdatumLive('2026-11-01').toISOString(), '2026-10-31T23:00:00.000Z');
  assert.equal(leesStartdatumLive('2026-07-01').toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(leesStartdatumLive(' 2026-11-01 ').toISOString(), '2026-10-31T23:00:00.000Z');
});

test('leeg of ongeldig = alles tonen', async () => {
  const { leesStartdatumLive } = await import('../supabase/functions/_shared/trendperiode.ts');
  for (const w of [null, undefined, '', '   ', '01-11-2026', '2026-13-01', '2026-02-30', 'morgen', 20261101]) {
    assert.equal(leesStartdatumLive(w), null, String(w));
  }
});

test('de latere begindatum gaat voor', async () => {
  const { laatsteBegin } = await import('../supabase/functions/_shared/trendperiode.ts');
  const a = new Date('2026-09-01T00:00:00Z');
  const b = new Date('2026-10-01T00:00:00Z');
  assert.equal(laatsteBegin(a, b), b);
  assert.equal(laatsteBegin(b, a), b);
  assert.equal(laatsteBegin(null, a), a);
  assert.equal(laatsteBegin(a, null), a);
  assert.equal(laatsteBegin(null, null), null);
});

test('datumtekst voor "sinds <datum>"', async () => {
  const { datumTekst, leesStartdatumLive } = await import('../supabase/functions/_shared/trendperiode.ts');
  assert.equal(datumTekst(leesStartdatumLive('2026-11-01')), '1 november 2026');
});
