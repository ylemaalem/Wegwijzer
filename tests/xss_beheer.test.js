// Test voor audit B-01: tekst uit de database mag nooit als code of als HTML
// in het beheerscherm of het dashboard terechtkomen.
// Draaien: node --test tests/*.test.js
// De echte render-functies uit js/admin.js en js/teamleider.js draaien met
// onschadelijke testteksten. De opgebouwde HTML wordt ontleed zoals een browser
// dat doet (tags, attributen, entiteiten) en daarna gecontroleerd.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { laadAdmin, laadDashboard } = require('./helpers/admin_harness.js');
const veilig = require('../js/veilig.js');

const T1 = "x');window.__xss=1;//";
const T2 = '"><img src=x onerror=window.__xss=1>';
const T3 = '<b>vet</b>';
const TEKSTEN = [T1, T2, T3];

function decodeer(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// Ontleedt HTML in tags met attributen (waarden gedecodeerd) en losse tekst.
function ontleed(html) {
  const tags = [];
  let tekst = '';
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let laatste = 0;
  let m;
  while ((m = re.exec(html))) {
    tekst += html.slice(laatste, m.index);
    laatste = re.lastIndex;
    if (m[1]) continue;
    const attrs = {};
    const are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = are.exec(m[3]))) {
      const waarde = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
      attrs[a[1].toLowerCase()] = decodeer(waarde);
    }
    tags.push({ naam: m[2].toLowerCase(), attrs });
  }
  tekst += html.slice(laatste);
  return { tags, tekst: decodeer(tekst) };
}

// Geen enkele tag mag door een testtekst zijn ontstaan of er code van bevatten.
function controleerGeenCode(html, waar) {
  const { tags } = ontleed(html);
  for (const t of tags) {
    assert.ok(!(t.naam === 'img' && t.attrs.src === 'x'), waar + ': <img src=x> uit testtekst is een echte tag geworden');
    for (const [naam, waarde] of Object.entries(t.attrs)) {
      if (naam.startsWith('on')) {
        assert.ok(!/__xss/.test(waarde), waar + ': testtekst staat in ' + naam + '="..."');
        assert.ok(!TEKSTEN.some((x) => waarde.includes(x)), waar + ': testtekst staat in ' + naam + '="..."');
      }
    }
  }
  assert.ok(!/<b>vet<\/b>/.test(html), waar + ': <b>vet</b> is als HTML ingevoegd');
}

function alleHtml(a) {
  return Object.keys(a.elementen)
    .map((id) => ({ id, html: a.elementen[id].innerHTML }))
    .filter((x) => typeof x.html === 'string' && x.html.length > 0);
}

// Klikt op een knop met data-actie zoals de browser dat doet (via het document).
function klikActie(a, tag) {
  const el = { getAttribute: (n) => (n in tag.attrs ? tag.attrs[n] : null) };
  a.ctx.document.dispatchEvent({ type: 'click', target: { closest: (sel) => (sel === '[data-actie]' ? el : null) } });
}

test('veilig.js: escapeHtml vervangt & < > " en \'', () => {
  assert.equal(veilig.escapeHtml('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
  assert.equal(veilig.escapeHtml(null), '');
  assert.equal(veilig.escapeHtml(undefined), '');
  assert.equal(veilig.escapeHtml(''), '');
  assert.equal(veilig.escapeHtml(12), '12');
  for (const t of TEKSTEN) assert.equal(decodeer(veilig.escapeHtml(t)), t);
});

test('veilig.js: veiligeUrl laat alleen http(s) door', () => {
  assert.equal(veilig.veiligeUrl('https://voorbeeld.nl/logo.png'), 'https://voorbeeld.nl/logo.png');
  assert.equal(veilig.veiligeUrl('http://voorbeeld.nl/a'), 'http://voorbeeld.nl/a');
  assert.equal(veilig.veiligeUrl('javascript:alert(1)'), '');
  assert.equal(veilig.veiligeUrl('data:text/html,<script>1</script>'), '');
  assert.equal(veilig.veiligeUrl(' JaVaScRiPt:alert(1)'), '');
  assert.equal(veilig.veiligeUrl(null), '');
});

test('veilig.js: actieAttr + koppelActies geven de tekst letterlijk door, alleen aan toegestane functies', () => {
  const luisteraars = [];
  const doc = { addEventListener: (type, fn) => luisteraars.push(fn) };
  const gezien = [];
  const doel = { goed: function (...args) { gezien.push(args); }, verboden: function () { gezien.push('verboden'); } };
  veilig.koppelActies(doc, ['goed'], doel);
  function klik(html) {
    const tag = ontleed('<button' + html + '>').tags[0];
    const el = { getAttribute: (n) => (n in tag.attrs ? tag.attrs[n] : null) };
    luisteraars.forEach((fn) => fn({ target: { closest: () => el } }));
  }
  klik(veilig.actieAttr('goed', ['id-1', T1, T2, T3, true]));
  assert.deepEqual(gezien, [['id-1', T1, T2, T3, true]]);
  klik(veilig.actieAttr('goed', ['id-2', undefined, null]));
  assert.equal(JSON.stringify(gezien[1]), JSON.stringify(['id-2', '', '']), 'ontbrekende waarde wordt lege tekst');
  gezien.pop();
  klik(veilig.actieAttr('verboden', []));
  klik(veilig.actieAttr('constructor', []));
  klik(' data-actie="goed" data-actie-args="geen json"');
  assert.equal(gezien.length, 1, 'niet-toegestane of kapotte acties doen niets');
});

test('beheer: privacyverzoek met testteksten wordt letterlijk getoond en de knoppen werken', async () => {
  const a = laadAdmin({
    confirm: true,
    tabellen: {
      privacy_verzoeken: [
        { id: 'pv-1', tenant_id: 't1', naam: T1, email: T1, type: 'inzage', status: 'ontvangen', created_at: '2026-11-01T10:00:00Z' },
        { id: 'pv-2', tenant_id: 't1', naam: T2, email: T2, type: 'verwijdering', status: 'ontvangen', created_at: '2026-11-02T10:00:00Z' },
        { id: 'pv-3', tenant_id: 't1', naam: T3, email: T3, type: 'correctie', status: 'ontvangen', created_at: '2026-11-03T10:00:00Z' },
      ],
    },
  });
  try {
    await a.start();
    const html = a.elementen['privacy-body'].innerHTML;
    assert.equal(typeof html, 'string');
    controleerGeenCode(html, 'privacy-body');
    assert.doesNotMatch(html, /onclick=/, 'geen onclick meer in de privacytabel');

    const { tags, tekst } = ontleed(html);
    for (const t of TEKSTEN) assert.ok(tekst.includes(t), 'testtekst letterlijk zichtbaar: ' + t);

    // Elke knop geeft de oorspronkelijke tekst ongewijzigd door aan de juiste functie.
    const gezien = [];
    for (const naam of ['handlePrivacyInzage', 'handlePrivacyVerwijdering', 'handlePrivacyCorrectie', 'handlePrivacyAfgehandeld']) {
      a.ctx[naam] = function (...args) { gezien.push([naam].concat(args)); };
    }
    const knoppen = tags.filter((t) => t.attrs['data-actie']);
    assert.equal(knoppen.length, 12, '4 knoppen per verzoek');
    knoppen.forEach((k) => klikActie(a, k));
    assert.deepEqual(gezien.slice(0, 4), [
      ['handlePrivacyInzage', T1],
      ['handlePrivacyVerwijdering', 'pv-1', T1],
      ['handlePrivacyCorrectie', T1],
      ['handlePrivacyAfgehandeld', 'pv-1', T1, T1, 'inzage'],
    ]);
    assert.deepEqual(gezien[7], ['handlePrivacyAfgehandeld', 'pv-2', T2, T2, 'verwijdering']);
    assert.deepEqual(gezien[11], ['handlePrivacyAfgehandeld', 'pv-3', T3, T3, 'correctie']);
    assert.equal(a.ctx.__xss, undefined, 'window.__xss is niet gezet');
  } finally { a.stop(); }
});

test('beheer: de echte knop "Markeer als afgehandeld" werkt nog (update in de database)', async () => {
  const a = laadAdmin({
    confirm: true,
    tabellen: { privacy_verzoeken: [{ id: 'pv-1', tenant_id: 't1', naam: T1, email: T2, type: 'inzage', status: 'ontvangen', created_at: '2026-11-01T10:00:00Z' }] },
  });
  try {
    await a.start();
    const knop = ontleed(a.elementen['privacy-body'].innerHTML).tags.find((t) => t.attrs['data-actie'] === 'handlePrivacyAfgehandeld');
    assert.ok(knop);
    a.supabase.log.length = 0;
    klikActie(a, knop);
    await a.wacht();
    const update = a.supabase.log.find((q) => q.tabel === 'privacy_verzoeken' && q.acties.includes('update'));
    assert.ok(update, 'update op privacy_verzoeken uitgevoerd');
    assert.equal(JSON.stringify(update.update), JSON.stringify([{ status: 'afgehandeld' }]));
    assert.equal(JSON.stringify(update.eq), JSON.stringify(['id', 'pv-1']));
    assert.equal(a.ctx.__xss, undefined);
  } finally { a.stop(); }
});

test('beheer: testteksten in app-feedback, verbeterpunten, medewerkers en leidinggevenden worden nergens code', async () => {
  const a = laadAdmin({
    tabellen: {
      app_feedback: TEKSTEN.map((t, i) => ({ id: 'f' + i, tenant_id: 't1', categorie: t, functiegroep: t, bericht: t, status: 'nieuw', ingediend_op: '2026-11-01T10:00:00Z' })),
      conversations: TEKSTEN.map((t, i) => ({ id: 'c' + i, tenant_id: 't1', user_id: 'p' + i, vraag: t, antwoord: t, feedback: 'niet_goed', created_at: '2026-11-01T10:00:00Z' })),
      profiles: TEKSTEN.map((t, i) => ({ id: 'p' + i, user_id: 'u' + i, tenant_id: 't1', role: 'medewerker', naam: t, email: t, functiegroep: t, teams: [t], inwerken_afgerond: false })),
      teamleiders: TEKSTEN.map((t, i) => ({ id: 'tl' + i, tenant_id: 't1', naam: t, email: t, titel: t, telefoon: t, rol: 'teamleider', teams: [t] })),
      document_mappen: TEKSTEN.map((t, i) => ({ id: 'm' + i, tenant_id: 't1', naam: t })),
      mappen: TEKSTEN.map((t, i) => ({ id: 'm' + i, tenant_id: 't1', naam: t })),
      documents: TEKSTEN.map((t, i) => ({ id: 'd' + i, tenant_id: 't1', naam: t, bestandspad: t, map: t, content: 'x', created_at: '2026-11-01T10:00:00Z' })),
      settings: [{ sleutel: 'logo_url', waarde: 'javascript:window.__xss=1' }],
    },
  });
  try {
    await a.start();
    await a.wacht(40);
    const stukken = alleHtml(a);
    assert.ok(stukken.length > 5, 'er is HTML opgebouwd');
    let metTesttekst = 0;
    for (const s of stukken) {
      controleerGeenCode(s.html, '#' + s.id);
      if (TEKSTEN.some((t) => ontleed(s.html).tekst.includes(t))) metTesttekst++;
      assert.doesNotMatch(s.html, /src="javascript:/i, '#' + s.id + ': javascript-adres als logo');
    }
    assert.ok(metTesttekst >= 3, 'de testteksten zijn in meerdere lijsten getoond (' + metTesttekst + ')');
    assert.equal(a.ctx.__xss, undefined);
  } finally { a.stop(); }
});

test('dashboard: testtekst als naam van een medewerker wordt geen code; verwijderknop geeft de naam door', async () => {
  const medewerkers = TEKSTEN.map((t, i) => ({ id: 'p' + i, user_id: 'u' + i, tenant_id: 't1', role: 'medewerker', naam: t, email: 'a' + i + '@test', functiegroep: t, teams: ['A'], teamleider_naam: 'Test Leiding' }));
  const a = laadDashboard({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ medewerkers }), text: async () => '' }),
    tabellen: { teamleiders: [{ id: 'tl1', tenant_id: 't1', naam: 'Test Leiding', email: 'leiding@test', rol: 'teamleider', teams: ['A'] }] },
  });
  try {
    await a.start();
    await a.wacht(40);
    for (const s of alleHtml(a)) controleerGeenCode(s.html, '#' + s.id);
    const html = a.elementen['tl-medewerkers-body'].innerHTML;
    const { tags, tekst } = ontleed(html);
    for (const t of TEKSTEN) assert.ok(tekst.includes(t), 'naam letterlijk zichtbaar: ' + t);
    const gezien = [];
    a.ctx.vraagVerwijdering = function (...args) { gezien.push(args); };
    const knoppen = tags.filter((t) => t.attrs['data-actie'] === 'vraagVerwijdering');
    assert.equal(knoppen.length, 3);
    knoppen.forEach((k) => klikActie(a, k));
    assert.equal(JSON.stringify(gezien), JSON.stringify([['p0', T1], ['p1', T2], ['p2', T3]]));
    assert.equal(a.ctx.__xss, undefined);
  } finally { a.stop(); }
});

test('bron: geen tekstvelden meer in onclick, geen losse logo-adressen, veilig.js geladen vóór de schermen', () => {
  const bron = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['js/admin.js', 'js/teamleider.js', 'js/medewerker.js', 'js/superadmin.js']) {
    const js = bron(f);
    // In onclick mogen alleen nog id's staan (uuid's uit de database), geen namen, e-mailadressen, paden of vragen.
    const regels = js.split('\n').filter((r) => /onclick="window\./.test(r));
    for (const r of regels) {
      for (const m of r.matchAll(/onclick="window\.\w+\(([^"]*)\)"/g)) {
        assert.doesNotMatch(m[1], /escapeHtml|\.naam|\.email|bestandspad|[vV]raag|escEmail|escNaam/, f + ': ' + r.trim().slice(0, 120));
      }
    }
    assert.doesNotMatch(js, /src="' \+ [a-zA-Z.]*logo_url/, f + ': logo-adres zonder controle');
    assert.doesNotMatch(js, /div\.textContent = text;\s*return div\.innerHTML/, f + ': oude escapeHtml');
  }
  for (const [html, script] of [['admin.html', 'js/admin.js'], ['teamleider.html', 'js/teamleider.js'], ['medewerker.html', 'js/medewerker.js'], ['superadmin.html', 'js/superadmin.js']]) {
    const h = bron(html);
    assert.ok(h.indexOf('js/veilig.js') > 0 && h.indexOf('js/veilig.js') < h.indexOf(script), html + ': veilig.js vóór ' + script);
  }
});
