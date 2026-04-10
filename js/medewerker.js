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
  var conversatieHistorie = []; // {role: 'user'|'assistant', content: string}

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
  document.addEventListener('wegwijzer-auth-ready', async function (e) {
    user = e.detail.user;
    console.log('[Auth] user.id:', user.id, 'email:', user.email);
    console.log('[Auth] route-guard profiel naam:', e.detail.profile ? e.detail.profile.naam : '(geen)');
    // Haal altijd vers profiel op uit database
    try {
      var freshResult = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (freshResult.data) {
        profile = freshResult.data;
        console.log('[Profiel] Vers profiel geladen, naam:', profile.naam);
      } else {
        console.error('[Profiel] Verse query mislukt, uitloggen. Error:', freshResult.error ? freshResult.error.message : 'geen data', 'Status:', freshResult.status);
        await supabaseClient.auth.signOut();
        window.location.href = appUrl('index.html');
        return;
      }
    } catch (err) {
      console.error('[Profiel] Exception bij ophalen, uitloggen:', err.message || err);
      await supabaseClient.auth.signOut();
      window.location.href = appUrl('index.html');
      return;
    }
    // Inwerktraject alleen als expliciet aangevinkt (inwerktraject_actief === true)
    var heeftInwerktraject = profile.inwerktraject_actief === true && !profile.inwerken_afgerond;
    weekNummer = heeftInwerktraject ? berekenWeekNummer(profile.startdatum) : 99;
    // Toon dashboard knop voor teamleiders
    if (profile.role === 'teamleider') {
      var dashBtn = document.getElementById('dashboard-btn');
      if (dashBtn) dashBtn.classList.remove('hidden');
    }
    initWelkom();
    initChatInput();
    initChips();
    initLogout();
    initSearch();
    laadTenantInstellingen();
    // Nieuwe features
    if (weekNummer <= 6) {
      checkWeekstartBriefing();
      checkVertrouwenscheck();
      checkKennisquiz();
    }
    checkRolwissel();
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
      // Na inwerkperiode: kennisassistent modus
      if (meter) meter.style.display = 'none';
      if (labels) labels.style.display = 'none';
      if (weekBadge) weekBadge.style.display = 'none';
      if (subtitle) subtitle.textContent = 'Welkom terug. Wat kan ik voor je opzoeken?';
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
    backBtn.addEventListener('click', async function () {
      chatScreen.classList.remove('active');
      welcomeScreen.style.display = '';
      backBtn.classList.add('hidden');
      var searchBtn = document.getElementById('search-toggle-btn');
      if (searchBtn) searchBtn.classList.add('hidden');
      var searchBar = document.getElementById('search-bar');
      if (searchBar) searchBar.classList.remove('show');
      conversatieHistorie = [];
      // Ververs naam uit database
      var freshResult = await supabaseClient.from('profiles').select('naam').eq('user_id', user.id).single();
      if (freshResult.data && freshResult.data.naam) {
        profile.naam = freshResult.data.naam;
        var voornaam = profile.naam.split(' ')[0];
        document.getElementById('welcome-title').textContent = 'Welkom, ' + voornaam + '!';
      }
    });
  }

  // =============================================
  // CHAT OPENEN — met historie laden
  // =============================================
  async function openChat() {
    welcomeScreen.style.display = 'none';
    chatScreen.classList.add('active');
    backBtn.classList.remove('hidden');
    var searchBtn = document.getElementById('search-toggle-btn');
    if (searchBtn) searchBtn.classList.remove('hidden');

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
        { emoji: '📋', text: 'Protocollen opzoeken', vraag: 'Welke protocollen zijn er?' },
        { emoji: '📝', text: 'Rapportage schrijven', vraag: 'Ik wil een rapportage schrijven. Kun je me helpen?' },
        { emoji: '📅', text: 'Planning maken', vraag: 'Kun je een dagplanning voor me maken?' },
        { emoji: '✉️', text: 'Email opstellen', vraag: 'Kun je me helpen met het opstellen van een email?' },
        { emoji: '💭', text: 'Situatie doordenken', vraag: 'Ik wil een situatie met je doordenken.' }
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

      // Voeg vraag toe aan conversatiehistorie
      conversatieHistorie.push({ role: 'user', content: vraag });

      // Beperk historie tot laatste 20 berichten (10 vraag-antwoord paren)
      var historieVoorApi = conversatieHistorie.slice(-20);

      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          vraag: vraag,
          functiegroep: profile.functiegroep,
          weeknummer: weekNummer,
          messages: historieVoorApi
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
        // Voeg antwoord toe aan conversatiehistorie
        conversatieHistorie.push({ role: 'assistant', content: data.antwoord });
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
    avatar.textContent = '🧭';

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
    otherBtn.classList.remove('selected');

    var nu = new Date();
    await supabaseClient
      .from('conversations')
      .update({ feedback: waarde, feedback_op: nu.toISOString() })
      .eq('id', conversationId);

    // Toon wijzigbaar-tekst
    var feedbackRow = activeBtn.parentElement;
    var bestaandInfo = feedbackRow.querySelector('.feedback-info');
    if (bestaandInfo) bestaandInfo.remove();

    var info = document.createElement('div');
    info.className = 'feedback-info';
    info.style.cssText = 'font-size:0.65rem;color:var(--text-muted);margin-top:4px';
    var verloopt = new Date(nu.getTime() + 10 * 60 * 1000);
    info.textContent = 'Aanpasbaar tot ' + verloopt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    feedbackRow.appendChild(info);

    // Bij negatieve feedback: toon document aanvraag knop
    if (waarde === 'niet_goed') {
      // Zoek de vraag uit het gesprek
      var msgRow = feedbackRow.closest('.message-row');
      var prevRow = msgRow ? msgRow.previousElementSibling : null;
      var vraagTekst = prevRow ? (prevRow.querySelector('.chat-bubble') || {}).textContent || '' : '';
      if (vraagTekst) {
        addDocumentAanvraagKnop(vraagTekst, feedbackRow);
      }
    }

    // Na 10 minuten: definitief vergrendelen
    setTimeout(function () {
      activeBtn.disabled = true;
      otherBtn.disabled = true;
      info.textContent = 'Feedback definitief opgeslagen';
    }, 10 * 60 * 1000);
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

    // Paragrafen (dubbele newlines → sectie-scheiding, enkele newlines → spatie of niets)
    escaped = escaped.replace(/\n\n+/g, '</p><p>');
    // Enkele newlines na list items of headings: verwijderen (al afgehandeld door HTML tags)
    escaped = escaped.replace(/(<\/li>)\n/g, '$1');
    escaped = escaped.replace(/(<\/ul>)\n/g, '$1');
    escaped = escaped.replace(/(<\/h3>)\n/g, '$1');
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

    // Bronvermelding visueel scheiden (_Bron: ..._ of *Bron: ...*)
    escaped = escaped.replace(
      /<em>Bron:(.*?)<\/em>/g,
      '<div class="bron-vermelding">Bron:$1</div>'
    );
    // Fallback: als het niet als <em> gerenderd is maar als plain tekst
    escaped = escaped.replace(
      /(?:<p>|<br>)?\s*_Bron:\s*(.*?)_\s*(?:<\/p>)?$/,
      '<div class="bron-vermelding">Bron: $1</div>'
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
    console.log('[Wegwijzer] Alle opgehaalde settings:', Object.keys(instellingen).join(', '));

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

    // Organisatielogo in header
    console.log('[Wegwijzer] logo_url waarde:', JSON.stringify(instellingen.logo_url));
    var logoContainer = document.getElementById('header-logo-container');
    console.log('[Wegwijzer] logo container element:', logoContainer ? 'gevonden' : 'NIET gevonden');
    if (logoContainer) {
      if (instellingen.logo_url) {
        var imgHtml = '<img src="' + instellingen.logo_url + '" alt="' + escapeHtml(instellingen.organisatienaam || 'Logo') + '" style="max-height:40px;width:auto;object-fit:contain;border-radius:6px" onerror="console.error(\'[Wegwijzer] Logo laden mislukt:\', this.src)">';
        logoContainer.innerHTML = imgHtml;
        console.log('[Wegwijzer] Logo img toegevoegd aan header');
      } else {
        console.log('[Wegwijzer] Geen logo_url — check of RLS policy logo_url toestaat');
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
  // ZOEKFUNCTIE IN GESPREKKEN
  // =============================================
  function initSearch() {
    var toggleBtn = document.getElementById('search-toggle-btn');
    var searchBar = document.getElementById('search-bar');
    var searchInput = document.getElementById('search-input');

    if (!toggleBtn || !searchBar || !searchInput) return;

    toggleBtn.addEventListener('click', function () {
      searchBar.classList.toggle('show');
      if (searchBar.classList.contains('show')) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        clearSearchHighlights();
      }
    });

    searchInput.addEventListener('input', function () {
      var query = searchInput.value.trim().toLowerCase();
      clearSearchHighlights();

      if (query.length < 2) return;

      // Zoek in alle chat bubbles
      var bubbles = chatMessages.querySelectorAll('.chat-bubble');
      bubbles.forEach(function (bubble) {
        var text = bubble.textContent || '';
        if (text.toLowerCase().includes(query)) {
          // Markeer de bubble
          bubble.closest('.message-row').style.background = 'rgba(232, 114, 12, 0.06)';
          bubble.closest('.message-row').style.borderRadius = '8px';
          bubble.closest('.message-row').classList.add('search-match');
        }
      });

      // Scroll naar eerste match
      var firstMatch = chatMessages.querySelector('.search-match');
      if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function clearSearchHighlights() {
    var matches = chatMessages.querySelectorAll('.search-match');
    matches.forEach(function (el) {
      el.style.background = '';
      el.style.borderRadius = '';
      el.classList.remove('search-match');
    });
  }

  // =============================================
  // =============================================
  // WEEKSTART BRIEFING
  // =============================================
  async function checkWeekstartBriefing() {
    // Zichtbaar hele week (ma 00:00 - zo 23:59)
    var briefingKey = 'wegwijzer_briefing_week_' + weekNummer;
    if (localStorage.getItem(briefingKey)) return; // Al gezien deze week

    try {
      var session = await supabaseClient.auth.getSession();
      var token = session.data.session.access_token;

      var resp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ generate_briefing: true, week_nummer: weekNummer })
      });
      var data = await resp.json();

      if (data.briefing) {
        var container = document.getElementById('weekstart-briefing');
        var header = document.getElementById('briefing-header');
        var tekst = document.getElementById('briefing-tekst');
        var sluitBtn = document.getElementById('briefing-sluit');

        if (container && header && tekst) {
          header.textContent = 'Week ' + weekNummer + ' van 6';
          tekst.textContent = data.briefing;
          container.style.display = '';

          sluitBtn.addEventListener('click', function () {
            container.style.display = 'none';
            localStorage.setItem(briefingKey, 'true');
            supabaseClient.from('weekstart_briefings')
              .update({ gelezen: true })
              .eq('user_id', user.id)
              .eq('week_nummer', weekNummer);
          });
        }
      }
    } catch (err) {
      console.error('[Briefing] Fout:', err);
    }
  }

  // =============================================
  // VERTROUWENSCHECK (nieuw model: delen ja/nee)
  // =============================================
  async function checkVertrouwenscheck() {
    // Check of al ingevuld deze week (via DB)
    var bestaand = await supabaseClient
      .from('vertrouwens_scores')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_nummer', weekNummer)
      .limit(1);

    if (bestaand.data && bestaand.data.length > 0) return;

    // Zichtbaar van vrijdag t/m donderdag (7 dagen venster)
    // Bepaal of we in het juiste venster zitten
    var dag = new Date().getDay(); // 0=zo,1=ma..6=za
    if (dag < 5 && dag > 0) return; // Ma-do: niet tonen (alleen vr,za,zo)
    // Aanvullende check via localStorage
    var vcKey = 'wegwijzer_vc_week_' + weekNummer;
    if (localStorage.getItem(vcKey)) return;

    var modal = document.getElementById('vertrouwenscheck-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    var gekozenScore = 0;
    var sterren = document.querySelectorAll('#vc-sterren span');
    var opslaanBtn = document.getElementById('vc-opslaan');
    var gekozenEl = document.getElementById('vc-gekozen');

    sterren.forEach(function (s) {
      s.addEventListener('click', function () {
        gekozenScore = parseInt(s.getAttribute('data-score'));
        sterren.forEach(function (st, idx) {
          st.style.opacity = idx < gekozenScore ? '1' : '0.3';
        });
        gekozenEl.textContent = gekozenScore + ' van 5';
        opslaanBtn.disabled = false;
      });
    });

    opslaanBtn.addEventListener('click', async function () {
      if (gekozenScore >= 4) {
        // Score 4-5: opslaan, niet delen, positief bericht
        await supabaseClient.from('vertrouwens_scores').insert({
          user_id: user.id, week_nummer: weekNummer, score: gekozenScore,
          signaal_verstuurd: false, tenant_id: profile.tenant_id
        });
        localStorage.setItem(vcKey, 'true');
        modal.querySelector('div > div').innerHTML =
          '<h3 style="margin-bottom:12px">Fijn om te horen! 🌟</h3>' +
          '<p style="font-size:0.9rem">Succes de komende week.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px" onclick="this.closest(\'[id=vertrouwenscheck-modal]\').style.display=\'none\'">Sluiten</button>';
      } else {
        // Score 1-3: vraag of medewerker wil delen
        await supabaseClient.from('vertrouwens_scores').insert({
          user_id: user.id, week_nummer: weekNummer, score: gekozenScore,
          signaal_verstuurd: false, tenant_id: profile.tenant_id
        });

        opslaanBtn.style.display = 'none';
        gekozenEl.style.display = 'none';
        document.getElementById('vc-sterren').style.display = 'none';
        var vervolg = document.getElementById('vc-vervolg');
        var vervolgTekst = document.getElementById('vc-vervolg-tekst');
        if (vervolgTekst) vervolgTekst.textContent = 'Wil je je score delen met je leidinggevende?';
        if (vervolg) vervolg.style.display = '';

        document.getElementById('vc-signaal').addEventListener('click', async function () {
          await supabaseClient.from('vertrouwens_scores')
            .update({ signaal_verstuurd: true })
            .eq('user_id', user.id)
            .eq('week_nummer', weekNummer);
          localStorage.setItem(vcKey, 'true');
          modal.style.display = 'none';
          alert('Je score is gedeeld met je leidinggevende.');
        });

        document.getElementById('vc-zelf').addEventListener('click', function () {
          localStorage.setItem(vcKey, 'true');
          modal.querySelector('div > div').innerHTML =
            '<h3 style="margin-bottom:12px">Oké, geen probleem 👍</h3>' +
            '<p style="font-size:0.9rem">Je score is alleen voor jou.</p>' +
            '<button class="btn btn-primary" style="margin-top:16px" onclick="this.closest(\'[id=vertrouwenscheck-modal]\').style.display=\'none\'">Sluiten</button>';
        });
      }
    });
  }

  // =============================================
  // KENNISQUIZ (week 2-5)
  // =============================================
  async function checkKennisquiz() {
    if (weekNummer < 2 || weekNummer > 5) return;

    // Check of al gedaan of overgeslagen
    var quizKey = 'wegwijzer_quiz_week_' + weekNummer;
    if (localStorage.getItem(quizKey)) return;

    var bestaand = await supabaseClient
      .from('quiz_resultaten')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_nummer', weekNummer)
      .limit(1);
    if (bestaand.data && bestaand.data.length > 0) { localStorage.setItem(quizKey, 'true'); return; }

    // Zichtbaar wo t/m di (7 dagen venster)
    var dag = new Date().getDay();
    if (dag >= 1 && dag <= 2) { /* ma-di: laatste dagen, OK */ }
    else if (dag >= 3) { /* wo-za: eerste dagen, OK */ }
    else { /* zo: OK */ }

    // Toon quiz kaartje boven chat
    var quizCard = document.createElement('div');
    quizCard.id = 'quiz-card';
    quizCard.style.cssText = 'background:#E3F2FD;border-bottom:1px solid #90CAF9;padding:12px 16px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center';

    var niveaus = { 2: '🟢 Basis', 3: '🟡 Gemiddeld', 4: '🟠 Gevorderd', 5: '🔴 Integratie' };
    quizCard.innerHTML =
      '<div><span style="font-size:1rem">📝</span> <strong style="font-size:0.85rem">Kennischeck week ' + weekNummer + '</strong> <span style="font-size:0.75rem;color:var(--text-muted)">' + (niveaus[weekNummer] || '') + ' · 3 vragen · 2 min</span></div>' +
      '<div style="display:flex;gap:8px"><button id="quiz-start" class="btn btn-primary" style="width:auto;padding:6px 14px;font-size:0.8rem">Quiz starten</button><button id="quiz-skip" style="background:none;border:1px solid var(--border);border-radius:6px;padding:6px 14px;font-size:0.8rem;cursor:pointer;font-family:var(--font);color:var(--text-muted)">Overslaan</button></div>';

    var chatScreen = document.getElementById('chat-screen');
    var disclaimer = document.getElementById('disclaimer-banner');
    if (chatScreen && disclaimer) {
      chatScreen.insertBefore(quizCard, disclaimer);
    }

    document.getElementById('quiz-skip').addEventListener('click', function () {
      quizCard.remove();
      localStorage.setItem(quizKey, 'true');
    });

    document.getElementById('quiz-start').addEventListener('click', async function () {
      quizCard.innerHTML = '<div style="width:100%;text-align:center;padding:8px"><span style="font-size:0.85rem">Vragen genereren...</span></div>';

      try {
        var session = await supabaseClient.auth.getSession();
        var token = session.data.session.access_token;

        var niveauTekst = { 2: 'Herkenningsvragen met 3 antwoordopties', 3: 'Situatievragen — wat doe jij?', 4: 'Toepassingsvragen over procedures', 5: 'Combinatievragen over meerdere onderwerpen' };

        var quizResp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            vraag: 'Genereer 3 quizvragen voor een nieuwe zorgmedewerker in inwerkweek ' + weekNummer + '. Moeilijkheidsgraad: ' + (niveauTekst[weekNummer] || 'gemiddeld') + '. Geef per vraag 3 antwoordopties waarvan 1 correct. Formaat: JSON array [{vraag, opties: [string], correct_antwoord: string, uitleg: string}]. Alleen de JSON, geen tekst eromheen.',
            functiegroep: profile.functiegroep,
            weeknummer: weekNummer
          })
        });

        var quizData = await quizResp.json();
        var antwoordTekst = quizData.antwoord || '';

        // Parse JSON uit antwoord
        var jsonMatch = antwoordTekst.match(/\[[\s\S]*\]/);
        if (!jsonMatch) { quizCard.innerHTML = '<p style="padding:8px;font-size:0.85rem">Quiz kon niet geladen worden.</p>'; return; }

        var vragen = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(vragen) || vragen.length === 0) { quizCard.innerHTML = '<p style="padding:8px;font-size:0.85rem">Geen vragen ontvangen.</p>'; return; }

        var huidigeVraag = 0;
        var correcteAntwoorden = 0;

        function toonVraag() {
          var v = vragen[huidigeVraag];
          quizCard.innerHTML =
            '<div style="width:100%;padding:4px 0">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong style="font-size:0.85rem">Vraag ' + (huidigeVraag + 1) + '/3</strong><div style="background:var(--border);height:4px;flex:1;margin:0 12px;border-radius:2px"><div style="background:var(--primary);height:100%;border-radius:2px;width:' + ((huidigeVraag) / 3 * 100) + '%"></div></div></div>' +
            '<p style="font-size:0.85rem;margin-bottom:10px">' + escapeHtml(v.vraag) + '</p>' +
            '<div style="display:flex;flex-direction:column;gap:6px">' +
            v.opties.map(function (o) {
              return '<button class="quiz-optie" data-antwoord="' + escapeHtml(o) + '" style="text-align:left;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:white;cursor:pointer;font-size:0.82rem;font-family:var(--font)">' + escapeHtml(o) + '</button>';
            }).join('') +
            '</div></div>';

          quizCard.querySelectorAll('.quiz-optie').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var gekozen = btn.getAttribute('data-antwoord');
              var correct = gekozen === v.correct_antwoord;
              if (correct) correcteAntwoorden++;

              // Disable alle knoppen en toon feedback
              quizCard.querySelectorAll('.quiz-optie').forEach(function (b) {
                b.disabled = true;
                b.style.cursor = 'default';
                if (b.getAttribute('data-antwoord') === v.correct_antwoord) {
                  b.style.border = '2px solid var(--success)';
                  b.style.background = '#F0FFF4';
                }
                if (b === btn && !correct) {
                  b.style.border = '2px solid var(--error)';
                  b.style.background = '#FFF0F0';
                }
              });

              var feedbackEl = document.createElement('p');
              feedbackEl.style.cssText = 'font-size:0.8rem;margin-top:8px;padding:8px;border-radius:6px;' + (correct ? 'background:#F0FFF4;color:var(--success)' : 'background:#FFF0F0;color:var(--error)');
              feedbackEl.textContent = correct ? '✅ Goed! ' + (v.uitleg || '') : '❌ ' + (v.uitleg || 'Het correcte antwoord was: ' + v.correct_antwoord);
              quizCard.querySelector('div').appendChild(feedbackEl);

              var volgendeBtn = document.createElement('button');
              volgendeBtn.className = 'btn btn-primary';
              volgendeBtn.style.cssText = 'width:auto;padding:6px 14px;font-size:0.8rem;margin-top:8px';
              volgendeBtn.textContent = huidigeVraag < 2 ? 'Volgende vraag →' : 'Resultaat bekijken';
              quizCard.querySelector('div').appendChild(volgendeBtn);

              volgendeBtn.addEventListener('click', function () {
                huidigeVraag++;
                if (huidigeVraag < 3) { toonVraag(); } else { toonResultaat(); }
              });
            });
          });
        }

        function toonResultaat() {
          quizCard.innerHTML =
            '<div style="width:100%;text-align:center;padding:8px 0">' +
            '<h3 style="font-size:1rem;margin-bottom:8px">' + correcteAntwoorden + ' van 3 goed!</h3>' +
            '<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px">Wil je je resultaat delen met je leidinggevende?</p>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
            '<button id="quiz-deel" class="btn btn-primary" style="width:auto;padding:8px 16px;font-size:0.85rem">Ja, deel mijn score</button>' +
            '<button id="quiz-niet-delen" class="btn btn-secondary" style="width:auto;padding:8px 16px;font-size:0.85rem">Nee, voor mezelf</button>' +
            '</div></div>';

          document.getElementById('quiz-deel').addEventListener('click', async function () {
            await supabaseClient.from('quiz_resultaten').insert({
              user_id: user.id, tenant_id: profile.tenant_id,
              week_nummer: weekNummer, score: correcteAntwoorden, gedeeld: true
            });
            localStorage.setItem(quizKey, 'true');
            quizCard.innerHTML = '<p style="padding:12px;font-size:0.85rem;text-align:center">✅ Score gedeeld. Goed gedaan!</p>';
            setTimeout(function () { quizCard.remove(); }, 2000);
          });

          document.getElementById('quiz-niet-delen').addEventListener('click', async function () {
            await supabaseClient.from('quiz_resultaten').insert({
              user_id: user.id, tenant_id: profile.tenant_id,
              week_nummer: weekNummer, score: correcteAntwoorden, gedeeld: false
            });
            localStorage.setItem(quizKey, 'true');
            quizCard.innerHTML = '<p style="padding:12px;font-size:0.85rem;text-align:center">👍 Score opgeslagen voor jezelf.</p>';
            setTimeout(function () { quizCard.remove(); }, 2000);
          });
        }

        toonVraag();
      } catch (err) {
        console.error('[Quiz] Fout:', err);
        quizCard.innerHTML = '<p style="padding:8px;font-size:0.85rem">Quiz kon niet geladen worden.</p>';
      }
    });
  }

  // =============================================
  // ROL-WISSEL CHECK
  // =============================================
  async function checkRolwissel() {
    if (!profile.vorige_functiegroep || profile.rolwissel_gezien !== false) return;

    var modal = document.getElementById('rolwissel-modal');
    if (!modal) return;

    var titel = document.getElementById('rw-titel');
    var inhoud = document.getElementById('rw-inhoud');
    var begrepBtn = document.getElementById('rw-begrepen');

    titel.textContent = 'Je hebt een nieuwe rol: ' + (profile.functiegroep || '').replace(/_/g, ' ') + ' 🎉';
    inhoud.textContent = 'Vergelijking laden...';
    modal.style.display = 'flex';

    try {
      var session3 = await supabaseClient.auth.getSession();
      var rwResp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session3.data.session.access_token },
        body: JSON.stringify({
          generate_rolwissel: true,
          oude_functie: profile.vorige_functiegroep,
          nieuwe_functie: profile.functiegroep
        })
      });
      var rwData = await rwResp.json();
      inhoud.innerHTML = '<p style="margin-bottom:8px"><strong>Verschillen met je vorige rol:</strong></p>' + (rwData.vergelijking || '').replace(/\n/g, '<br>');
    } catch (e) {
      inhoud.textContent = 'Kon vergelijking niet laden.';
    }

    begrepBtn.addEventListener('click', async function () {
      await supabaseClient.from('profiles').update({ rolwissel_gezien: true }).eq('user_id', user.id);
      modal.style.display = 'none';
    });
  }

  // =============================================
  // DOCUMENT AANVRAAG KNOP (bij duim omlaag)
  // =============================================
  function addDocumentAanvraagKnop(vraagTekst, container) {
    var btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:12px;padding:3px 10px;font-size:0.7rem;cursor:pointer;color:var(--text-muted);margin-top:4px;font-family:var(--font)';
    btn.textContent = '📄 Vraag document aan over dit onderwerp';
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Aanvraag versturen...';
      try {
        var session4 = await supabaseClient.auth.getSession();
        await fetch(SUPABASE_URL + '/functions/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session4.data.session.access_token },
          body: JSON.stringify({ generate_document_concept: true, vraag_tekst: vraagTekst })
        });
        btn.textContent = '✓ Aanvraag ontvangen';
        btn.style.color = 'var(--success)';
      } catch (e) {
        btn.textContent = 'Aanvraag mislukt';
        btn.style.color = 'var(--error)';
      }
    });
    container.appendChild(btn);
  }

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
      'persoonlijk_woonbegeleider': 'Persoonlijk Woonbegeleider',
      'medewerker_avond_nachtdienst': 'Medewerker Avond-/Nachtdienst',
      'kantoorpersoneel': 'Kantoorpersoneel',
      'stagiaire': 'Stagiaire',
      'zzp_uitzendkracht': 'ZZP / Uitzendkracht'
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

  // =============================================
  // PRIVACY VERZOEK
  // =============================================
  (function initPrivacy() {
    var btn = document.getElementById('privacy-btn');
    var modal = document.getElementById('modal-privacy');
    var form = document.getElementById('privacy-form');
    var cancelBtn = document.getElementById('privacy-cancel');

    if (!btn || !modal) return;

    btn.addEventListener('click', function () {
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.right = '0';
      modal.style.bottom = '0';
      modal.style.background = 'rgba(0,0,0,0.5)';
      modal.style.zIndex = '300';
      // Pre-fill name and email
      if (profile) {
        document.getElementById('privacy-naam').value = profile.naam || '';
      }
      if (user) {
        document.getElementById('privacy-email').value = user.email || '';
      }
    });

    cancelBtn.addEventListener('click', function () {
      modal.style.display = 'none';
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var alertBox = document.getElementById('privacy-alert');
      var alertMsg = document.getElementById('privacy-alert-msg');

      var naam = document.getElementById('privacy-naam').value.trim();
      var email = document.getElementById('privacy-email').value.trim();
      var type = document.getElementById('privacy-type').value;

      if (!naam || !email) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Vul alle velden in.';
        return;
      }

      var result = await supabaseClient.from('privacy_verzoeken').insert({
        tenant_id: profile.tenant_id,
        naam: naam,
        email: email,
        type: type
      });

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Versturen mislukt. Probeer het opnieuw.';
      } else {
        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Je verzoek is ontvangen. We behandelen het binnen 30 dagen.';
        setTimeout(function () { modal.style.display = 'none'; }, 3000);
      }
    });
  })();

  // ---- App feedback ----
  (function initAppFeedback() {
    var btn = document.getElementById('app-feedback-btn');
    var modal = document.getElementById('modal-app-feedback');
    var form = document.getElementById('app-feedback-form');
    var cancelBtn = document.getElementById('afb-cancel');
    var bericht = document.getElementById('afb-bericht');
    var teller = document.getElementById('afb-teller');
    var successMsg = document.getElementById('afb-success');
    var submitBtn = document.getElementById('afb-submit');

    if (!btn || !modal) return;

    function openModal() {
      modal.classList.add('show');
      successMsg.style.display = 'none';
      form.style.display = '';
      form.reset();
      teller.textContent = '0';
      submitBtn.disabled = false;
    }
    function closeModal() {
      modal.classList.remove('show');
    }

    btn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    bericht.addEventListener('input', function () {
      teller.textContent = bericht.value.length;
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var categorieEl = document.querySelector('input[name="afb-categorie"]:checked');
      var tekst = bericht.value.trim();
      if (!categorieEl || !tekst) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Versturen...';

      var result = await supabaseClient.from('app_feedback').insert({
        tenant_id: profile.tenant_id,
        medewerker_id: profile.id,
        functiegroep: profile.functiegroep || null,
        categorie: categorieEl.value,
        bericht: tekst
      });

      submitBtn.textContent = 'Versturen';

      if (result.error) {
        alert('Versturen mislukt: ' + result.error.message);
        submitBtn.disabled = false;
        return;
      }

      form.style.display = 'none';
      successMsg.style.display = 'block';
      setTimeout(closeModal, 2000);
    });
  })();
})();
