// =============================================
// WEGWIJZER — Medewerker-bewerking opslaan
// =============================================
// Los van admin.js zodat het zonder browser getest kan worden:
// node --test tests/*.test.js

(function (root) {
  'use strict';

  // Slaat een bewerkt medewerkerprofiel op.
  // - De huidige functiegroep wordt uit de database gelezen. Wijkt de nieuwe
  //   af, dan gaan vorige_functiegroep en rolwissel_gezien=false mee in
  //   dezelfde update (medewerker.js toont dan de rolwissel).
  // - Pas na een geslaagde update, en alleen bij een echte wijziging, komt er
  //   een rij in functie_historie.
  // Geeft { fout, functiegroepGewijzigd, historieFout } terug. Databasefouten
  // komen in fout/historieFout; netwerkfouten van de client worden gegooid.
  async function slaMedewerkerOp(client, profileId, updateData) {
    var data = Object.assign({}, updateData);

    var huidig = await client.from('profiles').select('functiegroep').eq('id', profileId).maybeSingle();
    if (huidig.error) return { fout: huidig.error.message, functiegroepGewijzigd: false, historieFout: null };
    if (!huidig.data) return { fout: 'Medewerker niet gevonden.', functiegroepGewijzigd: false, historieFout: null };

    var vorige = huidig.data.functiegroep;
    var gewijzigd = !!vorige && !!data.functiegroep && vorige !== data.functiegroep;
    if (gewijzigd) {
      data.vorige_functiegroep = vorige;
      data.rolwissel_gezien = false;
    }

    // .select() geeft de bijgewerkte rij terug; zonder rij is er niets opgeslagen
    // (bijvoorbeeld geen rechten), ook al meldt de API geen fout.
    var result = await client.from('profiles').update(data).eq('id', profileId).select('id');
    if (result.error) return { fout: result.error.message, functiegroepGewijzigd: false, historieFout: null };
    if (!result.data || result.data.length === 0) {
      return { fout: 'Het profiel is niet bijgewerkt (geen rechten of medewerker niet gevonden).', functiegroepGewijzigd: false, historieFout: null };
    }

    var historieFout = null;
    if (gewijzigd) {
      var historie = await client.from('functie_historie').insert({
        profile_id: profileId,
        vorige_functie: vorige,
        nieuwe_functie: data.functiegroep,
        gewijzigd_op: new Date().toISOString()
      });
      if (historie.error) historieFout = historie.error.message;
    }

    return { fout: null, functiegroepGewijzigd: gewijzigd, historieFout: historieFout };
  }

  var api = { slaMedewerkerOp: slaMedewerkerOp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WegwijzerMedewerker = api;
})(typeof window !== 'undefined' ? window : globalThis);
