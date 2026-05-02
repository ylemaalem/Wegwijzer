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

  // ---- Sparring modus state ----
  var sparringModus = false;
  var sparringStap = 0;
  var sparringContext = [];
  var SPARRING_VRAGEN = [
    'Om je goed te kunnen helpen, wil ik eerst de situatie beter begrijpen. Vertel me: om welke cliënt gaat het (geen naam nodig) en wat is er aan de hand?',
    'Wat heb je al geprobeerd of gedaan in deze situatie?',
    'Wat is voor jou het moeilijkste aan deze situatie — de cliënt, de samenwerking, of iets anders?'
  ];

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
    // Toon dashboard knop voor teamleiders en admins
    if (profile.role === 'teamleider' || profile.role === 'admin') {
      var dashBtn = document.getElementById('dashboard-btn');
      if (dashBtn) {
        dashBtn.classList.remove('hidden');
        dashBtn.href = profile.role === 'admin' ? appUrl('admin.html') : appUrl('teamleider.html');
      }
    }
    initWelkom();
    initChatInput();
    initChips();
    initLogout();
    initSearch();
    laadTenantInstellingen();
    initVcToggle();
    // Briefing en quiz alleen tijdens inwerktraject (week 1-6).
    // weekNummer 0 = startdatum ligt nog in de toekomst → geen briefing/quiz.
    if (heeftInwerktraject && weekNummer >= 1) {
      checkWeekstartBriefing();
      checkKennisquiz();
    }
    // Vertrouwenscheck loopt OOK door na week 6 / na afronding inwerktraject —
    // gate zit nu op profile.vertrouwenscheck_actief en de startdatum.
    // Alleen skip als startdatum nog in toekomst ligt.
    if (profile.startdatum && weekNummer !== 0) {
      checkVertrouwenscheck();
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

    // Startdatum ligt in de toekomst → speciale waarde 0
    // (caller toont een banner met de startdatum en skipt briefing/quiz/vertrouwenscheck)
    if (nu < start) return 0;

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

  // Geeft de maandag 00:00 van inwerkweek N (1-based) terug op basis van startdatum
  function maandagInwerkweek(startdatum, weekN) {
    if (!startdatum) return null;
    var start = new Date(startdatum);
    var startDag = start.getDay();
    var offsetNaarMaandag = startDag === 0 ? -6 : 1 - startDag;
    var maandagWeek1 = new Date(start);
    maandagWeek1.setDate(start.getDate() + offsetNaarMaandag);
    maandagWeek1.setHours(0, 0, 0, 0);
    var maandag = new Date(maandagWeek1);
    maandag.setDate(maandagWeek1.getDate() + (weekN - 1) * 7);
    return maandag;
  }

  // Welke inwerkweek heeft op dit moment een actief BRIEFING-venster?
  // Briefing week N: ma 00:00 t/m zo 23:59 van inwerkweek N (1..6).
  function actieveBriefingWeek(startdatum) {
    if (!startdatum) return null;
    var nu = new Date();
    for (var n = 1; n <= 6; n++) {
      var ma = maandagInwerkweek(startdatum, n);
      if (!ma) return null;
      var maVolgende = new Date(ma);
      maVolgende.setDate(ma.getDate() + 7); // ma 00:00 van week N+1
      if (nu >= ma && nu < maVolgende) return n;
    }
    return null;
  }

  // Welke (inwerk)week heeft op dit moment een actief VERTROUWENSCHECK-venster?
  // Venster: vr 00:00 van week N t/m do 23:59 van week N+1.
  // Loopt door OOK na week 6 — de check blijft wekelijks beschikbaar tenzij
  // de medewerker hem expliciet uitschakelt via profile.vertrouwenscheck_actief.
  function actieveVertrouwenscheckWeek(startdatum) {
    if (!startdatum) return null;
    var nu = new Date();
    var ma1 = maandagInwerkweek(startdatum, 1);
    if (!ma1) return null;
    // Bereken huidige inwerkweek-nummer rechtstreeks i.p.v. te loopen
    var msPerWeek = 7 * 24 * 60 * 60 * 1000;
    var weekIndex = Math.floor((nu.getTime() - ma1.getTime()) / msPerWeek); // 0-based
    // Het venster van week N start vrijdag = ma1 + (N-1)*7 + 4 dagen
    // Check eerst de voorlopende week (medewerker is na vrijdag van week N maar voor vrijdag week N+1)
    for (var delta = 0; delta <= 1; delta++) {
      var n = weekIndex + 1 - delta; // huidige week of vorige
      if (n < 1) continue;
      var ma = new Date(ma1);
      ma.setDate(ma1.getDate() + (n - 1) * 7);
      var vrijdag = new Date(ma);
      vrijdag.setDate(ma.getDate() + 4);
      var einde = new Date(vrijdag);
      einde.setDate(vrijdag.getDate() + 7);
      if (nu >= vrijdag && nu < einde) return n;
    }
    return null;
  }

  // Welke inwerkweek heeft op dit moment een actief KENNISQUIZ-venster?
  // Quiz week N (alleen 2..5): wo 00:00 van inwerkweek N t/m di 23:59 van inwerkweek N+1.
  function actieveQuizWeek(startdatum) {
    if (!startdatum) return null;
    var nu = new Date();
    for (var n = 2; n <= 5; n++) {
      var ma = maandagInwerkweek(startdatum, n);
      if (!ma) return null;
      var woensdag = new Date(ma);
      woensdag.setDate(ma.getDate() + 2); // wo 00:00 van week N
      var einde = new Date(woensdag);
      einde.setDate(woensdag.getDate() + 7); // wo 00:00 van week N+1 = direct na di 23:59
      if (nu >= woensdag && nu < einde) return n;
    }
    return null;
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

    if (weekNummer === 0) {
      // Inwerktraject start nog in de toekomst — toon datum, verberg progress
      if (meter) meter.style.display = 'none';
      if (labels) labels.style.display = 'none';
      if (weekBadge) weekBadge.style.display = 'none';
      if (subtitle) {
        var startDatum = new Date(profile.startdatum);
        var startDatumNL = startDatum.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
        subtitle.textContent = 'Jouw inwerktraject start op ' + startDatumNL + '. Tot die tijd kun je al vragen stellen.';
      }
    } else if (weekNummer > 6) {
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

    if (weekNummer === 0) {
      var startDatum = new Date(profile.startdatum);
      var startDatumNL = startDatum.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
      tekst = 'Hallo' + (naam ? ' ' + naam : '') + '! ' +
        'Jouw inwerktraject start op ' + startDatumNL + '. Tot die tijd kun je me al vragen stellen over protocollen, werkwijze of de organisatie.';
    } else if (weekNummer > 6) {
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
  // SUGGESTIE CHIPS — dynamisch op basis van rol, weeknummer en functiegroep
  // =============================================

  // Pak max 2 woorden uit de functiegroep voor gebruik in een chip-zin,
  // bv. "ambulant_begeleider" → "ambulant begeleider".
  function functiegroepKort() {
    var fg = profile && profile.functiegroep ? profile.functiegroep : '';
    if (!fg) return 'jouw functie';
    var woorden = fg.replace(/_/g, ' ').split(/\s+/).filter(Boolean);
    return woorden.slice(0, 2).join(' ').toLowerCase() || 'jouw functie';
  }

  function chipsVoorContext() {
    // Teamleider/admin: vaste set
    if (profile.role === 'teamleider' || profile.role === 'admin') {
      return [
        { emoji: '📊', vraag: 'Geef me een overzicht van mijn team' },
        { emoji: '📝', vraag: 'Help me een brief opstellen' },
        { emoji: '💬', vraag: 'Sparren over een medewerkerssituatie' },
        { emoji: '📋', vraag: 'Maak een vergaderagenda' }
      ];
    }

    var fgKort = functiegroepKort();

    // Week 1-2 (nieuw)
    if (weekNummer >= 1 && weekNummer <= 2) {
      return [
        { emoji: '📋', vraag: 'Wat zijn mijn taken in week ' + weekNummer + '?' },
        { emoji: '🚗', vraag: 'Wat is ' + fgKort + ' werken?' },
        { emoji: '👤', vraag: 'Bij wie kan ik terecht?' },
        { emoji: '🎯', vraag: 'Wat is de missie van de organisatie?' },
        { emoji: '🤝', vraag: 'Hoe ga ik om met een cliënt?' }
      ];
    }

    // Week 3-4 (halverwege)
    if (weekNummer >= 3 && weekNummer <= 4) {
      return [
        { emoji: '📋', vraag: 'Wat zijn mijn taken in week ' + weekNummer + '?' },
        { emoji: '📝', vraag: 'Help me een rapportage schrijven' },
        { emoji: '❓', vraag: 'Leg zorgplan, indicatie en WMO uit' },
        { emoji: '👤', vraag: 'Wie is mijn leidinggevende?' },
        { emoji: '🤝', vraag: 'Sparren over een cliëntsituatie', action: 'sparring' }
      ];
    }

    // Week 5-6 (afronden)
    if (weekNummer >= 5 && weekNummer <= 6) {
      return [
        { emoji: '📋', vraag: 'Wat zijn mijn taken in week ' + weekNummer + '?' },
        { emoji: '📝', vraag: 'Help me een rapportage schrijven' },
        { emoji: '💬', vraag: 'Sparren over een cliëntsituatie', action: 'sparring' },
        { emoji: '📋', vraag: 'Maak een checklist voor mijn bezoek' },
        { emoji: '🎯', vraag: 'Wat verwacht de organisatie van mij?' }
      ];
    }

    // Na week 6, weekNummer 99 (inwerken_afgerond), of weekNummer 0
    // (toekomstige startdatum) — kennisassistent modus
    return [
      { emoji: '📝', vraag: 'Help me een rapportage schrijven' },
      { emoji: '💬', vraag: 'Sparren over een cliëntsituatie', action: 'sparring' },
      { emoji: '📋', vraag: 'Maak een checklist voor mijn bezoek' },
      { emoji: '📎', vraag: 'Zoek een protocol op' },
      { emoji: '💶', vraag: 'Hoe declareer ik reiskosten?' }
    ];
  }

  function initChips() {
    chipsBar.innerHTML = '';

    // ---- Permanente 🧠 chip — altijd eerste, ongeacht week of inwerkstatus ----
    var sparringBtn = document.createElement('button');
    sparringBtn.className = 'chip chip--sparring';
    sparringBtn.dataset.action = 'sparring';
    sparringBtn.textContent = '🧠 Sparringsmodus';
    chipsBar.appendChild(sparringBtn);

    // ---- Context chips — sla ingebouwde sparring chips over (permanente chip vervangt ze) ----
    var setjes = chipsVoorContext();
    setjes.forEach(function (c) {
      if (c.action === 'sparring') return; // al aanwezig als permanente chip
      var btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.vraag = c.vraag;
      if (c.action) btn.dataset.action = c.action;
      btn.textContent = c.emoji + ' ' + c.vraag;
      chipsBar.appendChild(btn);
    });

    // ---- Klik-handlers ----
    chipsBar.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (isSending) return;
        if (chip.dataset.action === 'sparring') {
          startSparring();
          return;
        }
        var vraag = chip.dataset.vraag;
        if (vraag) {
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
  // SPARRING MODUS — 3-staps dialoog client-side, advies via 1 edge call
  // =============================================
  function startSparring() {
    // Als we midden in een gesprek zitten: voeg een visuele scheiding toe
    var heeftBestaandeberichten = chatMessages && chatMessages.children.length > 0;
    if (heeftBestaandeberichten) {
      var separator = document.createElement('div');
      separator.style.cssText = 'text-align:center;font-size:0.75rem;color:var(--text-muted,#888);padding:8px 0 4px;border-top:1px dashed var(--border,#e0e0e0);margin:8px 0';
      separator.textContent = '— Nieuw sparringgesprek —';
      chatMessages.appendChild(separator);
    }

    // Reset sparring state (ook als eerder een sparring actief was)
    sparringModus = true;
    sparringStap = 1;
    sparringContext = [];
    conversatieHistorie = []; // context wissen zodat sparring schoon start

    renderGebruikersBericht('🧠 Sparringsmodus starten', null);
    toonSparringBadge();
    renderBotBericht(
      'Ik ben er. Vertel — wat speelt er? Ik stel je een paar gerichte vragen zodat we samen tot een goed antwoord komen.\n\n' + SPARRING_VRAGEN[0],
      null, null, null
    );
    chatInput.focus();
    scrollNaarOnder();
  }

  function toonSparringBadge() {
    var bestaand = document.getElementById('sparring-badge');
    if (bestaand) return;
    var badge = document.createElement('div');
    badge.id = 'sparring-badge';
    badge.style.cssText = 'background:#EEF2F4;color:#0D5C6B;font-size:0.78rem;font-weight:600;padding:6px 16px;border-bottom:1px solid var(--border);text-align:center;flex-shrink:0';
    badge.textContent = '💭 Sparring modus actief';
    var chatScreen = document.getElementById('chat-screen');
    var chatMessages = document.getElementById('chat-messages');
    if (chatScreen && chatMessages) chatScreen.insertBefore(badge, chatMessages);
  }
  function verbergSparringBadge() {
    var badge = document.getElementById('sparring-badge');
    if (badge) badge.remove();
  }

  function bouwSparringSamenvatting(ctx) {
    return 'Sparring over cliëntsituatie:\n' +
      '1. Situatie: ' + (ctx[0] || '') + '\n' +
      '2. Wat al geprobeerd: ' + (ctx[1] || '') + '\n' +
      '3. Moeilijkste: ' + (ctx[2] || '');
  }

  async function voltooiSparring() {
    typingIndicator.classList.remove('hidden');
    scrollNaarOnder();
    var samenvatting = bouwSparringSamenvatting(sparringContext);

    try {
      var session = await supabaseClient.auth.getSession();
      var token = session.data.session.access_token;

      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          sparring: true,
          sparring_context: sparringContext.slice(),
          vraag: samenvatting,
          functiegroep: profile.functiegroep,
          weeknummer: weekNummer
        })
      });

      var data = await response.json();
      typingIndicator.classList.add('hidden');

      if (data.soft_limit) {
        toonRateLimitPopup(token);
      } else if (data.hard_limit || response.status === 429 || data.rate_limited) {
        renderBotBericht(data.error || 'Je hebt het dagelijkse maximum bereikt.', null, null, null);
      } else if (!response.ok || data.error) {
        renderBotBericht('Sorry, er ging iets mis bij het verwerken van je sparring-sessie. Probeer het opnieuw.', null, null, null);
      } else {
        renderBotBericht(data.antwoord, data.conversation_id, null, null);
        // Voeg toe aan conversatiehistorie zodat opvolgvragen context hebben
        conversatieHistorie.push({ role: 'user', content: samenvatting });
        conversatieHistorie.push({ role: 'assistant', content: data.antwoord });
      }
    } catch (err) {
      typingIndicator.classList.add('hidden');
      renderBotBericht('Verbindingsfout. Probeer het opnieuw.', null, null, null);
    }

    // Reset sparring state — nieuwe vragen gaan weer normaal
    sparringModus = false;
    sparringStap = 0;
    sparringContext = [];
    verbergSparringBadge();
  }

  // =============================================
  // VRAAG VERSTUREN
  // =============================================
  async function verstuurVraag() {
    var vraag = chatInput.value.trim();
    if (!vraag || isSending) return;

    // SPARRING modus — stap 1-3 lokaal afhandelen (geen edge function call,
    // telt niet voor rate limit). Alleen stap 4 (advies) gaat naar de server.
    if (sparringModus) {
      isSending = true;
      sendBtn.disabled = true;
      chatInput.value = '';
      chatInput.style.height = 'auto';
      renderGebruikersBericht(vraag, null);
      sparringContext.push(vraag);

      if (sparringContext.length < 3) {
        // Volgende vraag lokaal renderen
        sparringStap = sparringContext.length + 1;
        renderBotBericht(SPARRING_VRAGEN[sparringStap - 1], null, null, null);
        isSending = false;
        sendBtn.disabled = chatInput.value.trim().length === 0;
        scrollNaarOnder();
        return;
      }

      // Alle 3 antwoorden binnen → vraag advies aan edge function
      sparringStap = 4;
      await voltooiSparring();
      isSending = false;
      sendBtn.disabled = chatInput.value.trim().length === 0;
      scrollNaarOnder();
      return;
    }

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

    // Bij negatieve feedback: toon document aanvraag knop (max 1 per antwoord)
    if (waarde === 'niet_goed') {
      var bestaandeKnop = feedbackRow.querySelector('.doc-aanvraag-btn');
      if (!bestaandeKnop) {
        var msgRow = feedbackRow.closest('.message-row');
        var prevRow = msgRow ? msgRow.previousElementSibling : null;
        var vraagTekst = prevRow ? (prevRow.querySelector('.chat-bubble') || {}).textContent || '' : '';
        if (vraagTekst) {
          addDocumentAanvraagKnop(vraagTekst, feedbackRow);
        }
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
    // Zichtbaarheidsvenster: ma 00:00 t/m zo 23:59 van inwerkweek N
    var briefingWeek = actieveBriefingWeek(profile.startdatum);
    if (!briefingWeek) return;

    // Check of briefing van deze inwerkweek al gezien is (DB is leidend, localStorage is fallback)
    var briefingKey = 'wegwijzer_briefing_week_' + briefingWeek;
    var bestaand = await supabaseClient
      .from('weekstart_briefings')
      .select('id, gelezen')
      .eq('user_id', user.id)
      .eq('week_nummer', briefingWeek)
      .limit(1);
    if (bestaand.data && bestaand.data.length > 0 && bestaand.data[0].gelezen) {
      localStorage.setItem(briefingKey, 'true');
      return;
    }
    if (localStorage.getItem(briefingKey)) return;

    try {
      var session = await supabaseClient.auth.getSession();
      var token = session.data.session.access_token;

      var resp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ generate_briefing: true, week_nummer: briefingWeek })
      });
      var data = await resp.json();

      if (data.briefing) {
        var container = document.getElementById('weekstart-briefing');
        var header = document.getElementById('briefing-header');
        var tekst = document.getElementById('briefing-tekst');
        var sluitBtn = document.getElementById('briefing-sluit');

        if (container && header && tekst) {
          header.textContent = 'Week ' + briefingWeek + ' van 6';
          tekst.textContent = data.briefing;
          container.style.display = '';

          sluitBtn.addEventListener('click', function () {
            container.style.display = 'none';
            localStorage.setItem(briefingKey, 'true');
            supabaseClient.from('weekstart_briefings')
              .update({ gelezen: true })
              .eq('user_id', user.id)
              .eq('week_nummer', briefingWeek)
              .then(function () {});
          });
        }
      }
    } catch (err) {
      console.error('[Briefing] Fout:', err);
    }
  }

  // =============================================
  // VERTROUWENSCHECK (model: delen ja/nee)
  // =============================================

  // Eénmalig dialoog na week 6: wil je de wekelijkse check blijven ontvangen?
  // Resolved met true = doorgaan deze sessie, false = uitgeschakeld (geen check tonen).
  function toonVertrouwenscheckKeuze() {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px';
      overlay.innerHTML =
        '<div style="background:white;border-radius:12px;padding:24px;max-width:400px;width:100%;text-align:center">' +
        '<h3 style="margin:0 0 12px;font-size:1.05rem">Je inwerktraject is afgerond 🎉</h3>' +
        '<p style="font-size:0.9rem;color:var(--text);margin:0 0 20px;line-height:1.5">Wil je de wekelijkse check blijven ontvangen?</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn btn-primary" id="vc-keuze-ja" style="font-size:0.9rem;padding:10px">Ja, blijven</button>' +
        '<button class="btn btn-secondary" id="vc-keuze-nee" style="font-size:0.9rem;padding:10px">Nee, stoppen</button>' +
        '</div></div>';
      document.body.appendChild(overlay);

      overlay.querySelector('#vc-keuze-ja').addEventListener('click', async function () {
        localStorage.setItem('vertrouwenscheck_keuze_gemaakt', 'true');
        // vertrouwenscheck_actief blijft true (default) — geen DB-update nodig,
        // maar voor de zekerheid expliciet zetten zodat oude rijen zonder waarde meegaan
        await supabaseClient
          .from('profiles')
          .update({ vertrouwenscheck_actief: true })
          .eq('user_id', user.id);
        profile.vertrouwenscheck_actief = true;
        if (typeof window.updateVcToggleVisual === 'function') window.updateVcToggleVisual();
        overlay.remove();
        resolve(true);
      });

      overlay.querySelector('#vc-keuze-nee').addEventListener('click', async function () {
        localStorage.setItem('vertrouwenscheck_keuze_gemaakt', 'true');
        await supabaseClient
          .from('profiles')
          .update({ vertrouwenscheck_actief: false })
          .eq('user_id', user.id);
        profile.vertrouwenscheck_actief = false;
        if (typeof window.updateVcToggleVisual === 'function') window.updateVcToggleVisual();
        overlay.remove();
        resolve(false);
      });
    });
  }

  async function checkVertrouwenscheck() {
    // Profile gate: medewerker kan zelf de wekelijkse check uitschakelen
    // via 🔔 toggle in de header. Default = true.
    if (profile.vertrouwenscheck_actief === false) return;

    // Zichtbaarheidsvenster: vr 00:00 van week N t/m do 23:59 van week N+1
    // (loopt door na week 6)
    var vcWeek = actieveVertrouwenscheckWeek(profile.startdatum);
    if (!vcWeek) return;

    // Na week 6 — eerste keer dat de check verschijnt: vraag of medewerker
    // hem wil blijven ontvangen. Eénmalig per browser via localStorage.
    if (vcWeek > 6 && !localStorage.getItem('vertrouwenscheck_keuze_gemaakt')) {
      var keuzeBevestigd = await toonVertrouwenscheckKeuze();
      if (!keuzeBevestigd) return; // medewerker koos "Nee, stoppen" — break out
    }

    // Check of al ingevuld deze week (DB is leidend)
    var bestaand = await supabaseClient
      .from('vertrouwens_scores')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_nummer', vcWeek)
      .limit(1);
    if (bestaand.data && bestaand.data.length > 0) return;

    // Aanvullende check via localStorage (per week)
    var vcKey = 'wegwijzer_vc_week_' + vcWeek;
    if (localStorage.getItem(vcKey)) return;

    var modal = document.getElementById('vertrouwenscheck-modal');
    if (!modal) return;

    // Vraagstelling aanpassen op fase
    var titelEl = modal.querySelector('h3');
    if (titelEl) {
      titelEl.textContent = vcWeek <= 6
        ? 'Hoe zeker voel je je in je werk deze week?'
        : 'Hoe zit jij erin deze week?';
    }

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
          user_id: user.id, week_nummer: vcWeek, score: gekozenScore,
          gedeeld: false, tenant_id: profile.tenant_id
        });
        localStorage.setItem(vcKey, 'true');
        modal.querySelector('div > div').innerHTML =
          '<h3 style="margin-bottom:12px">Fijn om te horen! 🌟</h3>' +
          '<p style="font-size:0.9rem">Succes de komende week.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px" onclick="this.closest(\'[id=vertrouwenscheck-modal]\').style.display=\'none\'">Sluiten</button>';
      } else {
        // Score 1-3: vraag of medewerker wil delen — pas opslaan na keuze
        opslaanBtn.style.display = 'none';
        gekozenEl.style.display = 'none';
        document.getElementById('vc-sterren').style.display = 'none';
        var vervolg = document.getElementById('vc-vervolg');
        var vervolgTekst = document.getElementById('vc-vervolg-tekst');
        if (vervolgTekst) vervolgTekst.textContent = 'Wil je je score delen met je leidinggevende?';
        if (vervolg) vervolg.style.display = '';

        document.getElementById('vc-signaal').addEventListener('click', async function () {
          await supabaseClient.from('vertrouwens_scores').insert({
            user_id: user.id, week_nummer: vcWeek, score: gekozenScore,
            gedeeld: true, tenant_id: profile.tenant_id
          });
          localStorage.setItem(vcKey, 'true');
          modal.querySelector('div > div').innerHTML =
            '<h3 style="margin-bottom:12px">Score gedeeld 🤝</h3>' +
            '<p style="font-size:0.9rem">Je leidinggevende ziet je score en kan contact met je opnemen.</p>' +
            '<button class="btn btn-primary" style="margin-top:16px" onclick="this.closest(\'[id=vertrouwenscheck-modal]\').style.display=\'none\'">Sluiten</button>';
        });

        document.getElementById('vc-zelf').addEventListener('click', async function () {
          await supabaseClient.from('vertrouwens_scores').insert({
            user_id: user.id, week_nummer: vcWeek, score: gekozenScore,
            gedeeld: false, tenant_id: profile.tenant_id
          });
          localStorage.setItem(vcKey, 'true');
          modal.querySelector('div > div').innerHTML =
            '<h3 style="margin-bottom:12px">Oké, geen probleem 👍</h3>' +
            '<p style="font-size:0.9rem">Oké, je score is alleen voor jou.</p>' +
            '<button class="btn btn-primary" style="margin-top:16px" onclick="this.closest(\'[id=vertrouwenscheck-modal]\').style.display=\'none\'">Sluiten</button>';
        });
      }
    });
  }

  // =============================================
  // KENNISQUIZ (week 2-5)
  // =============================================
  async function checkKennisquiz() {
    // Zichtbaarheidsvenster: wo 00:00 van inwerkweek N t/m di 23:59 van inwerkweek N+1 (alleen N=2..5)
    var quizWeek = actieveQuizWeek(profile.startdatum);
    if (!quizWeek) return;

    // Check of al gedaan of overgeslagen voor deze inwerkweek (DB is leidend)
    var quizKey = 'wegwijzer_quiz_week_' + quizWeek;
    var bestaand = await supabaseClient
      .from('quiz_resultaten')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_nummer', quizWeek)
      .limit(1);
    if (bestaand.data && bestaand.data.length > 0) { localStorage.setItem(quizKey, 'true'); return; }
    if (localStorage.getItem(quizKey)) return;

    // Toon quiz kaartje boven chat
    var quizCard = document.createElement('div');
    quizCard.id = 'quiz-card';
    quizCard.style.cssText = 'background:#E3F2FD;border-bottom:1px solid #90CAF9;padding:12px 16px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center';

    var niveaus = { 2: '🟢 Basis', 3: '🟡 Gemiddeld', 4: '🟠 Gevorderd', 5: '🔴 Integratie' };
    quizCard.innerHTML =
      '<div><span style="font-size:1rem">📝</span> <strong style="font-size:0.85rem">Kennischeck week ' + quizWeek + '</strong> <span style="font-size:0.75rem;color:var(--text-muted)">' + (niveaus[quizWeek] || '') + ' · 3 vragen · 2 min</span></div>' +
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

        var quizResp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            generate_quiz: true,
            week_nummer: quizWeek
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
              week_nummer: quizWeek, score: correcteAntwoorden, gedeeld: true
            });
            localStorage.setItem(quizKey, 'true');
            quizCard.innerHTML = '<p style="padding:12px;font-size:0.85rem;text-align:center">✅ Score gedeeld. Goed gedaan!</p>';
            setTimeout(function () { quizCard.remove(); }, 2000);
          });

          document.getElementById('quiz-niet-delen').addEventListener('click', async function () {
            await supabaseClient.from('quiz_resultaten').insert({
              user_id: user.id, tenant_id: profile.tenant_id,
              week_nummer: quizWeek, score: correcteAntwoorden, gedeeld: false
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
    btn.className = 'doc-aanvraag-btn';
    btn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:12px;padding:3px 10px;font-size:0.7rem;cursor:pointer;color:var(--text-muted);margin-top:4px;font-family:var(--font)';
    btn.textContent = '📄 Vraag document aan over dit onderwerp';
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Aanvraag versturen...';
      try {
        // Direct insert — geen AI concept generatie
        // user_id is FK naar auth.users (uit document_aanvragen schema)
        var insertResult = await supabaseClient.from('document_aanvragen').insert({
          user_id: user.id,
          vraag: vraagTekst.trim().substring(0, 1000),
          status: 'nieuw'
        });
        if (insertResult.error) throw new Error(insertResult.error.message);

        // Vervang knop door bevestiging
        var bevestiging = document.createElement('div');
        bevestiging.style.cssText = 'background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:10px 12px;font-size:0.78rem;color:#1B5E20;margin-top:6px;line-height:1.5';
        bevestiging.innerHTML = '✓ Jouw aanvraag is ontvangen. De beheerder bekijkt of dit document kan worden toegevoegd aan de kennisbank. Je hoort hier niets meer over — we verwerken dit op de achtergrond.';
        btn.replaceWith(bevestiging);
      } catch (e) {
        btn.textContent = 'Aanvraag mislukt: ' + (e.message || 'fout');
        btn.style.color = 'var(--error)';
        btn.disabled = false;
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
  // 🔔 VERTROUWENSCHECK TOGGLE in header
  // =============================================
  function initVcToggle() {
    var btn = document.getElementById('vc-toggle-btn');
    var bevestiging = document.getElementById('vc-toggle-bevestiging');
    if (!btn) return;

    // Toon alleen voor medewerkers met een startdatum (anders niet relevant)
    if (!profile.startdatum) {
      btn.classList.add('hidden');
      return;
    }

    function applyVisual() {
      var aan = profile.vertrouwenscheck_actief !== false;
      btn.classList.toggle('vc-on', aan);
      btn.classList.toggle('vc-off', !aan);
      btn.title = aan ? 'Wekelijkse check staat aan — klik om uit te zetten' : 'Wekelijkse check staat uit — klik om aan te zetten';
    }
    // Expose voor de keuze-dialoog (na week 6) zodat die de visual kan refreshen
    window.updateVcToggleVisual = applyVisual;
    applyVisual();

    function toonBevestiging(tekst) {
      if (!bevestiging) return;
      bevestiging.textContent = tekst;
      bevestiging.style.display = '';
      setTimeout(function () { bevestiging.style.display = 'none'; }, 2000);
    }

    btn.addEventListener('click', async function () {
      var nieuw = !(profile.vertrouwenscheck_actief !== false);
      btn.disabled = true;
      var result = await supabaseClient
        .from('profiles')
        .update({ vertrouwenscheck_actief: nieuw })
        .eq('user_id', user.id)
        .select();
      btn.disabled = false;
      console.log('[VcToggle] Update naar', nieuw, 'response:', result.error, 'rows:', result.data);
      if (result.error) {
        alert('Toggle mislukt: ' + result.error.message);
        return;
      }
      profile.vertrouwenscheck_actief = nieuw;
      applyVisual();
      toonBevestiging(nieuw ? '🔔 Wekelijkse check ingeschakeld' : '🔕 Wekelijkse check uitgeschakeld');
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

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });
    cancelBtn.addEventListener('click', function (e) {
      e.preventDefault();
      closeModal();
    });

    // Klik op de overlay-achtergrond (NIET op de inner .modal) sluit de modal
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // Escape-toets sluit de modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('show')) closeModal();
    });

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
