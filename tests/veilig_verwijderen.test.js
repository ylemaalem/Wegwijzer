// Veilig verwijderen (D3, migratie 109, 2026-10-25).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { telLosgekoppeldMee, gebruikerFilter } = require('../supabase/functions/_shared/dashboardrol.ts');

const root = path.join(__dirname, '..');
const bron = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('losgekoppelde gesprekken tellen alleen organisatiebreed mee', () => {
  assert.equal(telLosgekoppeldMee({ rol: 'teamleider', teams: ['A'] }), false);
  for (const rol of ['manager', 'hr', 'admin']) assert.equal(telLosgekoppeldMee({ rol, teams: [] }), true);
  assert.equal(gebruikerFilter(['a', 'b'], false), 'user_id.in.(a,b)');
  assert.equal(gebruikerFilter(['a'], true), 'user_id.in.(a),user_id.is.null');
});

test('chat: metadata en trendanalyse gebruiken het filter; trendanalyse slaat [verwijderd] over', () => {
  const s = bron('supabase/functions/chat/index.ts');
  assert.match(s, /\.or\(gebruikerFilter\(monitorIds, telLosgekoppeldMee\(metaRol\)\)\)/);
  assert.match(s, /\.or\(gebruikerFilter\(monitorIdsTrend, telLosgekoppeldMee\(trendRol\)\)\)/);
  assert.match(s, /v !== "\[verwijderd\]"/);
});

test('verwijder-gebruiker: alles via verwijder_account, user_id uit de database, niet uit het verzoek', () => {
  const s = bron('supabase/functions/verwijder-gebruiker/index.ts');
  assert.match(s, /rpc\("verwijder_account", \{\s*p_beller: user\.id, p_profiel: profielId, p_modus: modus, p_leidinggevende: leidinggevende,/);
  assert.match(s, /const doelUser = typeof u\.user_id === "string" \? u\.user_id : null;/);
  assert.doesNotMatch(s, /from\("profiles"\)\.delete\(\)/, 'geen eigen delete meer');
  assert.doesNotMatch(s, /body\.user_id/, 'user_id uit het verzoek wordt niet gebruikt');
  assert.match(s, /body\.modus === "avg" \? "avg" : "uit_dienst"/);
});

test('admin: verwijderen via verwijderAccount, standaard chattoegang uit bij een leidinggevende', () => {
  const s = bron('js/admin.js');
  assert.match(s, /window\.deleteMedewerker = async function \(profileId\) \{/);
  assert.match(s, /verwijderAccount\(profileId, 'uit_dienst'\)/);
  assert.match(s, /OK = alleen de chattoegang uitzetten \(aanbevolen\)/);
  assert.match(s, /roepVerwijderAan\(profileId, modus, 'chattoegang_uit'\)/);
  assert.doesNotMatch(s, /logAudit\('MEDEWERKER_VERWIJDERD'/, 'de database schrijft de auditregel');
  assert.match(s, /'Verwijderd account'/);
  // Geen belofte "anoniem" in de teksten bij verwijderen.
  const blok = s.slice(s.indexOf('async function roepVerwijderAan'), s.indexOf('window.deleteMedewerker'));
  assert.doesNotMatch(blok, /anoniem/i);
});

test('migratie 109: SET NULL, losgekoppeld_op, alleen de server mag verwijder_account', () => {
  const m = bron('supabase/migrations/109_veilig_verwijderen.sql');
  assert.match(m, /FOREIGN KEY \(user_id\) REFERENCES public\.profiles\(id\) ON DELETE SET NULL/);
  assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.verwijder_account\(uuid, uuid, text, text\) FROM PUBLIC, anon, authenticated;/);
  assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.wis_losgekoppelde_gesprekken\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(m, /interval '12 months'/);
});

test('D4: verwijderverzoek via verwijderAccount in de stand avg, zonder eigen deletes in de browser', () => {
  const s = bron('js/admin.js');
  const blok = s.slice(s.indexOf('window.handlePrivacyVerwijdering = async function'), s.indexOf('window.handlePrivacyCorrectie = function'));
  assert.match(blok, /verwijderAccount\(profiel\.id, 'avg'\)/);
  assert.doesNotMatch(blok, /from\('conversations'\)\.delete\(\)/);
  assert.doesNotMatch(blok, /from\('profiles'\)\.delete\(\)/);
  assert.doesNotMatch(blok, /anoniem/i);
  // Bij avg geen keuze "alleen chattoegang uit".
  assert.match(s, /r\.keuze_nodig && modus === 'avg'[\s\S]{0,300}'ook_leidinggevende'/);
  assert.ok(Number((bron('admin.html').match(/js\/admin\.js\?v=(\d+)/) || [])[1]) >= 128, 'admin.js minstens v=128');
});
