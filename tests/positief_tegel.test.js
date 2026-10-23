// Tegel "Positief" in het dashboard: percentage plus aantal beoordelingen ("61% van 54").
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadDashboard } = require('./helpers/admin_harness.js');

function metMetadata(metadata) {
  return laadDashboard({
    tabellen: { teamleiders: [{ rol: 'hr', teams: [] }] },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      const data = body.get_team_gesprek_metadata ? { metadata } : {};
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    },
  });
}

test('percentage en aantal beoordelingen; gesprekken zonder beoordeling tellen niet mee', async () => {
  const fb = ['goed', 'goed', 'niet_goed', null, null];
  const a = metMetadata(fb.map((f, i) => ({ anon_key: 'k' + i, feedback: f, created_at: '2026-10-20T10:00:00Z' })));
  try {
    await a.start();
    const el = a.elementen['tl-stat-positief'];
    assert.match(el.innerHTML, /^67%<span[^>]*> van 3<\/span>$/);
    assert.equal(el.title, '67% positief van 3 beoordelingen');
  } finally { a.stop(); }
});

test('nog geen beoordelingen: streepje', async () => {
  const a = metMetadata([{ anon_key: 'k', feedback: null, created_at: '2026-10-20T10:00:00Z' }]);
  try {
    await a.start();
    assert.equal(a.elementen['tl-stat-positief'].innerHTML, '—');
  } finally { a.stop(); }
});
