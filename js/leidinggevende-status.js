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
    s.profielId = (s.profiel && s.profiel.id) || null;
    delete s.profiel;
    return s;
  }

  // Keuzes in het verwijdervenster van het tabblad Leidinggevende/HR (2026-10-25).
  // (a) en (b) zijn dezelfde keuzes als bij Medewerkers; 'rij' haalt alleen de rij weg.
  // Geeft [{ key, titel, uitleg }] terug, in de volgorde van het venster.
  var KEUZE_A = { key: 'chattoegang_uit', titel: '(a) Alleen de chattoegang uitzetten (aanbevolen)',
    uitleg: 'Het account en het dashboard blijven. De persoon kan de kennisassistent niet meer gebruiken.' };
  var KEUZE_B = { key: 'ook_leidinggevende', titel: '(b) Account én leidinggevende verwijderen',
    uitleg: 'De persoon kan niet meer inloggen en staat niet meer bij Leidinggevende/HR. Gesprekken blijven zonder naam bewaard; de tekst wordt na 12 maanden gewist.' };

  function verwijderKeuzes(status) {
    var code = status && status.code;
    if (!status || !status.profielId || code === 'geen_email' || code === 'geen_account') {
      return [{ key: 'rij', titel: 'Uit de lijst Leidinggevende/HR halen', uitleg: 'Er is geen inlogaccount; alleen deze rij wordt verwijderd.' }];
    }
    var rijMetAccount = { key: 'rij', titel: 'Alleen uit de lijst Leidinggevende/HR halen',
      uitleg: 'Het account blijft, maar wordt een gewoon medewerkersaccount mét kennisassistent en zonder dashboard.' };
    if (code === 'beheerder') return [rijMetAccount];
    if (code === 'rol_medewerker') return [KEUZE_B, rijMetAccount];
    return status.alleenDashboard ? [KEUZE_B, rijMetAccount] : [KEUZE_A, KEUZE_B, rijMetAccount];
  }

  // Zelfde (a) en (b) voor het venster bij Medewerkers.
  function verwijderKeuzesMedewerker() {
    return [KEUZE_A, KEUZE_B];
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

  var api = { leidinggevendeStatus: leidinggevendeStatus, verwijderKeuzes: verwijderKeuzes, verwijderKeuzesMedewerker: verwijderKeuzesMedewerker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WegwijzerLeidinggevende = api;
})(typeof window !== 'undefined' ? window : globalThis);
