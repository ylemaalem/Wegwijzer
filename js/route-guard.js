// =============================================
// WEGWIJZER — Route bescherming
// Voorkomt ongeautoriseerde toegang tot pagina's
// =============================================

(function () {
  'use strict';

  // Waar moet deze gebruiker heen? null = de pagina mag. Los te testen:
  // node --test tests/*.test.js (tests/alleen_dashboard.test.js).
  // D2 (migratie 108): een account met alleen_dashboard komt niet op de
  // kennisassistent; met een rij in teamleiders gaat het naar het dashboard, zonder
  // rij (komt niet voor: de database zet alleen_dashboard dan uit) naar het inlogscherm.
  function bestemming(requiredRole, profile, isTeamleider) {
    var alleenDashboard = profile.alleen_dashboard === true && profile.role !== 'admin';
    if (alleenDashboard && !isTeamleider) return 'index.html';
    if (!requiredRole) return null;
    var allowed = false;
    if (requiredRole === 'admin' && profile.role === 'admin') allowed = true;
    if (requiredRole === 'medewerker' && !alleenDashboard && (profile.role === 'medewerker' || profile.role === 'teamleider' || isTeamleider)) allowed = true;
    if (requiredRole === 'teamleider' && isTeamleider) allowed = true;
    if (allowed) return null;
    if (profile.role === 'admin') return 'admin.html';
    if (isTeamleider) return 'teamleider.html';
    return 'medewerker.html';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bestemming: bestemming };
    return;
  }

  // Bepaal welke rol deze pagina vereist
  var requiredRole = document.documentElement.dataset.requiredRole || null;

  async function checkAuth() {
    try {
      // Ververs JWT sessietoken zodat user_metadata actueel is
      await supabaseClient.auth.refreshSession();
      var result = await supabaseClient.auth.getSession();
      var session = result.data.session;

      // Geen sessie? Terug naar login
      if (!session) {
        window.location.href = appUrl('index.html');
        return;
      }

      // Haal profiel op
      var profileResult = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (profileResult.error || !profileResult.data) {
        await supabaseClient.auth.signOut();
        window.location.href = appUrl('index.html');
        return;
      }

      var profile = profileResult.data;

      // Dashboardrechten alleen met role 'teamleider' én een rij in de
      // leidinggevenden-lijst van de eigen organisatie (migratie 096). Een functie
      // (functiegroep) geeft nooit rechten.
      var isTeamleider = false;
      if (profile.role === 'teamleider') {
        var tlRes = await supabaseClient.rpc('mijn_leidinggevende_rol');
        isTeamleider = !tlRes.error && !!tlRes.data;
      }

      // Check rol als die vereist is
      var doel = bestemming(requiredRole, profile, isTeamleider);
      if (doel) {
        if (doel === 'index.html') await supabaseClient.auth.signOut();
        window.location.href = appUrl(doel);
        return;
      }

      // Sla profiel op voor gebruik door andere scripts
      window.wegwijzerProfile = profile;
      window.wegwijzerUser = session.user;

      // Trigger custom event zodat pagina-specifieke scripts weten dat auth klaar is
      document.dispatchEvent(new CustomEvent('wegwijzer-auth-ready', {
        detail: { profile: profile, user: session.user }
      }));

    } catch (err) {
      console.error('Route guard fout:', err);
      window.location.href = appUrl('index.html');
    }
  }

  checkAuth();
})();
