// Synoniemen en zoektermen in de gewone zoekroute (2026-10-26).
// Draaien: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { woorden, documentenViaTermen, naamVoorZoeken, MAX_DOCUMENTEN_PER_TERM } = require('../supabase/functions/_shared/synoniemzoek.ts');

const OS = { id: 'os', naam: 'Handleiding traject ondersteuning & stabiliteit 1.0.docx', synoniemen: ['O&S'], zoektermen: ['traject ondersteuning stabiliteit', 'ahmn'] };
const OO1 = { id: 'oo1', naam: 'Handleiding traject ontwikkeling & ondersteuning 1.0.docx', synoniemen: ['O&O'], zoektermen: ['ahmn', 'wlz'] };
const OO2 = { id: 'oo2', naam: 'Samenwerking en procesregie in het traject Ontwikkeling en Ondersteuning definitief.pdf', synoniemen: ['O&O'], zoektermen: ['ahmn'] };
const ANDER = { id: 'x', naam: 'Verlofregeling.pdf', synoniemen: [], zoektermen: ['ahmn', 'verlof aanvragen', 'wlz'] };
const DOCS = [OS, OO1, OO2, ANDER];

test('woorden: & hoort bij het woord, andere leestekens scheiden', () => {
  assert.deepEqual(woorden('Wat zijn de verschillen tussen O&S en O&O trajecten?'), ['wat', 'zijn', 'de', 'verschillen', 'tussen', 'o&s', 'en', 'o&o', 'trajecten']);
  assert.deepEqual(woorden('thuis-in-de-wijk'), ['thuis', 'in', 'de', 'wijk']);
});

test('O&S en O&O: synoniemen vinden de documenten, O&S-handleiding erbij', () => {
  const r = documentenViaTermen('Wat zijn de verschillen tussen O&S en O&O trajecten?', DOCS);
  assert.deepEqual(r.map((d) => d.id).sort(), ['oo1', 'oo2', 'os']);
  assert.ok(r.every((d) => d.synoniem));
  assert.deepEqual(r.find((d) => d.id === 'os').termen, ['o&s']);
});

test('alleen hele woorden: "os" of "o&s" binnen een ander woord telt niet', () => {
  assert.deepEqual(documentenViaTermen('Wat kost een kosmos?', DOCS), []);
  assert.deepEqual(documentenViaTermen('Wat is co&so?', DOCS), []);
});

test('term bij te veel documenten telt niet (op data gebaseerd, geen woordenlijst)', () => {
  assert.equal(MAX_DOCUMENTEN_PER_TERM, 2);
  assert.deepEqual(documentenViaTermen('Wat doet AHMN?', DOCS), [], 'ahmn hoort bij 4 documenten');
  assert.deepEqual(documentenViaTermen('Wat is een Wlz-indicatie?', DOCS).map((d) => d.id).sort(), ['oo1', 'x'], 'wlz hoort bij 2 documenten');
});

test('zoekterm van meerdere woorden telt als hele reeks', () => {
  assert.deepEqual(documentenViaTermen('Hoe gaat verlof aanvragen?', DOCS).map((d) => d.id), ['x']);
  assert.deepEqual(documentenViaTermen('Ik wil verlof', DOCS), []);
});

test('volgorde en maximum: synoniem eerst, hoogstens maxDocs; 0 = uit', () => {
  const r = documentenViaTermen('O&O en Wlz', DOCS, 2);
  assert.equal(r.length, 2);
  assert.ok(r[0].synoniem && r[1].synoniem);
  assert.deepEqual(documentenViaTermen('O&S', DOCS, 0), []);
  assert.deepEqual(documentenViaTermen('', DOCS), []);
  assert.deepEqual(documentenViaTermen('O&S', [{ id: 'a', naam: 'A', synoniemen: null, zoektermen: null }]), []);
});

test('naam voor zoeken: zonder extensie en versienummer', () => {
  assert.equal(naamVoorZoeken('Handleiding traject ondersteuning & stabiliteit 1.0.docx'), 'Handleiding traject ondersteuning & stabiliteit');
  assert.equal(naamVoorZoeken('AHMN_Organisatiestructuur_v5.docx'), 'AHMN Organisatiestructuur');
});

test('chat/index.ts: synoniemen in de gewone route, documentnaam in trefwoordzoeken, stukken tellen mee', () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'chat', 'index.ts'), 'utf8');
  assert.match(bron, /const SYNONIEM_DOCUMENTEN = 3;/);
  assert.match(bron, /documentenViaTermen\(vraag, termDocs, SYNONIEM_DOCUMENTEN\)/);
  assert.match(bron, /zoekvraag: trefwoordVraag,/);
  assert.match(bron, /const namenViaTermen = viaTermen\.filter\(\(d\) => d\.synoniem\)\.map/, 'naam alleen bij een synoniem');
  assert.match(bron, /doc_ids: viaTermen\.map\(\(d\) => d\.id\)/, 'stukken bij synoniem én zoekterm');
  assert.match(bron, /rpc\("match_chunks_in_documenten"/);
  assert.match(bron, /const chunkMatches = synoniemNieuw\.length > 0/);
  assert.match(bron, /\.eq\("tenant_id", profile\.tenant_id\)\.is\("user_id", null\)\.eq\("uitgesloten_van_zoeken", false\);/);
});

test('migratie 113: alleen service_role, SECURITY INVOKER, lege search_path, uitgesloten documenten niet', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '113_match_chunks_in_documenten.sql'), 'utf8');
  assert.match(m, /SECURITY INVOKER/);
  assert.match(m, /SET search_path = ''/);
  assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.match_chunks_in_documenten\(public\.vector, uuid, uuid\[\], integer\) FROM PUBLIC, anon, authenticated;/);
  assert.match(m, /GRANT EXECUTE ON FUNCTION public\.match_chunks_in_documenten\(public\.vector, uuid, uuid\[\], integer\) TO service_role;/);
  assert.match(m, /dc\.org_id = match_org_id/);
  assert.match(m, /uitgesloten_van_zoeken/);
  assert.doesNotMatch(m, /\banon\b[^;]*TO|TO\s+(anon|authenticated)/);
});
