// Accounts met alleen het dashboard (D2, migratie 108, 2026-10-25).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { alleenDashboardGeweigerd, uitnodigingAlleenDashboard, ALLEEN_DASHBOARD_MELDING } = require('../supabase/functions/_shared/chattoegang.ts');
const { bestemming } = require('../js/route-guard.js');

const root = path.join(__dirname, '..');
const bron = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('chat weigert alleen bij alleen_dashboard === true, nooit in testmodus of voor een beheerder', () => {
  assert.equal(alleenDashboardGeweigerd({ alleen_dashboard: true, role: 'teamleider' }, false), true);
  assert.equal(alleenDashboardGeweigerd({ alleen_dashboard: true, role: 'teamleider' }, true), false);
  assert.equal(alleenDashboardGeweigerd({ alleen_dashboard: false, role: 'teamleider' }, false), false);
  assert.equal(alleenDashboardGeweigerd({ alleen_dashboard: 'true', role: 'teamleider' }, false), false);
  assert.equal(alleenDashboardGeweigerd({ role: 'medewerker' }, false), false);
  assert.equal(alleenDashboardGeweigerd({ alleen_dashboard: true, role: 'admin' }, false), false);
  assert.equal(alleenDashboardGeweigerd(null, false), false);
  assert.match(ALLEEN_DASHBOARD_MELDING, /alleen toegang tot het dashboard/);
});

test('uitnodiging: alleen_dashboard alleen met true en rol teamleider', () => {
  assert.equal(uitnodigingAlleenDashboard(true, 'teamleider'), true);
  assert.equal(uitnodigingAlleenDashboard(true, 'medewerker'), false);
  assert.equal(uitnodigingAlleenDashboard(true, 'admin'), false);
  assert.equal(uitnodigingAlleenDashboard('ja', 'teamleider'), false);
  assert.equal(uitnodigingAlleenDashboard(undefined, 'teamleider'), false);
});

test('chat/index.ts: de blokkade staat ná alle dashboardroutes en vóór vragen, briefing, quiz en PDF', () => {
  const s = bron('supabase/functions/chat/index.ts');
  const blok = s.indexOf('if (alleenDashboardGeweigerd(profile, isTest))');
  assert.ok(blok > 0, 'blokkade gevonden');
  for (const dash of ['body.get_team_medewerkers', 'body.get_team_gesprek_metadata', 'body.ontsluit_naam', 'body.generate_trendanalyse']) {
    const i = s.indexOf(dash);
    assert.ok(i > 0 && i < blok, dash + ' staat vóór de blokkade');
  }
  for (const na of ['body.generate_briefing && body.week_nummer', 'body.generate_quiz && body.week_nummer', 'body.generate_tips', 'body.generate_rolwissel', 'body.extract_pdf', '5b. Patroonherkenning', '5. Rate limiting per rol']) {
    const i = s.indexOf(na);
    assert.ok(i > blok, na + ' staat ná de blokkade');
  }
  assert.equal((s.match(/alleen_dashboard: uitnodigingAlleenDashboard\(body\.invite_alleen_dashboard, (inviteRole|resendRole)\)/g) || []).length, 2);
  assert.match(s, /"CHATTOEGANG_GEWIJZIGD"/);
});

test('route-guard: alleen_dashboard gaat van de kennisassistent naar het dashboard', () => {
  const tl = { role: 'teamleider', alleen_dashboard: true };
  assert.equal(bestemming('medewerker', tl, true), 'teamleider.html');
  assert.equal(bestemming('teamleider', tl, true), null);
  // Zonder rij in teamleiders (komt niet voor: de database zet dan alleen_dashboard uit): uitloggen.
  assert.equal(bestemming('medewerker', tl, false), 'index.html');
  // Zonder alleen_dashboard ongewijzigd.
  assert.equal(bestemming('medewerker', { role: 'teamleider' }, true), null);
  assert.equal(bestemming('medewerker', { role: 'medewerker' }, false), null);
  assert.equal(bestemming('admin', { role: 'medewerker' }, false), 'medewerker.html');
  assert.equal(bestemming('teamleider', { role: 'medewerker' }, false), 'medewerker.html');
  assert.equal(bestemming('medewerker', { role: 'admin' }, false), 'admin.html'); // zoals voorheen
  assert.equal(bestemming('teamleider', { role: 'admin' }, false), 'admin.html');
});

test('teamleider.js verbergt de knop Kennisassistent; admin heeft het vinkje', () => {
  assert.match(bron('js/teamleider.js'), /alleen_dashboard[\s\S]{0,200}chat-link-btn/);
  const html = bron('admin.html');
  assert.match(html, /id="tl-alleen-dashboard"/);
  const js = bron('js/admin.js');
  assert.match(js, /invite_alleen_dashboard: alleenDashboard/);
  assert.match(js, /zet_alleen_dashboard: true/);
});
