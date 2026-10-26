// Documenten per team: relevantie in de chat (migratie 114, 2026-10-27).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { teamSleutel, teamBereik, teamGenoemd, uitgeslotenDocumenten, teamBereikSleutel } = require('../supabase/functions/_shared/documentteams.ts');

const GW = { id: 'gw', teams: ['Team Gele Weiland'] };
const MW = { id: 'mw', teams: ['Team Middelste Wei'] };
const MS = { id: 'ms', teams: ['Team Manuscript'] };
const CAO = { id: 'cao', teams: [] };
const OUD = { id: 'oud', teams: null };
const AND = { id: 'and', teams: ['Team VAN', 'Team FAN'] };
const DOCS = [GW, MW, MS, CAO, OUD, AND];
const SCHOON = 'Hoe gaan we om met schoonmaak en vervuiling in de woning?';

const medewerker = (teams) => teamBereik('medewerker', teams, null);
const uit = (bereik, vraag = SCHOON) => uitgeslotenDocumenten(DOCS, bereik, vraag).sort();

test('teamSleutel: zonder "Team " en zonder hoofdletters', () => {
  assert.equal(teamSleutel('Team Gele Weiland'), 'gele weiland');
  assert.equal(teamSleutel('Gele Weiland'), 'gele weiland');
  assert.equal(teamSleutel('team  VAN'), 'van');
  assert.equal(teamSleutel('Team Veluwe 1'), 'veluwe 1');
});

test('Team Almere, schoonmaakvraag: Handboek Gele Weiland doet niet mee', () => {
  assert.deepEqual(uit(medewerker(['Team Almere'])), ['and', 'gw', 'ms', 'mw']);
});

test('Team Gele Weiland, dezelfde vraag: het handboek mag wel', () => {
  const r = uit(medewerker(['Team Gele Weiland']));
  assert.ok(!r.includes('gw'));
  assert.ok(r.includes('mw'));
});

test('twee teams: documenten van beide', () => {
  const r = uit(medewerker(['Team Gele Weiland', 'Team Manuscript']));
  assert.ok(!r.includes('gw') && !r.includes('ms'));
  assert.ok(r.includes('mw'));
});

test('teamleider: teams uit de teamleiders-rij plus eigen teams', () => {
  const b = teamBereik('teamleider', ['Team Almere'], { rol: 'teamleider', teams: ['Team Veluwe 1', 'Team Middelste Wei', 'Team Gele Weiland'] });
  assert.deepEqual(b.teams.sort(), ['almere', 'gele weiland', 'middelste wei', 'veluwe 1']);
  assert.deepEqual(uit(b), ['and', 'ms']);
});

test('teamleider zonder rij: alleen eigen profielteams', () => {
  assert.deepEqual(teamBereik('teamleider', ['Team Manuscript'], null), { alles: false, teams: ['manuscript'] });
});

test('zonder team: alleen documenten zonder teams', () => {
  assert.deepEqual(uit(medewerker([])), ['and', 'gw', 'ms', 'mw']);
  assert.deepEqual(uit(medewerker(null)), ['and', 'gw', 'ms', 'mw']);
});

test('beheerder, HR en MT (manager): alles', () => {
  for (const b of [
    teamBereik('admin', [], null),
    teamBereik('superadmin', [], null),
    teamBereik('teamleider', [], { rol: 'hr', teams: null }),
    teamBereik('teamleider', [], { rol: 'manager', teams: null }),
  ]) {
    assert.equal(b.alles, true);
    assert.deepEqual(uit(b), []);
  }
});

test('Almere vraagt expliciet naar Gele Weiland: dat document doet mee, de rest niet', () => {
  const r = uit(medewerker(['Team Almere']), 'Wat staat er in het handboek van Gele Weiland over schoonmaak?');
  assert.ok(!r.includes('gw'));
  assert.ok(r.includes('mw') && r.includes('ms'));
});

test('naamsvermelding: alleen een duidelijke vermelding telt', () => {
  assert.equal(teamGenoemd('Hoe werkt het op de gele weiland?', 'Team Gele Weiland'), true);
  assert.equal(teamGenoemd('Ik zie een gele auto in het weiland', 'Team Gele Weiland'), false, 'losse woorden');
  assert.equal(teamGenoemd('Wat is de werkwijze van het team?', 'Team VAN'), false, '"van" is een gewoon woord');
  assert.equal(teamGenoemd('Hoe meld ik iemand aan bij VAN?', 'Team VAN'), true);
  assert.equal(teamGenoemd('Wie zit er in het team van mijn teamleider?', 'Team VAN'), false, '"het team van" is gewone taal');
  assert.equal(teamGenoemd('Wat doet FANMN?', 'Team FAN'), false);
  assert.equal(teamGenoemd('Wat doet FANMN?', 'Team FANMN'), true);
  assert.equal(teamGenoemd('Hoe werkt de intake bij FAN MN?', 'Team FANMN'), true, 'FAN MN = FANMN');
  assert.equal(teamGenoemd('Hoe werkt de intake bij FAN MN?', 'Team FAN'), false, 'FAN MN is niet FAN');
  assert.equal(teamGenoemd('Hoe werkt de intake bij FAN?', 'Team FAN'), true);
  assert.equal(teamGenoemd('Hoe gaat het in Veluwe?', 'Team Veluwe 1'), false, 'Veluwe 1 is een ander team dan alleen Veluwe');
});

test('document zonder teams: altijd mee, gedrag ongewijzigd', () => {
  for (const b of [medewerker([]), medewerker(['Team Almere']), teamBereik('admin', [], null)]) {
    const r = uit(b);
    assert.ok(!r.includes('cao') && !r.includes('oud'));
  }
  assert.deepEqual(uitgeslotenDocumenten([CAO, OUD], medewerker(['Team Almere']), SCHOON), []);
});

test('cache: teambereik zit in de sleutel, Almere en Gele Weiland verschillen', () => {
  const a = teamBereikSleutel(medewerker(['Team Almere']));
  const g = teamBereikSleutel(medewerker(['Team Gele Weiland']));
  assert.notEqual(a, g);
  assert.equal(teamBereikSleutel(medewerker(['Team Manuscript', 'Team Almere'])), teamBereikSleutel(medewerker(['Team Almere', 'Team Manuscript'])));
  assert.equal(teamBereikSleutel(medewerker([])), 'geen');
  assert.equal(teamBereikSleutel(teamBereik('admin', [], null)), 'alles');
  // zelfde vraag na kleine letters, ander uitsluitresultaat: andere sleutel
  assert.notEqual(teamBereikSleutel(medewerker(['Team Almere']), ['b', 'a']), teamBereikSleutel(medewerker(['Team Almere']), ['a']));
  assert.equal(teamBereikSleutel(medewerker(['Team Almere']), ['b', 'a']), teamBereikSleutel(medewerker(['Team Almere']), ['a', 'b']));
});

const BRON = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');

test('chat: filter vóór het zoeken in alle routes', () => {
  // vector, trefwoord, salaris en herschreven vraag: elke zoekaanroep krijgt de uitsluitlijst
  const blok = BRON.slice(BRON.indexOf('const salarisPromise'), BRON.indexOf('herschrijfWachtMs = Math.max'));
  const aanroepen = blok.match(/rpc\((vectorFn|trefwoordFn),/g) || [];
  assert.equal(aanroepen.length, 4);
  assert.equal((blok.match(/uitsluiten: docUitsluiten,/g) || []).length, 4);
  // synoniemen/zoektermen
  assert.match(BRON, /termDocs = \(\(td \|\| \[\]\) as DocTermen\[\]\)\.filter\(\(d\) => !docUitsluitenSet\.has\(d\.id\)\);/);
  // terugvalroute
  assert.match(BRON, /ruweOrgDocs \} = await zonderDocumenten\(/);
  // weekstart-briefing en quiz
  assert.match(BRON, /const briefTeams = await documentTeamFilter\(/);
  assert.match(BRON, /const quizTeams = await documentTeamFilter\(/);
  // vóór de cache, en het teambereik in de cachesleutel
  assert.ok(BRON.indexOf('const docTeams = await documentTeamFilter(') < BRON.indexOf('vraagHash = await hashQuestion('));
  assert.match(BRON, /hashQuestion\(profile\.tenant_id, user\.id, vraag, userFg, teamBereikSleutel\(docTeams\.bereik, docUitsluiten\)\)/);
  // leidinggevende: rij in teamleiders op e-mail (zoals het dashboard)
  assert.match(BRON, /from\("teamleiders"\)\.select\("rol, teams"\)\s*\n\s*\.eq\("tenant_id", profile\.tenant_id\)\.eq\("email", userEmail\)/);
});

test('migratie 114: kolom, uitsluiten in vier zoekfuncties, geen RLS-wijziging, alleen service_role', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '114_documenten_per_team.sql'), 'utf8');
  assert.match(m, /ALTER TABLE public\.documents ADD COLUMN IF NOT EXISTS teams text\[\] NOT NULL DEFAULT '\{\}';/);
  for (const f of ['match_document_chunks', 'match_document_chunks_ctx', 'zoek_chunks_trefwoord', 'zoek_chunks_trefwoord_ctx']) {
    assert.match(m, new RegExp(`CREATE FUNCTION public\\.${f}\\([^)]*uitsluiten uuid\\[\\] DEFAULT '\\{\\}'::uuid\\[\\]\\)`));
    assert.match(m, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f}\\([^)]*uuid\\[\\]\\) FROM PUBLIC, anon, authenticated;`));
    assert.match(m, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*uuid\\[\\]\\) TO service_role;`));
  }
  assert.equal((m.match(/NOT \(dc\.document_id = ANY \(COALESCE\(uitsluiten, '\{\}'::uuid\[\]\)\)\)/g) || []).length, 4);
  assert.doesNotMatch(m.replace(/--[^\n]*/g, ''), /POLICY|ROW LEVEL SECURITY|TO (anon|authenticated)\b/i);
});

test('beheer: teams aanvinken, uitleg zonder belofte over afscherming', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(html, /id="edit-doc-teams"/);
  assert.match(html, /Alleen bedoeld voor deze teams in de chat\. Leeg = voor iedereen\./);
  const blok = html.slice(html.indexOf('id="edit-doc-teams"') - 200, html.indexOf('id="edit-doc-teams"') + 400);
  assert.doesNotMatch(blok, /afgeschermd|geheim|vertrouwelijk|niet zichtbaar|beveilig/i);
  assert.match(js, /updatePayload\.teams = /);
  assert.match(js, /DOCUMENT_TEAMS_GEWIJZIGD/);
});
