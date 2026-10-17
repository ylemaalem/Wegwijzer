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

// ---- Periodekeuze (3b) ----
const { leesPeriode, periodeSinds, periodeTekst, spreidVragen } = require('../supabase/functions/_shared/trendperiode.ts');

test('periode: onbekende waarde wordt 30 dagen; begin per periode; alles = geen begin', () => {
  assert.equal(leesPeriode('xyz'), '30d');
  assert.equal(leesPeriode(undefined), '30d');
  const nu = new Date('2026-10-17T12:00:00Z');
  assert.equal(periodeSinds('30d', nu).toISOString().slice(0, 10), '2026-09-17');
  assert.equal(periodeSinds('3m', nu).toISOString().slice(0, 10), '2026-07-17');
  assert.equal(periodeSinds('6m', nu).toISOString().slice(0, 10), '2026-04-17');
  assert.equal(periodeSinds('alles', nu), null);
  assert.equal(periodeTekst('3m'), 'de afgelopen 3 maanden');
});

test('spreidVragen neemt bij te veel vragen een gelijkmatige greep over de hele periode', () => {
  const lijst = Array.from({ length: 1000 }, (_, i) => i);
  const gekozen = spreidVragen(lijst, 200);
  assert.equal(gekozen.length, 200);
  assert.equal(gekozen[0], 0);
  assert.ok(gekozen[199] >= 990);
  assert.deepEqual(spreidVragen([1, 2, 3], 200), [1, 2, 3]);
});

test('dashboard stuurt de gekozen periode mee', async () => {
  const verzoeken = [];
  const a = laadDashboard({
    fetch: async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      verzoeken.push(body);
      const data = body.generate_trendanalyse ? { trendanalyse: 'geen', geen_vragen: true, rapport: null } : {};
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    },
  });
  try {
    await a.start();
    a.ctx.document.getElementById('tl-trendanalyse-periode').value = '6m';
    await a.klik('tl-trendanalyse-btn');
    const trend = verzoeken.find((b) => b.generate_trendanalyse);
    assert.equal(trend.periode, '6m');
  } finally { a.stop(); }
});

test('geschiedenis toont de periode van elk rapport', async () => {
  const a = laadDashboard({
    tabellen: { trendanalyse_rapporten: [
      { id: 'r1', tekst: 'Rapport A', aangemaakt_op: '2026-10-17T10:00:00Z', periode: '3m' },
      { id: 'r2', tekst: 'Rapport B', aangemaakt_op: '2026-10-17T10:00:00Z', periode: 'alles' },
    ] },
  });
  try {
    await a.start();
    const html = a.elementen['tl-trendanalyse-lijst'].innerHTML;
    assert.match(html, /Periode: 17 juli 2026 t\/m 17 oktober 2026/);
    assert.match(html, /Periode: het begin t\/m 17 oktober 2026/);
  } finally { a.stop(); }
});
