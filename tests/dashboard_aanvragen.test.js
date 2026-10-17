// Test voor "+ Medewerker aanvragen" op het tabblad Aanvragen voor HR (js/teamleider.js).
// Draaien: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { laadDashboard } = require('./helpers/admin_harness.js');

const TABELLEN = {
  teamleiders: [{ rol: 'hr', teams: [] }],
  functiegroepen: [{ code: 'ambulant_begeleider', naam: 'Ambulant begeleider', is_kantoor: false }],
};

async function dienIn(a) {
  for (const fn of a.elementen['tl-aanvraag-form'].listeners.submit) await fn({ preventDefault() {} });
  await a.wacht();
}

function vulIn(a, velden) {
  for (const [id, waarde] of Object.entries(velden)) a.ctx.document.getElementById(id).value = waarde;
}

test('HR: de knop op Aanvragen opent het aanvraagformulier', async () => {
  const a = laadDashboard({ tabellen: TABELLEN });
  try {
    await a.start();
    await a.klik('tl-aanvraag-btn-hr');
    assert.ok(a.elementen['modal-tl-aanvraag'].classList.contains('show'));
  } finally { a.stop(); }
});

test('HR: indienen schrijft een aanvraag met het gekozen team', async () => {
  const a = laadDashboard({ tabellen: TABELLEN });
  try {
    await a.start();
    await a.klik('tl-aanvraag-btn-hr');
    vulIn(a, {
      'tl-aanvraag-naam': 'Nieuwe Collega', 'tl-aanvraag-email': 'nieuw@test.nl',
      'tl-aanvraag-functiegroep': 'ambulant_begeleider', 'tl-aanvraag-werkuren': '32',
      'tl-aanvraag-startdatum': '2026-11-01', 'tla-team-dropdown': 'Team Almere',
    });
    await dienIn(a);
    const insert = a.supabase.log.find((q) => q.tabel === 'aanvragen' && q.acties.includes('insert'));
    assert.ok(insert, 'geen insert in aanvragen');
    const rij = insert.insert[0];
    assert.equal(rij.type, 'nieuw');
    assert.equal(rij.aangevraagd_door, 'p-tl');
    assert.equal(rij.medewerker_team, 'Team Almere');
    assert.equal(rij.medewerker_email, 'nieuw@test.nl');
    assert.equal(a.elementen['tl-aanvraag-alert-message'].textContent, 'Aanvraag ingediend! De admin wordt op de hoogte gesteld.');
    assert.equal(a.elementen['tl-aanvraag-submit'].disabled, false);
  } finally { a.stop(); }
});

test('HR: zonder team geen aanvraag', async () => {
  const a = laadDashboard({ tabellen: TABELLEN });
  try {
    await a.start();
    await a.klik('tl-aanvraag-btn-hr');
    vulIn(a, {
      'tl-aanvraag-naam': 'Nieuwe Collega', 'tl-aanvraag-email': 'nieuw@test.nl',
      'tl-aanvraag-functiegroep': 'ambulant_begeleider', 'tl-aanvraag-werkuren': '', 'tla-team-dropdown': '',
    });
    await dienIn(a);
    assert.ok(!a.supabase.log.some((q) => q.tabel === 'aanvragen' && q.acties.includes('insert')));
  } finally { a.stop(); }
});
