// =============================================
// WEGWIJZER — Route bescherming
// Voorkomt ongeautoriseerde toegang tot pagina's
// =============================================

(function () {
  'use strict';

  // Bepaal welke rol deze pagina vereist
  var requiredRole = document.documentElement.dataset.requiredRole || null;

  async function checkAuth() {
    try {
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
        .select('role, naam, functiegroep, startdatum, tenant_id')
        .eq('user_id', session.user.id)
        .single();

      if (profileResult.error || !profileResult.data) {
        await supabaseClient.auth.signOut();
        window.location.href = appUrl('index.html');
        return;
      }

      var profile = profileResult.data;

      // Check rol als die vereist is
      if (requiredRole && profile.role !== requiredRole) {
        // Verkeerde rol, stuur door naar juiste pagina
        if (profile.role === 'admin') {
          window.location.href = appUrl('admin.html');
        } else {
          window.location.href = appUrl('medewerker.html');
        }
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
