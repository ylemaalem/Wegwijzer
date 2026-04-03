// =============================================
// WEGWIJZER — Medewerker chat logica
// Met gesprekshistorie en herontworpen UI
// =============================================

(function () {
  'use strict';

  // ---- State ----
  var profile = null;
  var user = null;
  var weekNummer = 1;
  var isSending = false;
  var chatInitialized = false;
  var historieGeladen = false;

  // ---- DOM ----
  var welcomeScreen = document.getElementById('welcome-screen');
  var chatScreen = document.getElementById('chat-screen');
  var backBtn = document.getElementById('back-btn');
  var startBtn = document.getElementById('start-chat-btn');
  var sendBtn = document.getElementById('send-btn');
  var chatInput = document.getElementById('chat-input');
  var chatMessages = document.getElementById('chat-messages');
  var typingIndicator = document.getElementById('typing-indicator');
  var disclaimerBanner = document.getElementById('disclaimer-banner');
  var chipsBar = document.getElementById('chips-bar');

  // ---- Wacht op auth ----
  document.addEventListener('wegwijzer-auth-ready', function (e) {
    profile = e.detail.profile;
    user = e.detail.user;
    weekNummer = berekenWeekNummer(profile.startdatum);
    initWelkom();
    initChatInput();
    initChips();
    initLogout();
    laadTenantInstellingen();
  });

  // =============================================
  // WEEKNUMMER BEREKENEN
  // =============================================
  function berekenWeekNummer(startdatum) {
    if (!startdatum) return 1;
    var start = new Date(startdatum);
    var nu = new Date();

    // Nog niet gestart
    if (nu < start) return 1;

    // Vind de maandag van de startweek
    // getDay(): 0=zo, 1=ma, ..., 6=za
    var startDag = start.getDay();
    // Verschuif naar maandag: zo(0)->-6, ma(1)->0, di(2)->-1, ..., za(6)->-5
    var offsetNaarMaandag = startDag === 0 ? -6 : 1 - startDag;
    var maandagWeek1 = new Date(start);
    maandagWeek1.setDate(start.getDate() + offsetNaarMaandag);
    maandagWeek1.setHours(0, 0, 0, 0);

    // Vind de maandag van de huidige week
    var nuDag = nu.getDay();
    var offsetNu = nuDag === 0 ? -6 : 1 - nuDag;
    var maandagNu = new Date(nu);
    maandagNu.setDate(nu.getDate() + offsetNu);
    maandagNu.setHours(0, 0, 0, 0);

    // Weeknummer = verschil in weken tussen de twee maandagen + 1
    var verschilMs = maandagNu.getTime() - maandagWeek1.getTime();
    var verschilWeken = Math.round(verschilMs / (7 * 24 * 60 * 60 * 1000));
    var week = verschilWeken + 1;

    return Math.max(1, week);
  }

  // =============================================
  // WELKOMSCHERM
  // =============================================
  function initWelkom() {
    var naam = profile.naam ? profile.naam.split(' ')[0] : '';
    document.getElementById('welcome-title').textContent =
      naam ? 'Welkom, ' + naam + '!' : 'Welkom!';

    var meter = document.getElementById('progress-meter');
    var labels = document.getElementById('progress-labels');
    var weekBadge = document.getElementById('welcome-week');
    var subtitle = document.getElementById('welcome-subtitle');

    if (weekNummer > 6) {
      // Na inwerkperiode: verberg voortgang, toon kennisassistent modus
      if (meter) meter.style.display = 'none';
      if (labels) labels.style.display = 'none';
      if (weekBadge) weekBadge.style.display = 'none';
      if (subtitle) subtitle.textContent = 'Ik ben jouw kennisassistent. Stel me vragen over protocollen, werkwijze en procedures.';
    } else {
      // Tijdens inwerkperiode: toon voortgang
      if (weekBadge) weekBadge.textContent = 'Week ' + weekNummer + ' van 6';

      meter.innerHTML = '';
      labels.innerHTML = '';

      for (var i = 1; i <= 6; i++) {
        var step = document.createElement('div');
        step.className = 'progress-step';
        if (i < weekNummer) step.className += ' done';
        if (i === weekNummer) step.className += ' current';
        meter.appendChild(step);

        var label = document.createElement('span');
        label.className = 'progress-label';
        if (i === weekNummer) label.className += ' active';
        label.textContent = i;
        labels.appendChild(label);
      }
    }

    // Privacy notice: altijd zichtbaar op welkomscherm
    var privacyNotice = document.getElementById('privacy-notice');
    if (privacyNotice) {
      privacyNotice.style.display = '';
    }

    // Start knop
    startBtn.addEventListener('click', function () {
      openChat();
    });

    // Terug knop
    backBtn.addEventListener('click', function () {
      chatScreen.classList.remove('active');
      welcomeScreen.style.display = '';
      backBtn.classList.add('hidden');
    });
  }

  // =============================================
  // CHAT OPENEN — met historie laden
  // =============================================
  async function openChat() {
    welcomeScreen.style.display = 'none';
    chatScreen.classList.add('active');
    backBtn.classList.remove('hidden');

    // Laad historie alleen de eerste keer
    if (!chatInitialized) {
      chatInitialized = true;
      await laadGesprekshistorie();
    }

    chatInput.focus();
    scrollNaarOnder();
  }

  // =============================================
  // GESPREKSHISTORIE LADEN
  // =============================================
  async function laadGesprekshistorie() {
    try {
      var result = await supabaseClient
        .from('conversations')
        .select('id, vraag, antwoord, feedback, created_at')
        .order('created_at', { ascending: true });

      if (result.error || !result.data) {
        // Kan historie niet laden, toon welkomstbericht
        toonWelkomstBericht();
        return;
      }

      if (result.data.length === 0) {
        // Geen eerdere gesprekken, toon welkomstbericht
        toonWelkomstBericht();
        return;
      }

      // Toon alle eerdere berichten
      historieGeladen = true;
      result.data.forEach(function (conv) {
        var tijd = formatTijd(conv.created_at);

        // Gebruikersvraag
        renderGebruikersBericht(conv.vraag, tijd);

        // Bot antwoord
        if (conv.antwoord) {
          renderBotBericht(conv.antwoord, conv.id, conv.feedback, tijd);
        }
      });

      scrollNaarOnder();
    } catch (err) {
      toonWelkomstBericht();
    }
  }

  function toonWelkomstBericht() {
    var naam = profile.naam ? profile.naam.split(' ')[0] : '';
    var tekst;

    if (weekNummer > 6) {
      tekst = 'Hallo' + (naam ? ' ' + naam : '') + '! ' +
        'Ik ben jouw kennisassistent. Stel me vragen over protocollen, werkwijze en procedures.';
    } else {
      var fg = formatFunctiegroep(profile.functiegroep);
      tekst = 'Hallo' + (naam ? ' ' + naam : '') + '! ' +
        'Ik ben je kennisassistent. Je bent nu in week ' + weekNummer + ' van je inwerktraject' +
        (fg ? ' als ' + fg : '') + '. ' +
        'Stel me gerust een vraag over werkwijze, protocollen of je inwerktraject.';
    }

    renderBotBericht(tekst, null, null, null);
  }

  // =============================================
  // SUGGESTIE CHIPS
  // =============================================
  function initChips() {
    if (weekNummer > 6) {
      chipsBar.innerHTML = '';
      var kennisChips = [
        { emoji: '\uD83D\uDCCB', text: 'Protocollen opzoeken', vraag: 'Welke protocollen zijn er?' },
        { emoji: '\uD83D\uDCBC', text: 'Declaraties', vraag: 'Hoe werken declaraties?' },
        { emoji: '\uD83D\uDCDD', text: 'Rapportage schrijven', vraag: 'Hoe schrijf ik een rapportage?' },
        { emoji: '\u2753', text: 'Veelgestelde vragen', vraag: 'Wat zijn veelgestelde vragen?' },
        { emoji: '\uD83D\uDD17', text: 'Documenten en links', vraag: 'Welke documenten en links zijn beschikbaar?' }
      ];
      kennisChips.forEach(function(c) {
        var btn = document.createElement('button');
        btn.className = 'chip';
        btn.dataset.vraag = c.vraag;
        btn.textContent = c.emoji + ' ' + c.text;
        chipsBar.appendChild(btn);
      });
    }

    // Attach click handlers to ALL chips (existing or new)
    var chips = chipsBar.querySelectorAll('.chip');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var vraag = chip.dataset.vraag;
        if (vraag && !isSending) {
          chatInput.value = vraag;
          sendBtn.disabled = false;
          verstuurVraag();
        }
      });
    });
  }

  // =============================================
  // CHAT INPUT
  // =============================================
  function initChatInput() {
    // Auto-resize
    chatInput.addEventListener('input', function () {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
      sendBtn.disabled = chatInput.value.trim().length === 0;
    });

    // Enter = verstuur, Shift+Enter = nieuwe regel
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isSending) {
          verstuurVraag();
        }
      }
    });

    sendBtn.addEventListener('click', function () {
      if (!isSending) verstuurVraag();
    });
  }

  // =============================================
  // VRAAG VERSTUREN
  // =============================================
  async function verstuurVraag() {
    var vraag = chatInput.value.trim();
    if (!vraag || isSending) return;

    isSending = true;
    sendBtn.disabled = true;
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Toon gebruikersbericht
    renderGebruikersBericht(vraag, null);

    // Toon typing indicator
    typingIndicator.classList.remove('hidden');
    scrollNaarOnder();

    try {
      var session = await supabaseClient.auth.getSession();
      var token = session.data.session.access_token;

      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          vraag: vraag,
          functiegroep: profile.functiegroep,
          weeknummer: weekNummer
        })
      });

      var data = await response.json();
      typingIndicator.classList.add('hidden');

      if (data.soft_limit) {
        // Zachte limiet: toon popup modal
        toonRateLimitPopup(token);
      } else if (data.hard_limit) {
        renderBotBericht(
          data.error || 'Je hebt het maximale aantal vragen voor vandaag bereikt. Morgen kun je weer vragen stellen.',
          null, null, null
        );
      } else if (response.status === 429 || data.rate_limited) {
        renderBotBericht(
          data.error || 'Je hebt het dagelijkse maximum bereikt. Morgen kun je weer vragen stellen.',
          null, null, null
        );
      } else if (!response.ok || data.error) {
        renderBotBericht(
          'Sorry, er ging iets mis bij het verwerken van je vraag. Probeer het opnieuw of neem contact op met je teamleider.',
          null, null, null
        );
      } else {
        renderBotBericht(data.antwoord, data.conversation_id, null, null);
      }
    } catch (err) {
      typingIndicator.classList.add('hidden');
      renderBotBericht(
        'Verbindingsfout. Controleer je internetverbinding en probeer het opnieuw.',
        null, null, null
      );
    }

    isSending = false;
    sendBtn.disabled = chatInput.value.trim().length === 0;
    scrollNaarOnder();
  }

  // =============================================
  // BERICHTEN RENDEREN — met avatars
  // =============================================
  function renderGebruikersBericht(tekst, tijd) {
    var row = document.createElement('div');
    row.className = 'message-row message-row-user';

    // Avatar
    var avatar = document.createElement('div');
    avatar.className = 'avatar avatar-user';
    avatar.textContent = '👤';

    // Bubble wrap (bubble + tijd)
    var wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-user';
    bubble.textContent = tekst;
    wrap.appendChild(bubble);

    // Tijdstempel
    var timeEl = document.createElement('div');
    timeEl.className = 'bubble-time';
    timeEl.textContent = tijd || formatTijd(new Date().toISOString());
    wrap.appendChild(timeEl);

    row.appendChild(avatar);
    row.appendChild(wrap);
    chatMessages.insertBefore(row, typingIndicator);
  }

  function renderBotBericht(tekst, conversationId, bestaandeFeedback, tijd) {
    var row = document.createElement('div');
    row.className = 'message-row message-row-bot';

    // Avatar
    var avatar = document.createElement('div');
    avatar.className = 'avatar avatar-bot';
    avatar.textContent = '🗺️';

    // Bubble wrap
    var wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-bot';
    bubble.innerHTML = formatAntwoord(tekst);
    wrap.appendChild(bubble);

    // Feedback knoppen
    if (conversationId) {
      var feedbackRow = document.createElement('div');
      feedbackRow.className = 'feedback-row';

      var btnGoed = document.createElement('button');
      btnGoed.className = 'feedback-btn';
      btnGoed.textContent = '👍 Nuttig';

      var btnNietGoed = document.createElement('button');
      btnNietGoed.className = 'feedback-btn';
      btnNietGoed.textContent = '👎 Niet handig';

      // Als er al feedback is (uit historie), toon die
      if (bestaandeFeedback === 'goed') {
        btnGoed.classList.add('selected');
        btnGoed.disabled = true;
        btnNietGoed.disabled = true;
      } else if (bestaandeFeedback === 'niet_goed') {
        btnNietGoed.classList.add('selected');
        btnGoed.disabled = true;
        btnNietGoed.disabled = true;
      } else {
        // Klik handlers voor nieuwe feedback
        btnGoed.addEventListener('click', function () {
          geefFeedback(conversationId, 'goed', btnGoed, btnNietGoed);
        });
        btnNietGoed.addEventListener('click', function () {
          geefFeedback(conversationId, 'niet_goed', btnNietGoed, btnGoed);
        });
      }

      feedbackRow.appendChild(btnGoed);
      feedbackRow.appendChild(btnNietGoed);
      wrap.appendChild(feedbackRow);
    }

    // Tijdstempel
    var timeEl = document.createElement('div');
    timeEl.className = 'bubble-time';
    timeEl.textContent = tijd || formatTijd(new Date().toISOString());
    wrap.appendChild(timeEl);

    row.appendChild(avatar);
    row.appendChild(wrap);
    chatMessages.insertBefore(row, typingIndicator);
    scrollNaarBericht(row);
  }

  async function geefFeedback(conversationId, waarde, activeBtn, otherBtn) {
    activeBtn.classList.add('selected');
    activeBtn.disabled = true;
    otherBtn.disabled = true;

    await supabaseClient
      .from('conversations')
      .update({ feedback: waarde })
      .eq('id', conversationId);
  }

  // =============================================
  // TEKST FORMATTING
  // =============================================
  function formatAntwoord(tekst) {
    if (!tekst) return '';
    var escaped = tekst
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headings (### Titel of ## Titel)
    escaped = escaped.replace(/^#{2,3}\s+(.+)$/gm, '<h3>$1</h3>');

    // Bold **tekst** → oranje via CSS
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Bullet lists (regels die beginnen met - of •)
    escaped = escaped.replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>');
    // Groepeer opeenvolgende <li>'s in <ul>
    escaped = escaped.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Genummerde lists
    escaped = escaped.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragrafen (dubbele newlines)
    escaped = escaped.replace(/\n\n/g, '</p><p>');
    escaped = escaped.replace(/\n/g, '<br>');
    escaped = '<p>' + escaped + '</p>';

    // Opruimen
    escaped = escaped.replace(/<p><\/p>/g, '');
    escaped = escaped.replace(/<p>(<h3>)/g, '$1');
    escaped = escaped.replace(/(<\/h3>)<\/p>/g, '$1');
    escaped = escaped.replace(/<p>(<ul>)/g, '$1');
    escaped = escaped.replace(/(<\/ul>)<\/p>/g, '$1');

    // URLs klikbaar maken (http:// en https://)
    escaped = escaped.replace(
      /(https?:\/\/[^\s<>"')\]]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary);word-break:break-all">$1</a>'
    );

    return escaped;
  }

  // =============================================
  // TENANT INSTELLINGEN LADEN
  // =============================================
  async function laadTenantInstellingen() {
    var result = await supabaseClient
      .from('settings')
      .select('sleutel, waarde')
      .eq('tenant_id', profile.tenant_id);

    if (!result.data) return;

    var instellingen = {};
    result.data.forEach(function (s) { instellingen[s.sleutel] = s.waarde; });

    // Disclaimer
    if (instellingen.disclaimer) {
      disclaimerBanner.innerHTML =
        '<span class="disclaimer-icon">⚠️</span> ' +
        escapeHtml(instellingen.disclaimer);
    }

    // Organisatienaam in header
    if (instellingen.organisatienaam) {
      var headerTitle = document.querySelector('.header-title-group h1');
      if (headerTitle) {
        headerTitle.textContent = instellingen.organisatienaam;
      }
    }

    // Organisatielogo in header (vervangt standaard Wegwijzer logo)
    if (instellingen.logo_url) {
      var headerLogo = document.querySelector('.header-logo');
      if (headerLogo) {
        headerLogo.src = instellingen.logo_url;
        headerLogo.alt = instellingen.organisatienaam || 'Logo';
      }
    }

    // Primaire kleur
    if (instellingen.primaire_kleur && /^#[0-9A-Fa-f]{6}$/.test(instellingen.primaire_kleur)) {
      var kleur = instellingen.primaire_kleur;
      document.documentElement.style.setProperty('--primary', kleur);
      // Bereken donkere variant (20% donkerder)
      var r = parseInt(kleur.substring(1, 3), 16);
      var g = parseInt(kleur.substring(3, 5), 16);
      var b = parseInt(kleur.substring(5, 7), 16);
      var donker = '#' +
        Math.max(0, Math.round(r * 0.8)).toString(16).padStart(2, '0') +
        Math.max(0, Math.round(g * 0.8)).toString(16).padStart(2, '0') +
        Math.max(0, Math.round(b * 0.8)).toString(16).padStart(2, '0');
      document.documentElement.style.setProperty('--primary-dark', donker);
      // Light variant (40% lichter, met wit mengen)
      var licht = '#' +
        Math.min(255, Math.round(r + (255 - r) * 0.4)).toString(16).padStart(2, '0') +
        Math.min(255, Math.round(g + (255 - g) * 0.4)).toString(16).padStart(2, '0') +
        Math.min(255, Math.round(b + (255 - b) * 0.4)).toString(16).padStart(2, '0');
      document.documentElement.style.setProperty('--primary-light', licht);
      // Theme color meta tag
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', kleur);
    }
  }

  // =============================================
  // RATE LIMIT POPUP
  // =============================================
  function toonRateLimitPopup(token) {
    // Verwijder bestaande popup als die er is
    var bestaand = document.getElementById('rate-limit-modal');
    if (bestaand) bestaand.remove();

    var overlay = document.createElement('div');
    overlay.id = 'rate-limit-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:300;padding:16px';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:white;border-radius:12px;padding:24px;max-width:360px;width:100%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
    modal.innerHTML =
      '<h3 style="font-size:1.1rem;font-weight:700;margin-bottom:12px;color:var(--text)">Dagelijkse limiet bereikt</h3>' +
      '<p style="font-size:0.9rem;color:var(--text-light);margin-bottom:20px;line-height:1.5">Je hebt je dagelijkse 30 vragen gebruikt. Wil je vandaag nog 20 extra vragen gebruiken?</p>' +
      '<div style="display:flex;gap:8px">' +
        '<button id="rate-limit-nee" style="flex:1;padding:12px;border:2px solid var(--primary);background:white;color:var(--primary);border-radius:8px;font-weight:600;cursor:pointer;font-family:var(--font)">Nee, later</button>' +
        '<button id="rate-limit-ja" style="flex:1;padding:12px;border:none;background:var(--primary);color:white;border-radius:8px;font-weight:600;cursor:pointer;font-family:var(--font)">Ja, uitbreiden</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('rate-limit-ja').addEventListener('click', async function () {
      // Activeer uitbreiding via edge function
      await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ extend_limit: true })
      });
      overlay.remove();
      renderBotBericht('Je hebt 20 extra vragen geactiveerd voor vandaag. Stel gerust je volgende vraag!', null, null, null);
    });

    document.getElementById('rate-limit-nee').addEventListener('click', function () {
      overlay.remove();
      renderBotBericht('Geen probleem. Je kunt later alsnog uitbreiden als je meer vragen wilt stellen.', null, null, null);
    });
  }

  // =============================================
  // HULPFUNCTIES
  // =============================================
  function scrollNaarOnder() {
    setTimeout(function () {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 50);
  }

  function scrollNaarBericht(element) {
    setTimeout(function () {
      var container = chatMessages;
      var elTop = element.offsetTop - container.offsetTop;
      // Scroll zodat de bovenkant van het bericht net onder de zichtbare rand komt
      container.scrollTo({
        top: elTop - 8,
        behavior: 'smooth'
      });
    }, 80);
  }

  function formatTijd(isoString) {
    if (!isoString) return '';
    var d = new Date(isoString);
    var nu = new Date();
    var isVandaag = d.toDateString() === nu.toDateString();

    var tijd = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

    if (isVandaag) {
      return tijd;
    }
    var datum = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    return datum + ' ' + tijd;
  }

  function formatFunctiegroep(fg) {
    var map = {
      'ambulant_begeleider': 'Ambulant Begeleider',
      'ambulant_persoonlijk_begeleider': 'Ambulant Persoonlijk Begeleider',
      'woonbegeleider': 'Woonbegeleider',
      'persoonlijk_woonbegeleider': 'Persoonlijk Woonbegeleider'
    };
    return map[fg] || '';
  }

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function initLogout() {
    document.getElementById('logout-btn').addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      window.location.href = appUrl('index.html');
    });
  }
})();
