// =============================================
// WEGWIJZER — Authenticatie logica
// =============================================

(function () {
  'use strict';

  // ---- DOM elementen ----
  const loginForm = document.getElementById('login-form');
  const resetForm = document.getElementById('reset-form');
  const loginView = document.getElementById('login-view');
  const resetView = document.getElementById('reset-view');
  const alertBox = document.getElementById('alert');
  const alertMessage = document.getElementById('alert-message');
  const loginBtn = document.getElementById('login-btn');
  const resetBtn = document.getElementById('reset-btn');
  const showResetLink = document.getElementById('show-reset');
  const showLoginLink = document.getElementById('show-login');

  // ---- Helpers ----
  function showAlert(message, type) {
    alertBox.className = 'alert alert-' + type + ' show';
    alertMessage.textContent = message;
  }

  function hideAlert() {
    alertBox.className = 'alert';
  }

  function setLoading(button, loading) {
    if (loading) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.innerHTML = '<span class="spinner"></span> Even geduld...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Inloggen';
    }
  }

  // ---- Wissel tussen login en wachtwoord vergeten ----
  if (showResetLink) {
    showResetLink.addEventListener('click', function (e) {
      e.preventDefault();
      hideAlert();
      loginView.classList.add('hidden');
      resetView.classList.remove('hidden');
    });
  }

  if (showLoginLink) {
    showLoginLink.addEventListener('click', function (e) {
      e.preventDefault();
      hideAlert();
      resetView.classList.add('hidden');
      loginView.classList.remove('hidden');
    });
  }

  // ---- Login ----
  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showAlert('Vul je e-mailadres en wachtwoord in.', 'error');
        return;
      }

      setLoading(loginBtn, true);

      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (error) {
          if (error.message.includes('Invalid login')) {
            showAlert('Onjuist e-mailadres of wachtwoord.', 'error');
          } else {
            showAlert('Er ging iets mis. Probeer het opnieuw.', 'error');
          }
          setLoading(loginBtn, false);
          return;
        }

        // Login gelukt — haal profiel op om rol te bepalen
        const { data: profile, error: profileError } = await supabaseClient
          .from('profiles')
          .select('role, functiegroep, dashboard_toegang')
          .eq('user_id', data.user.id)
          .single();

        if (profileError || !profile) {
          showAlert('Profiel niet gevonden. Neem contact op met je teamleider.', 'error');
          await supabaseClient.auth.signOut();
          setLoading(loginBtn, false);
          return;
        }

        // Doorsturen op basis van rol of functiegroep
        var isTeamleider = profile.role === 'teamleider' ||
          (profile.functiegroep && profile.functiegroep.toLowerCase().indexOf('teamleider') !== -1) ||
          (profile.functiegroep && profile.functiegroep.toLowerCase().indexOf('leidinggevende') !== -1) ||
          profile.dashboard_toegang === true;

        if (profile.role === 'admin') {
          window.location.href = appUrl('admin.html');
        } else if (isTeamleider) {
          window.location.href = appUrl('teamleider.html');
        } else {
          window.location.href = appUrl('medewerker.html');
        }
      } catch (err) {
        showAlert('Verbindingsfout. Controleer je internetverbinding.', 'error');
        setLoading(loginBtn, false);
      }
    });
  }

  // ---- Wachtwoord vergeten ----
  if (resetForm) {
    resetForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();

      const email = document.getElementById('reset-email').value.trim();

      if (!email) {
        showAlert('Vul je e-mailadres in.', 'error');
        return;
      }

      setLoading(resetBtn, true);

      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + appUrl('wachtwoord-instellen.html')
        });

        if (error) {
          showAlert('Er ging iets mis. Probeer het opnieuw.', 'error');
          setLoading(resetBtn, false);
          return;
        }

        showAlert('Als dit e-mailadres bij ons bekend is, ontvang je een e-mail met instructies.', 'success');
        setLoading(resetBtn, false);
      } catch (err) {
        showAlert('Verbindingsfout. Controleer je internetverbinding.', 'error');
        setLoading(resetBtn, false);
      }
    });
  }

  // ---- Controleer of gebruiker al ingelogd is ----
  async function checkExistingSession() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();

      if (session) {
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('role, functiegroep, dashboard_toegang')
          .eq('user_id', session.user.id)
          .single();

        if (profile) {
          var isTeamleider = profile.role === 'teamleider' ||
            (profile.functiegroep && profile.functiegroep.toLowerCase().indexOf('teamleider') !== -1) ||
            (profile.functiegroep && profile.functiegroep.toLowerCase().indexOf('leidinggevende') !== -1) ||
            profile.dashboard_toegang === true;

          if (profile.role === 'admin') {
            window.location.href = appUrl('admin.html');
          } else if (isTeamleider) {
            window.location.href = appUrl('teamleider.html');
          } else {
            window.location.href = appUrl('medewerker.html');
          }
        }
      }
    } catch (err) {
      // Geen sessie, blijf op login pagina
    }
  }

  checkExistingSession();
})();
