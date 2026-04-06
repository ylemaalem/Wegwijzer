// =============================================
// WEGWIJZER — Wachtwoord instellen
// Na uitnodiging of wachtwoord vergeten
// =============================================

(function () {
  'use strict';

  var form = document.getElementById('set-password-form');
  var alertBox = document.getElementById('alert');
  var alertMessage = document.getElementById('alert-message');
  var submitBtn = document.getElementById('set-password-btn');
  var successView = document.getElementById('success-view');
  var formView = document.getElementById('form-view');

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
      button.textContent = button.dataset.originalText || 'Wachtwoord instellen';
    }
  }

  // Stap 1: Parse hash parameters uit URL
  var hashParams = {};
  if (window.location.hash) {
    var hash = window.location.hash.substring(1);
    hash.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) {
        hashParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
      }
    });
  }

  console.log('[Wachtwoord] Hash params:', Object.keys(hashParams).join(', '));
  console.log('[Wachtwoord] Type:', hashParams.type || '(geen)');

  // Stap 2: Als er tokens in de URL staan, stel sessie in
  async function initSession() {
    if (hashParams.access_token && hashParams.refresh_token) {
      console.log('[Wachtwoord] Tokens gevonden, setSession aanroepen');
      try {
        var result = await supabaseClient.auth.setSession({
          access_token: hashParams.access_token,
          refresh_token: hashParams.refresh_token
        });
        if (result.error) {
          console.error('[Wachtwoord] setSession fout:', result.error.message);
          showAlert('Link is verlopen. Vraag een nieuwe link aan.', 'error');
          return;
        }
        console.log('[Wachtwoord] Sessie ingesteld, toon formulier');
        if (formView) formView.classList.remove('hidden');
      } catch (err) {
        console.error('[Wachtwoord] setSession exception:', err);
        showAlert('Er ging iets mis bij het verwerken van de link.', 'error');
      }
    } else {
      console.log('[Wachtwoord] Geen tokens in URL, wacht op auth event');
    }
  }

  initSession();

  // Stap 3: Luister ook naar auth events als fallback
  supabaseClient.auth.onAuthStateChange(function (event, session) {
    console.log('[Wachtwoord] Auth event:', event);
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
      if (formView) formView.classList.remove('hidden');
    }
  });

  // Stap 4: Formulier submit
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();

      var password = document.getElementById('new-password').value;
      var confirmPassword = document.getElementById('confirm-password').value;

      if (!password || !confirmPassword) {
        showAlert('Vul beide velden in.', 'error');
        return;
      }

      if (password.length < 8) {
        showAlert('Wachtwoord moet minimaal 8 tekens bevatten.', 'error');
        return;
      }

      if (password !== confirmPassword) {
        showAlert('Wachtwoorden komen niet overeen.', 'error');
        return;
      }

      setLoading(submitBtn, true);

      try {
        // Check of er een actieve sessie is
        var sessionCheck = await supabaseClient.auth.getSession();
        console.log('[Wachtwoord] Sessie check:', sessionCheck.data.session ? 'actief' : 'GEEN SESSIE');

        if (!sessionCheck.data.session) {
          showAlert('Je sessie is verlopen. Vraag een nieuwe link aan via de inlogpagina.', 'error');
          setLoading(submitBtn, false);
          return;
        }

        var result = await supabaseClient.auth.updateUser({
          password: password
        });

        console.log('[Wachtwoord] updateUser resultaat:', result.error ? 'FOUT: ' + result.error.message : 'OK');

        if (result.error) {
          showAlert('Wachtwoord instellen mislukt: ' + result.error.message, 'error');
          setLoading(submitBtn, false);
          return;
        }

        // Succes
        formView.classList.add('hidden');
        successView.classList.remove('hidden');

        setTimeout(function () {
          window.location.href = appUrl('index.html');
        }, 3000);
      } catch (err) {
        console.error('[Wachtwoord] Exception:', err);
        showAlert('Verbindingsfout. Controleer je internetverbinding.', 'error');
        setLoading(submitBtn, false);
      }
    });
  }
})();
