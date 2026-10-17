// Laadt js/admin.js in een Node-vm met een nep-DOM en een nep-Supabase-client,
// zodat knoppen uit het beheerscherm zonder browser getest kunnen worden.
// Elk onbekend DOM-object is een "alles-stub": elke eigenschap en aanroep geeft
// weer een stub terug. Alleen wat de tests nodig hebben is echt nagebouwd.

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function maakStub(label, extra) {
  const opslag = Object.assign({}, extra || {});
  const kinderen = {};
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop in opslag) return opslag[prop];
      if (prop === 'then') return undefined; // geen thenable: await stub geeft de stub
      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'length') return 0;
      if (typeof prop === 'symbol') return undefined;
      if (!kinderen[prop]) kinderen[prop] = maakStub(label + '.' + prop);
      return kinderen[prop];
    },
    set(_, prop, waarde) { opslag[prop] = waarde; return true; },
    apply() { return maakStub(label + '()'); },
    construct() { return maakStub('new ' + label); },
  });
}

function maakElement(id) {
  const listeners = {};
  const kinderen = [];
  const el = maakStub('#' + id, {
    id,
    listeners,
    kinderen,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(kind) { kinderen.push(kind); return kind; },
    querySelectorAll() { return []; },
    querySelector(sel) { return maakElement(id + ' ' + sel); },
    closest(sel) { return maakElement(id + '^' + sel); },
    remove() {},
  });
  return el;
}

// tabellen: { tabelnaam: [rijen] } — elke select op die tabel geeft alle rijen terug.
function maakSupabase(tabellen) {
  const log = [];
  function query(tabel, args) {
    const q = { tabel, acties: [], args };
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            log.push(q);
            const rijen = tabellen[tabel] || [];
            const single = q.acties.includes('single') || q.acties.includes('maybeSingle');
            const res = { data: single ? (rijen[0] || null) : rijen.slice(), error: null, count: rijen.length, status: 200 };
            return Promise.resolve(res).then(resolve, reject);
          };
        }
        return (...args) => { q.acties.push(prop); q[prop] = args; return builder; };
      },
    });
    return builder;
  }
  return {
    log,
    from: query,
    rpc: (naam, args) => query('rpc:' + naam, args),
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test' } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signOut: async () => ({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => maakStub('storage') },
    channel: () => maakStub('channel'),
    removeChannel: () => {},
  };
}

// Laadt admin.js. opties.tabellen: nepdata; opties.confirm: antwoord op confirm().
function laadAdmin(opties) {
  opties = opties || {};
  const elementen = {};
  const docListeners = {};
  const body = maakElement('body');
  const meldingen = { confirm: [], alert: [] };
  const fouten = [];
  const opslag = new Map();

  const document = maakStub('document', {
    getElementById(id) { return (elementen[id] = elementen[id] || maakElement(id)); },
    querySelector(sel) { return maakElement(sel); },
    querySelectorAll() { return []; },
    createElement(tag) { return maakElement('<' + tag + '>'); },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    body,
  });
  const supabase = maakSupabase(opties.tabellen || {});

  const ctx = {
    document,
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    localStorage: { getItem: (k) => (opslag.has(k) ? opslag.get(k) : null), setItem: (k, v) => opslag.set(k, String(v)), removeItem: (k) => opslag.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: maakStub('navigator'),
    location: maakStub('location', { href: 'https://test/admin.html', search: '', hash: '' }),
    history: maakStub('history'),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
    confirm: (tekst) => { meldingen.confirm.push(tekst); return !!opties.confirm; },
    alert: (tekst) => { meldingen.alert.push(tekst); },
    prompt: () => null,
    supabaseClient: supabase,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    appUrl: (p) => '/' + (p || ''),
    Notification: maakStub('Notification'),
    MutationObserver: function () { return maakStub('mo'); },
    IntersectionObserver: function () { return maakStub('io'); },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type) { this.type = type; },
    getComputedStyle: () => maakStub('style'),
    URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Blob, FormData, crypto: globalThis.crypto,
    pdfjsLib: maakStub('pdfjsLib'), mammoth: maakStub('mammoth'), XLSX: maakStub('XLSX'),
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);

  // Fouten uit losse loaders (async) verzamelen in plaats van het proces te laten stoppen.
  const opVangen = (err) => fouten.push(err);
  process.on('unhandledRejection', opVangen);

  for (const bestand of ['js/medewerker-opslaan.js', 'js/admin.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, bestand), 'utf8'), ctx, { filename: bestand });
  }

  async function wacht(rondes) {
    for (let i = 0; i < (rondes || 20); i++) await new Promise((r) => setImmediate(r));
  }

  return {
    ctx, elementen, body, meldingen, fouten, supabase, wacht,
    // Start het beheerscherm zoals route-guard.js dat doet na het inloggen.
    async start() {
      const evt = { detail: { profile: { tenant_id: 't1', role: 'admin', naam: 'Test Beheer' }, user: { id: 'u1', email: 'beheer@test' } } };
      for (const fn of docListeners['wegwijzer-auth-ready'] || []) fn(evt);
      await wacht();
    },
    async klik(id) {
      const el = elementen[id];
      if (!el || !el.listeners.click) throw new Error('geen klik-listener op #' + id);
      for (const fn of el.listeners.click) await fn({ preventDefault() {}, target: el });
      await wacht();
    },
    toasts() {
      return body.kinderen.filter((k) => k.id === 'wegwijzer-toast').map((k) => k.textContent);
    },
    stop() { process.removeListener('unhandledRejection', opVangen); },
  };
}

module.exports = { laadAdmin };
