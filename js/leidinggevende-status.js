// =============================================
// WEGWIJZER — Accountstatus van een leidinggevende (tabblad Leidinggevende/HR)
// =============================================
// D1 (2026-10-25): een rij in teamleiders kan bestaan zonder inlogaccount, bijvoorbeeld
// na verwijderen bij Medewerkers. Dan werken inloggen en "wachtwoord vergeten" niet,
// en was in de lijst niet te zien dat 📧 de oplossing is (de server nodigt dan opnieuw
// uit met de rol uit teamleiders, zie _shared/uitnodigingsrol.ts).
// Los van admin.js zodat het zonder browser getest kan worden:
// node --test tests/*.test.js

(function (root) {
  'use strict';

  function normaalEmail(e) {
    return String(e == null ? '' : e).trim().toLowerCase();
  }

  // rij: { email }; profielen: [{ email, role, eerste_login_op, laatste_actief,
  // alleen_dashboard }] van de eigen organisatie. Geeft { code, label, knopTekst,
  // knopTitel, alleenDashboard } terug.
  function leidinggevendeStatus(rij, profielen) {
    var s = basisStatus(rij, profielen);
    s.alleenDashboard = !!(s.profiel && s.profiel.alleen_dashboard === true);
    if (s.alleenDashboard && s.code !== 'rol_medewerker') s.label += ' · alleen dashboard';
    delete s.profiel;
    return s;
  }

  function basisStatus(rij, profielen) {
    var email = normaalEmail(rij && rij.email);
    if (!email) {
      return { code: 'geen_email', label: 'Geen e-mailadres', knopTekst: null, knopTitel: null };
    }
    var p = (profielen || []).find(function (x) { return normaalEmail(x && x.email) === email; }) || null;
    if (!p) {
      return { code: 'geen_account', label: 'Geen account', knopTekst: '📧 Uitnodigen',
        knopTitel: 'Er is geen inlogaccount. Stuurt een uitnodiging met de rol uit deze lijst.' };
    }
    if (p.role === 'admin') {
      return { code: 'beheerder', label: 'Beheerder', knopTekst: '📧',
        knopTitel: 'Uitnodiging of resetmail opnieuw sturen', profiel: p };
    }
    if (p.role !== 'teamleider') {
      return { code: 'rol_medewerker', label: 'Account zonder dashboard', knopTekst: '📧 Herstellen',
        knopTitel: 'Het account heeft de rol medewerker. Zet de rol recht uit deze lijst.', profiel: p };
    }
    if (!p.eerste_login_op && !p.laatste_actief) {
      return { code: 'uitgenodigd', label: 'Uitgenodigd, nog niet ingelogd', knopTekst: '📧',
        knopTitel: 'Uitnodiging opnieuw sturen', profiel: p };
    }
    return { code: 'actief', label: 'Account actief', knopTekst: '📧',
      knopTitel: 'Uitnodiging opnieuw sturen', profiel: p };
  }

  var api = { leidinggevendeStatus: leidinggevendeStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WegwijzerLeidinggevende = api;
})(typeof window !== 'undefined' ? window : globalThis);
