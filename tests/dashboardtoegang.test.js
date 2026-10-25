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

// Verwijdervenster met knoppen (2026-10-25): (a) chattoegang uit, (b) account én
// leidinggevende weg, of alleen de rij. Accounts met alleen het dashboard staan niet
// meer bij Medewerkers, dus hier moet ook het account weg kunnen.
const MET_MODULE = ['js/medewerker-opslaan.js', 'js/leidinggevende-status.js', 'js/admin.js'];
const TL_TABELLEN = (extra) => ({
  teamleiders: [{ id: 'tl1', naam: 'Tl Een', email: 'tl@x.nl', rol: 'teamleider', teams: ['A'] }],
  profiles: [{ id: 'p1', email: 'tl@x.nl', role: 'teamleider', laatste_actief: '2026-10-01', ...extra }],
});
const knoppen = (a) => a.elementen['verwijder-keuze-opties'].kinderen;
const knopTitels = (a) => knoppen(a).map((k) => k.kinderen[0].textContent);

test('Beheer: verwijderen mislukt → melding', async () => {
  const a = laadAdmin({ bestanden: MET_MODULE, tabellen: TL_TABELLEN(), dbFouten: { 'teamleiders:delete': { message: 'geen rechten' } } });
  try {
    await a.start();
    const bezig = a.ctx.deleteTeamleider('tl1');
    await a.wacht();
    assert.ok(a.elementen['modal-verwijder-keuze'].classList.contains('show'), 'venster open');
    const rij = knoppen(a)[knoppen(a).length - 1];
    assert.match(rij.kinderen[1].textContent, /gewoon medewerkersaccount/);
    rij.onclick();
    await bezig;
    assert.match(a.meldingen.alert[0], /^Verwijderen mislukt: geen rechten/);
  } finally { a.stop(); }
});

test('Beheer: Leidinggevende/HR met alleen dashboard: (b) en "alleen uit de lijst", geen (a)', async () => {
  const verzoeken = [];
  const fetch = async (url, init) => { verzoeken.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ deleted: true }) }; };
  const a = laadAdmin({ bestanden: MET_MODULE, tabellen: TL_TABELLEN({ alleen_dashboard: true }), fetch });
  try {
    await a.start();
    const bezig = a.ctx.deleteTeamleider('tl1');
    await a.wacht();
    assert.deepEqual(knopTitels(a), ['(b) Account én leidinggevende verwijderen', 'Alleen uit de lijst Leidinggevende/HR halen']);
    knoppen(a)[0].onclick();
    await bezig;
    const v = verzoeken.find((x) => /verwijder-gebruiker/.test(x.url));
    assert.deepEqual(v.body, { profile_id: 'p1', modus: 'uit_dienst', leidinggevende: 'ook_leidinggevende' });
    assert.equal(a.supabase.log.filter((q) => q.tabel === 'teamleiders' && q.acties.includes('delete')).length, 0, 'rij weg via de database-functie, niet vanuit de browser');
  } finally { a.stop(); }
});

test('Beheer: Leidinggevende/HR met chat: (a) zet de chattoegang uit; Annuleren doet niets', async () => {
  const verzoeken = [];
  const fetch = async (url, init) => { verzoeken.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ deleted: false, chattoegang_uit: true }) }; };
  const a = laadAdmin({ bestanden: MET_MODULE, tabellen: TL_TABELLEN(), fetch });
  try {
    await a.start();
    let bezig = a.ctx.deleteTeamleider('tl1');
    await a.wacht();
    assert.equal(knopTitels(a)[0], '(a) Alleen de chattoegang uitzetten (aanbevolen)');
    a.elementen['verwijder-keuze-annuleren'].onclick();
    await bezig;
    assert.equal(verzoeken.length, 0, 'Annuleren: geen verzoek');
    bezig = a.ctx.deleteTeamleider('tl1');
    await a.wacht();
    knoppen(a)[knoppen(a).length - 3].onclick();
    await bezig;
    assert.equal(verzoeken[0].leidinggevende, 'chattoegang_uit');
    assert.match(a.meldingen.alert[0], /alleen dashboard/);
  } finally { a.stop(); }
});

test('Beheer: Medewerkers, leidinggevende: venster met (a) en (b), keuze gaat naar de server', async () => {
  const verzoeken = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); verzoeken.push(body);
    const json = body.leidinggevende ? { deleted: true } : { keuze_nodig: true, leidinggevende_rol: 'hr', naam: 'Tl Een' };
    return { ok: true, status: 200, json: async () => json };
  };
  const a = laadAdmin({ bestanden: MET_MODULE, tabellen: TL_TABELLEN(), fetch });
  try {
    await a.start();
    const bezig = a.ctx.verwijderAccount('p1', 'uit_dienst');
    await a.wacht();
    assert.deepEqual(knopTitels(a), ['(a) Alleen de chattoegang uitzetten (aanbevolen)', '(b) Account én leidinggevende verwijderen']);
    assert.match(a.elementen['verwijder-keuze-tekst'].textContent, /HR-medewerker/);
    knoppen(a)[1].onclick();
    assert.equal(await bezig, true);
    assert.equal(verzoeken[1].leidinggevende, 'ook_leidinggevende');
  } finally { a.stop(); }
});
