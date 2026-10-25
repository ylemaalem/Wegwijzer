// Werkregel (CLAUDE.md, 2026-10-25): vanaf 30 oktober 2026 krijgen nieuwe tabellen in public
// geen automatische API-rechten meer (ook niet voor service_role). Elke migratie die een tabel
// maakt, bevat daarom in dezelfde migratie:
//  - GRANT op die tabel, alleen voor de rollen die het echt nodig hebben;
//  - GRANT aan anon alleen met de regel "-- anon-akkoord: <tabel>" (akkoord Younes);
//  - ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
//  - minstens één CREATE POLICY op die tabel;
//  - bij een serial/bigserial-kolom: GRANT USAGE op de sequence.
// Een bewuste uitzondering staat in de migratie zelf: "-- geen-grant: <tabel> <reden>" of
// "-- geen-policy: <tabel> <reden>" (bijv. een tabel die alleen via SECURITY DEFINER-functies
// wordt gebruikt).
// Geldt voor migraties vanaf nummer 110; oudere staan in de lijst van het onderzoek.
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VANAF = 110;
const MAP = path.join(__dirname, '..', 'supabase', 'migrations');

function controleerMigratie(sql) {
  const markeringen = (soort) => new Set([...sql.matchAll(new RegExp('--\\s*' + soort + ':\\s*(?:public\\.)?([a-z_0-9]+)', 'gi'))].map((m) => m[1].toLowerCase()));
  const geenGrant = markeringen('geen-grant');
  const geenPolicy = markeringen('geen-policy');
  const anonAkkoord = markeringen('anon-akkoord');
  const s = sql.replace(/--[^\n]*/g, '');
  const fouten = [];
  const tabellen = [...s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/gi)]
    .map((m) => ({ naam: m[1].toLowerCase(), kolommen: m[2] }));
  const grants = [...s.matchAll(/grant\s+([a-z ,]+?)\s+on\s+(table\s+|sequence\s+)?([a-z_0-9.,\s]+?)\s+to\s+([a-z_ ,]+?)\s*;/gi)].map((m) => ({
    soort: (m[2] || 'table').trim().toLowerCase(),
    objecten: m[3].split(',').map((x) => x.trim().split('.').pop().toLowerCase()),
    rollen: m[4].split(',').map((x) => x.trim().toLowerCase()),
  }));
  for (const t of tabellen) {
    const tg = grants.filter((g) => g.soort === 'table' && g.objecten.includes(t.naam));
    if (tg.length === 0 && !geenGrant.has(t.naam)) fouten.push(`${t.naam}: geen GRANT in dezelfde migratie`);
    if (tg.some((g) => g.rollen.includes('anon') || g.rollen.includes('public')) && !anonAkkoord.has(t.naam)) {
      fouten.push(`${t.naam}: GRANT aan anon/public zonder "-- anon-akkoord: ${t.naam}"`);
    }
    if (!new RegExp('alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?' + t.naam + '\\s+enable\\s+row\\s+level\\s+security', 'i').test(s)) {
      fouten.push(`${t.naam}: RLS niet aangezet`);
    }
    if (!new RegExp('create\\s+policy\\s+[^;]*?\\s+on\\s+(?:public\\.)?' + t.naam + '\\b', 'i').test(s) && !geenPolicy.has(t.naam)) {
      fouten.push(`${t.naam}: geen policy`);
    }
    if (/\b(big)?serial\b/i.test(t.kolommen)) {
      const seqGrant = grants.some((g) => g.soort === 'sequence' && g.objecten.some((o) => o.startsWith(t.naam + '_')));
      if (!seqGrant) fouten.push(`${t.naam}: serial-kolom zonder GRANT USAGE op de sequence`);
    }
  }
  return fouten;
}

test('zelftest: migratie zonder GRANT faalt', () => {
  const sql = `CREATE TABLE public.proef (id uuid PRIMARY KEY);
ALTER TABLE public.proef ENABLE ROW LEVEL SECURITY;
CREATE POLICY lees ON public.proef FOR SELECT TO authenticated USING (true);`;
  assert.deepEqual(controleerMigratie(sql), ['proef: geen GRANT in dezelfde migratie']);
});

test('zelftest: anon zonder akkoord, RLS, policy en sequence', () => {
  const sql = `CREATE TABLE proef2 (id bigserial PRIMARY KEY);
GRANT SELECT ON TABLE proef2 TO anon, authenticated;`;
  assert.deepEqual(controleerMigratie(sql), [
    'proef2: GRANT aan anon/public zonder "-- anon-akkoord: proef2"',
    'proef2: RLS niet aangezet',
    'proef2: geen policy',
    'proef2: serial-kolom zonder GRANT USAGE op de sequence',
  ]);
});

test('zelftest: volledige migratie en bewuste uitzonderingen slagen', () => {
  const sql = `-- anon-akkoord: open_lijst
CREATE TABLE IF NOT EXISTS public.open_lijst (id bigserial PRIMARY KEY, naam text);
ALTER TABLE public.open_lijst ENABLE ROW LEVEL SECURITY;
CREATE POLICY "iedereen leest" ON public.open_lijst FOR SELECT TO anon USING (true);
GRANT SELECT ON TABLE public.open_lijst TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.open_lijst_id_seq TO service_role;
-- geen-grant: intern alleen via SECURITY DEFINER
-- geen-policy: intern
CREATE TABLE public.intern (id uuid);
ALTER TABLE public.intern ENABLE ROW LEVEL SECURITY;`;
  assert.deepEqual(controleerMigratie(sql), []);
});

test(`alle migraties vanaf ${VANAF} volgen de regel`, () => {
  const bestanden = fs.readdirSync(MAP).filter((f) => /^\d+_.*\.sql$/.test(f) && parseInt(f, 10) >= VANAF);
  assert.ok(bestanden.length > 0);
  const fouten = bestanden.flatMap((f) => controleerMigratie(fs.readFileSync(path.join(MAP, f), 'utf8')).map((e) => `${f}: ${e}`));
  assert.deepEqual(fouten, []);
});
