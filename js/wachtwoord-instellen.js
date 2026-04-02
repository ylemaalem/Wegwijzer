// =============================================
// WEGWIJZER — Wachtwoord instellen
// Na uitnodiging of wachtwoord vergeten
// =============================================

(function () {
  'use strict';

  const form = document.getElementById('set-password-form');
  const alertBox = document.getElementById('alert');
  const alertMessage = document.getElementById('alert-message');
  const submitBtn = document.getElementById('set-password-btn');
  const successView = document.getElementById('success-view');
  const formView = document.getElementById('form-view');

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

  // Luister naar auth event (recovery of invite token)
  supabaseClient.auth.onAuthStateChange(async function (event, session) {
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
      // Gebruiker is geverifieerd via link, toon formulier
      if (formView) {
        formView.classList.remove('hidden');
      }
    }
  });

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert();

      const password = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      // Validatie
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
        const { error } = await supabaseClient.auth.updateUser({
          password: password
        });

        if (error) {
          showAlert('Er ging iets mis. Probeer het opnieuw of vraag een nieuwe link aan.', 'error');
          setLoading(submitBtn, false);
          return;
        }

        // Succes
        formView.classList.add('hidden');
        successView.classList.remove('hidden');

        // Na 3 seconden doorsturen naar login
        setTimeout(function () {
          window.location.href = appUrl('index.html');
        }, 3000);
      } catch (err) {
        showAlert('Verbindingsfout. Controleer je internetverbinding.', 'error');
        setLoading(submitBtn, false);
      }
    });
  }
})();
