// Dashboardtoegang (lek 2026-10-23, migratie 096): alleen role 'teamleider' MET een
// rij in de leidinggevenden-lijst (rpc mijn_leidinggevende_rol) geeft het dashboard.
// Een functie (functiegroep) geeft nooit rechten. Plus de waarschuwing in Beheer.
// De databaseregels zelf: tests/sql/rechtenmatrix_leidinggevende.sql.
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadPagina, laadAdmin } = require('./helpers/admin_harness.js');

const GEBRUIKER = { id: 'u-x', email: 'x@test.nl' };

function pagina(bestand, paginaRol, profiel, leidingRol) {
  return laadPagina({
    bestanden: [bestand],
    paginaRol,
    detail: { profile: profiel, user: GEBRUIKER },
    tabellen: { profiles: [profiel], 'rpc:mijn_leidinggevende_rol': leidingRol === undefined ? null : leidingRol },
  });
}

const href = (p) => p.ctx.location.href;
const rpcAanroepen = (p) => p.supabase.log.filter((q) => q.tabel === 'rpc:mijn_leidinggevende_rol').length;

// ---- route-guard.js ----

test('route-guard: teamleider ZONDER rij op het dashboard → naar medewerker.html', async () => {
  const p = pagina('js/route-guard.js', 'teamleider', { id: 'p1', tenant_id: 't1', role: 'teamleider', functiegroep: 'ambulant_persoonlijk_begeleider' }, null);
  try {
    await p.wacht();
    assert.equal(href(p), '/medewerker.html');
  } finally { p.stop(); }
});

test('route-guard: teamleider MET rij mag op het dashboard', async () => {
  const p = pagina('js/route-guard.js', 'teamleider', { id: 'p1', tenant_id: 't1', role: 'teamleider' }, 'hr');
  try {
    await p.wacht();
    assert.equal(href(p), 'https://test/admin.html', 'geen doorverwijzing');
    assert.equal(rpcAanroepen(p), 1);
  } finally { p.stop(); }
});

test('route-guard: functie met "teamleider" of "leidinggevende" geeft geen dashboard', async () => {
  for (const fg of ['teamleider', 'leidinggevende_wonen']) {
    const p = pagina('js/route-guard.js', 'teamleider', { id: 'p1', tenant_id: 't1', role: 'medewerker', functiegroep: fg, dashboard_toegang: true }, 'teamleider');
    try {
      await p.wacht();
      assert.equal(href(p), '/medewerker.html', fg);
      assert.equal(rpcAanroepen(p), 0, 'medewerker: geen controle nodig');
    } finally { p.stop(); }
  }
});

test('route-guard: teamleider zonder rij mag wel de medewerkerpagina gebruiken', async () => {
  const p = pagina('js/route-guard.js', 'medewerker', { id: 'p1', tenant_id: 't1', role: 'teamleider' }, null);
  try {
    await p.wacht();
    assert.equal(href(p), 'https://test/admin.html', 'geen doorverwijzing');
  } finally { p.stop(); }
});

// ---- auth.js (al ingelogd: doorsturen) ----

test('login: teamleider zonder rij → medewerker.html; met rij → teamleider.html', async () => {
  const zonder = pagina('js/auth.js', undefined, { role: 'teamleider' }, null);
  const met = pagina('js/auth.js', undefined, { role: 'teamleider' }, 'teamleider');
  try {
    await zonder.wacht(); await met.wacht();
    assert.equal(href(zonder), '/medewerker.html');
    assert.equal(href(met), '/teamleider.html');
  } finally { zonder.stop(); met.stop(); }
});

test('login: medewerker met functie "teamleider" → medewerker.html', async () => {
  const p = pagina('js/auth.js', undefined, { role: 'medewerker', functiegroep: 'teamleider', dashboard_toegang: true }, 'teamleider');
  try {
    await p.wacht();
    assert.equal(href(p), '/medewerker.html');
  } finally { p.stop(); }
});

// ---- Beheer: waarschuwing en verwijderen ----

test('Beheer: waarschuwing voor rol teamleider zonder rij (hoofdletters in e-mail tellen niet)', async () => {
  const a = laadAdmin({
    tabellen: {
      teamleiders: [{ id: 'tl1', naam: 'Echte Leiding', email: 'Leiding@Test.nl ', rol: 'teamleider' }],
      profiles: [
        { id: 'p1', naam: 'Echte Leiding', email: 'leiding@test.nl' },
        { id: 'p2', naam: 'Testt', email: 'younes@test.nl' },
      ],
    },
  });
  try {
    await a.start();
    const el = a.elementen['tl-zonder-rij-waarschuwing'];
    assert.equal(el.style.display, '');
    assert.match(el.innerHTML, /Testt \(younes@test\.nl\)/);
    assert.doesNotMatch(el.innerHTML, /Echte Leiding/);
  } finally { a.stop(); }
});

test('Beheer: geen waarschuwing als iedereen met de rol een rij heeft', async () => {
  const a = laadAdmin({
    tabellen: {
      teamleiders: [{ id: 'tl1', naam: 'Echte Leiding', email: 'leiding@test.nl', rol: 'teamleider' }],
      profiles: [{ id: 'p1', naam: 'Echte Leiding', email: 'leiding@test.nl' }],
    },
  });
  try {
    await a.start();
    assert.equal(a.elementen['tl-zonder-rij-waarschuwing'].style.display, 'none');
  } finally { a.stop(); }
});

test('Beheer: verwijderen mislukt → melding', async () => {
  const a = laadAdmin({ confirm: true, dbFouten: { 'teamleiders:delete': { message: 'geen rechten' } } });
  try {
    await a.start();
    await a.ctx.deleteTeamleider('tl1');
    assert.match(a.meldingen.alert[0], /^Verwijderen mislukt: geen rechten/);
    assert.match(a.meldingen.confirm[0], /gewoon medewerkersaccount/);
  } finally { a.stop(); }
});
