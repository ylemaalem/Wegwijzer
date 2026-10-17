// Test voor de trendanalyse in het dashboard (js/teamleider.js) en de rolbepaling
// op de server (supabase/functions/_shared/dashboardrol.ts).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadDashboard } = require('./helpers/admin_harness.js');
const { normaliseerDashboardRol, kiesMonitorIds, bereikTekst } = require('../supabase/functions/_shared/dashboardrol.ts');

const MEDEWERKERS = [
  { id: 'm1', teams: ['Team Almere'] },
  { id: 'm2', teams: ['Team VAN'] },
  { id: 'm3', teams: null },
];

test('teamleider ziet alleen medewerkers met een gedeeld team', () => {
  const rol = normaliseerDashboardRol('teamleider', { rol: 'teamleider', teams: ['Team Almere'] });
  assert.deepEqual(kiesMonitorIds(rol, MEDEWERKERS, 'p-tl'), ['m1']);
  assert.equal(bereikTekst(rol), 'binnen jouw team');
});

test('HR en manager (profielrol teamleider) zien de hele organisatie', () => {
  for (const r of ['hr', 'manager']) {
    const rol = normaliseerDashboardRol('teamleider', { rol: r, teams: [] });
    assert.equal(rol.rol, r);
    assert.deepEqual(kiesMonitorIds(rol, MEDEWERKERS, 'p-tl'), ['m1', 'm2', 'm3']);
    assert.equal(bereikTekst(rol), 'binnen de hele organisatie');
  }
});

test('teamleider zonder teams of zonder rij ziet niemand; eigen profiel telt nooit mee', () => {
  assert.deepEqual(kiesMonitorIds(normaliseerDashboardRol('teamleider', null), MEDEWERKERS, 'p-tl'), []);
  assert.deepEqual(kiesMonitorIds(normaliseerDashboardRol('admin', null), MEDEWERKERS, 'm2'), ['m1', 'm3']);
});

function trendFetch(antwoord) {
  return async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    const data = body.generate_trendanalyse ? antwoord : {};
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  };
}

test('"geen vragen" van de server verschijnt als melding, niet als opslagfout', async () => {
  const melding = 'Er zijn de afgelopen 30 dagen geen vragen gesteld binnen de hele organisatie. Zodra medewerkers vragen stellen verschijnt hier een trendanalyse.';
  const a = laadDashboard({
    tabellen: { teamleiders: [{ rol: 'hr', teams: [] }] },
    fetch: trendFetch({ trendanalyse: melding, geen_vragen: true, rapport: null }),
  });
  try {
    await a.start();
    await a.klik('tl-trendanalyse-btn');
    const status = a.elementen['tl-trendanalyse-status'];
    assert.equal(status.textContent, melding);
    assert.equal(status.style.color, 'var(--text-muted)');
    assert.doesNotMatch(status.textContent, /kon niet worden opgeslagen/);
  } finally { a.stop(); }
});

test('een echte opslagfout blijft een foutmelding', async () => {
  const a = laadDashboard({ fetch: trendFetch({ trendanalyse: 'tekst', rapport: null }) });
  try {
    await a.start();
    await a.klik('tl-trendanalyse-btn');
    assert.match(a.elementen['tl-trendanalyse-status'].textContent, /kon niet worden opgeslagen/);
  } finally { a.stop(); }
});
