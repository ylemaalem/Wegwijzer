// =============================================
// WEGWIJZER — Admin paneel logica
// =============================================

(function () {
  'use strict';

  // ---- State ----
  var namenZichtbaar = false;
  var tenantId = null;
  var currentUserId = null;
  var allConversations = [];
  var allProfiles = [];
  var allTeamleiders = [];
  var allDocuments = [];
  var allFunctiegroepen = [];
  // Cache van geladen kennissuggesties voor lookup vanuit notitie-handler.
  var suggestiesCache = {};

  // PDF.js worker instellen
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // TEAMS lijst (vast)
  var TEAMS_LIJST = [
    'Team Almere', 'Team Veluwe 1', 'Team Veluwe 2', 'Team Middelste Wei',
    'Team Molenweg', 'Team Gele Weiland', 'Team Manuscript', 'Team VAN', 'Team FAN', 'Team FANMN'
  ];

  // Superadmin = de "Wegwijzer Beheer" admin. Mag wisselen tussen tenants
  // via de organisatie-switcher in de header. Wanneer een override actief is
  // (localStorage), wordt tenantId hieronder vervangen door die waarde
  // — alle bestaande queries die .eq('tenant_id', tenantId) doen profiteren
  // automatisch zonder per-call wijziging.
  var isSuperadmin = false;
  var eigenTenantId = null;

  // ---- Wacht op auth ----
  document.addEventListener('wegwijzer-auth-ready', async function (e) {
    var profile = e.detail.profile;
    eigenTenantId = profile.tenant_id;
    tenantId = eigenTenantId;
    currentUserId = e.detail.user ? e.detail.user.id : null;

    isSuperadmin = profile.naam === 'Wegwijzer Beheer' && profile.role === 'admin';
    if (isSuperadmin) {
      var override = localStorage.getItem('wegwijzer_active_tenant_id');
      if (override && override !== eigenTenantId) {
        tenantId = override;
        console.log('[Superadmin] tenantId override actief:', override);
      }
      initOrgSwitcher();
      initNieuweOrgModal();
    }

    initTabs();
    initLogout();
    await loadFunctiegroepen();
    loadMappen();
    loadDocuments();
    loadMedewerkers();
    loadGesprekken();
    loadStatistieken();
    loadSettings();
    loadTeamleiders();
    loadVerbeterpunten();
    loadMeldingen();
    loadAanvragen();
    initUpload();
    initInviteModal();
    initGesprekDetail();
    initEditDocModal();
    initTeamleiderModal();
    initVerbeterModal();
    initKnToevoegen();
    initKbToevoegen();
    initHerindexeerBtn();
    initKennisScanBtns();
    loadKennissuggesties();
    loadRapporten();
    initRapportBtn();
    loadPrivacyVerzoeken();
    initFunctiegroepFormToggle();
    loadDocumentAanvragen();
    loadVertrouwensData();
    loadTerugblikLog();
    initVerbeterCollapse();
    initSuggestieDelegation();
    initRoiWidget();
  });

  // =============================================
  // ROI WIDGET (Rapporten tab)
  // =============================================
  var roiCurrentPeriode = 'maand';

  function initRoiWidget() {
    var card = document.getElementById('roi-card');
    if (!card) return;
    var toggleBtns = card.querySelectorAll('.roi-toggle-btn');
    toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var periode = btn.getAttribute('data-roi-periode');
        if (periode === roiCurrentPeriode) return;
        roiCurrentPeriode = periode;
        toggleBtns.forEach(function (b) {
          var actief = b.getAttribute('data-roi-periode') === periode;
          b.classList.toggle('active', actief);
          b.setAttribute('aria-selected', actief ? 'true' : 'false');
        });
        loadRoiWidget();
      });
    });
    loadRoiWidget();
  }

  async function loadRoiWidget() {
    var dagen = roiCurrentPeriode === 'week' ? 7 : 30;
    var sinds = new Date();
    sinds.setDate(sinds.getDate() - dagen);

    var convsRes = await supabaseClient
      .from('conversations')
      .select('id, user_id, feedback, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinds.toISOString());
    var convs = convsRes.data || [];

    var profsRes = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'medewerker');
    var totaalMedewerkers = (profsRes.data || []).length;

    var totaalVragen = convs.length;
    var uren = Math.round(totaalVragen * 8 / 60);
    var euros = uren * 35;
    var positief = convs.filter(function (c) { return c.feedback === 'goed'; }).length;
    var negatief = convs.filter(function (c) { return c.feedback === 'niet_goed'; }).length;
    var unieke = {};
    convs.forEach(function (c) { if (c.user_id) unieke[c.user_id] = true; });
    var actief = Object.keys(unieke).length;

    function setText(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    }

    if (totaalVragen === 0) {
      setText('roi-vragen', 'Nog geen data');
      setText('roi-tijdwinst', 'Nog geen data');
      setText('roi-feedback', 'Nog geen data');
      setText('roi-actief', totaalMedewerkers > 0 ? '0 van ' + totaalMedewerkers : 'Nog geen data');
    } else {
      setText('roi-vragen', String(totaalVragen));
      setText('roi-tijdwinst', '~' + uren + ' uur (~€' + euros.toLocaleString('nl-NL') + ' bespaard)');
      var fbTotaal = positief + negatief;
      if (fbTotaal === 0) {
        setText('roi-feedback', 'Nog geen feedback');
      } else {
        var pct = Math.round(positief / fbTotaal * 100);
        setText('roi-feedback', pct + '% (' + positief + ' van ' + fbTotaal + ')');
      }
      setText('roi-actief', actief + ' van ' + totaalMedewerkers);
    }

    // Jaarwaarde alleen bij Maand
    var jaarMetric = document.getElementById('roi-metric-jaar');
    if (jaarMetric) {
      if (roiCurrentPeriode === 'maand' && totaalVragen > 0) {
        jaarMetric.style.display = '';
        var jaarUren = uren * 12;
        var jaarEuros = euros * 12;
        setText('roi-jaar', '~' + jaarUren + ' uur (~€' + jaarEuros.toLocaleString('nl-NL') + ')');
      } else {
        jaarMetric.style.display = 'none';
      }
    }
  }

  // =============================================
  // EVENT DELEGATION voor dynamisch gerenderde knoppen in kennissuggesties
  // =============================================
  // De suggestie-cards (en hun knoppen) worden steeds opnieuw via innerHTML
  // geschreven door renderGroep. Een listener direct op de knop overleeft
  // dat niet. Daarom delegeren we naar document — één listener die op
  // class+data-attribute matcht.
  function initSuggestieDelegation() {
    document.addEventListener('click', function (e) {
      var target = e.target;
      // closest vangt klikken op span/icoon binnen de knop
      var btn = target && target.closest ? target.closest('.notitie-suggestie-btn') : null;
      if (!btn) return;
      e.preventDefault();
      var id = btn.getAttribute('data-suggestie-id');
      if (!id) return;
      console.log('[notitie-delegation] click op suggestie', id);
      window.notitieSuggestie(id);
    });
  }

  // =============================================
  // INKLAP / UITKLAP secties (kennisbank items, kennisnotities)
  // =============================================
  function initVerbeterCollapse() {
    var secties = document.querySelectorAll('.vp-collapsible');
    secties.forEach(function (sectie) {
      var key = sectie.getAttribute('data-collapse-key');
      var header = sectie.querySelector('.vp-collapse-header');
      var content = sectie.querySelector('.vp-collapse-content');
      var chevron = sectie.querySelector('.vp-chevron');
      if (!header || !content || !chevron) return;

      var storageKey = 'wegwijzer_collapse_' + key;
      var ingeklapt = localStorage.getItem(storageKey) === '1';
      applyState(ingeklapt);

      header.addEventListener('click', function () {
        ingeklapt = !ingeklapt;
        localStorage.setItem(storageKey, ingeklapt ? '1' : '0');
        applyState(ingeklapt);
      });

      function applyState(closed) {
        content.style.display = closed ? 'none' : '';
        chevron.textContent = closed ? '▶' : '▼';
      }
    });
  }

  // =============================================
  // TABS — 6 hoofdgroepen met dynamische sub-tabs
  // =============================================
  // Mapping van hoofdgroep → lijst sub-tabs in volgorde.
  // sub-tab .key komt overeen met de bestaande tab-content id (zonder "tab-" prefix).
  var tabGroups = {
    documenten: [
      { key: 'documenten', label: '📄 Documenten' }
    ],
    medewerkers: [
      { key: 'medewerkers', label: '👥 Mijn team' },
      { key: 'aanvragen', label: '📥 Aanvragen' }
    ],
    gesprekken: [
      { key: 'gesprekken', label: '💬 Gesprekken' }
    ],
    verbeterpunten: [
      { key: 'verbeterpunten', label: '🔍 Verbeterpunten' },
      { key: 'doc-aanvragen', label: '📑 Doc. aanvragen' },
      { key: 'kennissuggesties', label: '💡 Kennissuggesties' },
      { key: 'meldingen', label: '🔔 Meldingen' },
      { key: 'vertrouwen', label: '🤝 Vertrouwen' }
    ],
    rapporten: [
      { key: 'statistieken', label: '📈 Statistieken' },
      { key: 'rapporten', label: '📊 Rapporten' }
    ],
    instellingen: [
      { key: 'instellingen', label: '⚙️ Instellingen' },
      { key: 'teamleiders', label: '👔 Leidinggevende/HR' },
      { key: 'privacy', label: '🔒 Privacy verzoeken' }
    ]
  };

  // Per-sub-tab badge counts (worden door updateTabBadge gevuld).
  var tabBadgeCounts = {};
  var currentTabGroup = 'documenten';
  var currentSubTab = 'documenten';

  function initTabs() {
    var groupBtns = document.querySelectorAll('#tab-nav .tab-btn');
    groupBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activateGroup(btn.dataset.tabgroup);
      });
    });
    activateGroup('documenten');
  }

  function activateGroup(groupKey) {
    if (!tabGroups[groupKey]) return;
    currentTabGroup = groupKey;

    // Hoofdtab actieve state
    document.querySelectorAll('#tab-nav .tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tabgroup') === groupKey);
    });

    // Bouw sub-tab nav (alleen tonen als groep meer dan 1 sub-tab heeft)
    var subs = tabGroups[groupKey];
    var subNav = document.getElementById('sub-tab-nav');
    subNav.innerHTML = '';
    if (subs.length > 1) {
      subNav.removeAttribute('hidden');
      subs.forEach(function (sub) {
        var sb = document.createElement('button');
        sb.className = 'sub-tab-btn';
        sb.setAttribute('data-tab', sub.key);
        sb.textContent = sub.label;
        sb.addEventListener('click', function () { activateSubTab(sub.key); });
        subNav.appendChild(sb);
      });
    } else {
      subNav.setAttribute('hidden', '');
    }

    // Activeer eerste sub-tab van de groep
    activateSubTab(subs[0].key);
  }

  function activateSubTab(subKey) {
    currentSubTab = subKey;
    // Sectie tonen
    document.querySelectorAll('.tab-content').forEach(function (c) {
      c.classList.remove('active');
    });
    var doel = document.getElementById('tab-' + subKey);
    if (doel) doel.classList.add('active');

    // Sub-tab knop active state
    document.querySelectorAll('#sub-tab-nav .sub-tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === subKey);
    });

    reapplyBadges();
  }

  // Geeft de hoofdgroep terug waar een sub-tab key bij hoort.
  function findGroupForSub(subKey) {
    var keys = Object.keys(tabGroups);
    for (var i = 0; i < keys.length; i++) {
      var subs = tabGroups[keys[i]];
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].key === subKey) return keys[i];
      }
    }
    return null;
  }

  // Re-apply alle badges op zowel zichtbare sub-tab knoppen als de hoofdgroep knoppen.
  function reapplyBadges() {
    // Sub-tab knoppen
    document.querySelectorAll('#sub-tab-nav .sub-tab-btn').forEach(function (btn) {
      var key = btn.getAttribute('data-tab');
      setBadgeOn(btn, tabBadgeCounts[key] || 0);
    });
    // Hoofdgroep knoppen: aggregaat over alle subs
    document.querySelectorAll('#tab-nav .tab-btn').forEach(function (btn) {
      var groupKey = btn.getAttribute('data-tabgroup');
      var subs = tabGroups[groupKey] || [];
      var totaal = subs.reduce(function (s, sub) { return s + (tabBadgeCounts[sub.key] || 0); }, 0);
      setBadgeOn(btn, totaal);
    });
  }

  function setBadgeOn(el, count) {
    var existing = el.querySelector('.tab-badge');
    if (existing) existing.remove();
    if (count > 0) {
      var badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.textContent = count;
      el.appendChild(badge);
    }
  }

  // =============================================
  // LOGOUT
  // =============================================
  function initLogout() {
    document.getElementById('logout-btn').addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      window.location.href = appUrl('index.html');
    });
  }

  // =============================================
  // ORGANISATIE SWITCHER (alleen Wegwijzer Beheer)
  // =============================================
  async function initOrgSwitcher() {
    var bar = document.getElementById('org-switcher-bar');
    var select = document.getElementById('org-switcher-select');
    var badge = document.getElementById('admin-active-org-badge');
    if (!bar || !select) return;

    // Tenants ophalen — dankzij is_superadmin() RLS policy ziet superadmin alle rijen
    var result = await supabaseClient.from('tenants').select('id, naam').order('naam');
    console.log('[OrgSwitcher] Tenants geladen:', result.data ? result.data.length : 0, result.error);
    if (result.error) {
      bar.style.display = 'none';
      return;
    }
    var tenants = result.data || [];

    // Vul dropdown
    select.innerHTML = tenants.map(function (t) {
      var sel = t.id === tenantId ? ' selected' : '';
      return '<option value="' + t.id + '"' + sel + '>' + escapeHtml(t.naam) + '</option>';
    }).join('');

    bar.style.display = '';

    // Active-org badge in header (toont waar de superadmin nu zit)
    if (badge) {
      var actief = tenants.find(function (t) { return t.id === tenantId; });
      if (actief) {
        badge.textContent = '🏢 ' + actief.naam;
        badge.style.display = '';
      }
    }

    select.addEventListener('change', function () {
      var nieuw = select.value;
      if (!nieuw) return;
      if (nieuw === eigenTenantId) {
        // Terug naar eigen tenant — wis override
        localStorage.removeItem('wegwijzer_active_tenant_id');
      } else {
        localStorage.setItem('wegwijzer_active_tenant_id', nieuw);
      }
      // Reload zodat alle queries opnieuw met de nieuwe tenantId draaien
      window.location.reload();
    });
  }

  function initNieuweOrgModal() {
    var addBtn = document.getElementById('add-org-btn');
    var modal = document.getElementById('modal-nieuwe-org');
    var form = document.getElementById('nieuwe-org-form');
    var cancelBtn = document.getElementById('nieuwe-org-cancel');
    var submitBtn = document.getElementById('nieuwe-org-submit');
    var alertBox = document.getElementById('nieuwe-org-alert');
    var alertMsg = document.getElementById('nieuwe-org-alert-message');
    if (!addBtn || !modal) return;

    function showAlert(type, msg) {
      alertBox.className = 'alert alert-' + type + ' show';
      alertBox.style.display = '';
      alertMsg.textContent = msg;
    }
    function clearAlert() {
      alertBox.className = 'alert';
      alertBox.style.display = 'none';
      alertMsg.textContent = '';
    }

    addBtn.addEventListener('click', function () {
      form.reset();
      document.getElementById('nieuwe-org-kleur').value = '#0D5C6B';
      clearAlert();
      modal.classList.add('show');
    });

    cancelBtn.addEventListener('click', function () { modal.classList.remove('show'); });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearAlert();
      var naam = document.getElementById('nieuwe-org-naam').value.trim();
      var kleur = document.getElementById('nieuwe-org-kleur').value.trim() || '#0D5C6B';
      var email = document.getElementById('nieuwe-org-email').value.trim();
      if (!naam) { showAlert('error', 'Naam is verplicht.'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Aanmaken...';

      // Stap 1: nieuwe tenant
      var tenantInsert = await supabaseClient
        .from('tenants')
        .insert({ naam: naam })
        .select('id, naam')
        .single();
      console.log('[NieuweOrg] Tenant insert:', tenantInsert.error, tenantInsert.data);
      if (tenantInsert.error || !tenantInsert.data) {
        showAlert('error', 'Aanmaken mislukt: ' + (tenantInsert.error ? tenantInsert.error.message : 'geen rij teruggekregen'));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Aanmaken';
        return;
      }
      var newTenantId = tenantInsert.data.id;

      // Stap 2: settings rijen (organisatienaam altijd, kleur + email indien gegeven)
      var settingsRows = [
        { tenant_id: newTenantId, sleutel: 'organisatienaam', waarde: naam }
      ];
      if (kleur && /^#?[0-9a-fA-F]{3,8}$/.test(kleur)) {
        settingsRows.push({ tenant_id: newTenantId, sleutel: 'primaire_kleur', waarde: kleur.startsWith('#') ? kleur : '#' + kleur });
      }
      if (email) {
        settingsRows.push({ tenant_id: newTenantId, sleutel: 'contact_email', waarde: email });
      }
      var settingsInsert = await supabaseClient.from('settings').insert(settingsRows).select();
      console.log('[NieuweOrg] Settings insert:', settingsInsert.error, settingsInsert.data ? settingsInsert.data.length : 0, 'rijen');
      if (settingsInsert.error) {
        // tenant is wel aangemaakt — laat de gebruiker toch weten dat het deels gelukt is
        showAlert('error', 'Tenant aangemaakt maar settings mislukt: ' + settingsInsert.error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Aanmaken';
        return;
      }

      showAlert('success', 'Organisatie aangemaakt. Schakel ernaar via de dropdown om accounts en documenten toe te voegen.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Aanmaken';

      // Refresh switcher dropdown om de nieuwe org te tonen
      var refreshResult = await supabaseClient.from('tenants').select('id, naam').order('naam');
      var select = document.getElementById('org-switcher-select');
      if (select && refreshResult.data) {
        select.innerHTML = refreshResult.data.map(function (t) {
          var sel = t.id === tenantId ? ' selected' : '';
          return '<option value="' + t.id + '"' + sel + '>' + escapeHtml(t.naam) + '</option>';
        }).join('');
      }
    });
  }

  // =============================================
  // TEKST EXTRACTIE UIT BESTANDEN
  // =============================================
  async function extractTextFromFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'txt') {
      return await file.text();
    }

    // CSV: lees als tekst, converteer rijen naar zinnen, stuur naar Claude
    if (ext === 'csv') {
      return await extractCsvText(file);
    }

    // XLSX: gebruik SheetJS, converteer naar tekst, stuur naar Claude
    if (ext === 'xlsx') {
      return await extractXlsxText(file);
    }

    // PDF en DOCX: probeer eerst Claude extractie, val terug op lokale methode
    if (ext === 'pdf' || ext === 'docx' || ext === 'doc') {
      try {
        var claudeText = await extractViaClaude(file);
        if (claudeText && claudeText.length > 50) {
          return claudeText;
        }
      } catch (err) {
        console.error('Claude extractie mislukt, fallback naar lokaal:', err);
      }

      // Fallback
      if (ext === 'pdf') return await extractPdfText(file);
      if (ext === 'docx') return await extractDocxText(file);
      var text = await file.text();
      return text.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
    }

    return '';
  }

  async function extractViaClaude(file) {
    var arrayBuffer = await file.arrayBuffer();
    var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuffer)));

    var mediaType = 'application/pdf';
    var ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'doc') mediaType = 'application/msword';

    var session = await supabaseClient.auth.getSession();
    var token = session.data.session.access_token;

    var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        extract_pdf: true,
        pdf_base64: base64,
        media_type: mediaType
      })
    });

    var data = await response.json();
    return data.extracted_text || '';
  }

  async function extractCsvText(file) {
    try {
      var text = await file.text();
      var lines = text.split('\n').filter(function (l) { return l.trim().length > 0; });
      if (lines.length < 2) return text;

      var headers = lines[0].split(/[,;\t]/).map(function (h) { return h.trim().replace(/"/g, ''); });
      var zinnen = [];
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(/[,;\t]/).map(function (c) { return c.trim().replace(/"/g, ''); });
        var zin = headers.map(function (h, idx) {
          return h + ': ' + (cols[idx] || '');
        }).join(', ');
        zinnen.push(zin + '.');
      }
      var rawText = zinnen.join(' ');
      console.log('[CSV] Geëxtraheerd:', rawText.length, 'tekens uit', lines.length - 1, 'rijen');

      // Stuur naar Claude voor structurering
      try {
        var claudeText = await structureerViaClaude(rawText);
        if (claudeText && claudeText.length > 50) return claudeText;
      } catch (err) {
        console.error('[CSV] Claude structurering mislukt:', err);
      }
      return rawText;
    } catch (err) {
      console.error('[CSV] Extractie mislukt:', err);
      return '';
    }
  }

  async function extractXlsxText(file) {
    try {
      var arrayBuffer = await file.arrayBuffer();
      var workbook = XLSX.read(arrayBuffer, { type: 'array' });
      var allText = [];

      workbook.SheetNames.forEach(function (sheetName) {
        var sheet = workbook.Sheets[sheetName];
        var data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (data.length < 2) return;

        var headers = data[0].map(function (h) { return String(h || '').trim(); });
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (!row || row.length === 0) continue;
          var zin = headers.map(function (h, idx) {
            return h + ': ' + String(row[idx] || '');
          }).join(', ');
          allText.push(zin + '.');
        }
      });

      var rawText = allText.join(' ');
      console.log('[XLSX] Geëxtraheerd:', rawText.length, 'tekens uit', workbook.SheetNames.length, 'sheets');

      // Stuur naar Claude voor structurering
      try {
        var claudeText = await structureerViaClaude(rawText);
        if (claudeText && claudeText.length > 50) return claudeText;
      } catch (err) {
        console.error('[XLSX] Claude structurering mislukt:', err);
      }
      return rawText;
    } catch (err) {
      console.error('[XLSX] Extractie mislukt:', err);
      return '';
    }
  }

  async function structureerViaClaude(rawText) {
    var session = await supabaseClient.auth.getSession();
    var token = session.data.session.access_token;
    var truncated = rawText.substring(0, 15000);

    var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        extract_pdf: true,
        pdf_base64: btoa(unescape(encodeURIComponent(truncated))),
        media_type: 'text/plain'
      })
    });

    var data = await response.json();
    return data.extracted_text || '';
  }

  async function extractPdfText(file) {
    try {
      var arrayBuffer = await file.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      var texts = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        var pageText = content.items.map(function (item) { return item.str; }).join(' ');
        texts.push(pageText);
      }
      return texts.join('\n\n');
    } catch (err) {
      console.error('PDF extractie mislukt:', err);
      return '';
    }
  }

  async function extractDocxText(file) {
    try {
      var arrayBuffer = await file.arrayBuffer();
      var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      return result.value || '';
    } catch (err) {
      console.error('DOCX extractie mislukt:', err);
      return '';
    }
  }

  // Tekst extractie van een Blob (voor backfill bestaande docs)
  async function extractTextFromBlob(blob, filename) {
    var ext = filename.split('.').pop().toLowerCase();

    if (ext === 'txt') {
      return await blob.text();
    }

    if (ext === 'pdf') {
      try {
        var arrayBuffer = await blob.arrayBuffer();
        var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        var texts = [];
        for (var i = 1; i <= pdf.numPages; i++) {
          var page = await pdf.getPage(i);
          var content = await page.getTextContent();
          var pageText = content.items.map(function (item) { return item.str; }).join(' ');
          texts.push(pageText);
        }
        return texts.join('\n\n');
      } catch (err) {
        console.error('PDF extractie mislukt voor', filename, err);
        return '';
      }
    }

    if (ext === 'docx') {
      try {
        var arrayBuffer2 = await blob.arrayBuffer();
        var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer2 });
        return result.value || '';
      } catch (err) {
        console.error('DOCX extractie mislukt voor', filename, err);
        return '';
      }
    }

    if (ext === 'doc') {
      var text = await blob.text();
      return text.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
    }

    return '';
  }

  // =============================================
  // HULPFUNCTIES
  // =============================================
  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatFunctiegroep(fg) {
    // Zoek eerst in de dynamische functiegroepen tabel
    if (allFunctiegroepen && allFunctiegroepen.length > 0) {
      var found = allFunctiegroepen.find(function (f) { return f.code === fg; });
      if (found) return found.naam;
    }
    // Fallback: hardcoded map
    var map = {
      'ambulant_begeleider': 'Ambulant Begeleider',
      'ambulant_persoonlijk_begeleider': 'Ambulant Pers. Begeleider',
      'woonbegeleider': 'Woonbegeleider',
      'persoonlijk_woonbegeleider': 'Pers. Woonbegeleider',
      'medewerker_avond_nachtdienst': 'Avond-/Nachtdienst',
      'kantoorpersoneel': 'Kantoorpersoneel',
      'stagiaire': 'Stagiaire',
      'zzp_uitzendkracht': 'ZZP / Uitzendkracht'
    };
    return map[fg] || fg || '-';
  }

  function generateTempPassword() {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    var pw = '';
    for (var i = 0; i < 24; i++) {
      pw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pw;
  }

  function formatDocumentType(type) {
    var map = {
      'beleid': 'Beleid',
      'protocol': 'Protocol',
      'werkinstructie': 'Werkinstructie',
      'formulier': 'Formulier',
      'handleiding': 'Handleiding',
      'overig': 'Overig'
    };
    return map[type] || type || '-';
  }

  function getRevisieColor(revisiedatum) {
    if (!revisiedatum) return null;
    var now = new Date();
    var revisie = new Date(revisiedatum);
    var diffMs = revisie.getTime() - now.getTime();
    var diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 0) {
      return '#dc3545'; // red — past due
    } else if (diffDays <= 60) {
      return '#ff9800'; // orange — within 2 months
    } else {
      return '#28a745'; // green — more than 2 months away
    }
  }

  function populateTeamCheckboxes(containerId, selectedTeams) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    var teams = selectedTeams || [];

    TEAMS_LIJST.forEach(function (team) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:0.88rem';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = team;
      cb.name = containerId;
      if (teams.indexOf(team) !== -1) {
        cb.checked = true;
      }

      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + team));
      container.appendChild(label);
    });
  }

  function getCheckedTeams(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return [];
    var checked = [];
    var boxes = container.querySelectorAll('input[type="checkbox"]:checked');
    boxes.forEach(function (cb) {
      checked.push(cb.value);
    });
    return checked;
  }

  function populateTeamleiderDropdown(selectId, selectedNaam, filterRol) {
    var select = document.getElementById(selectId);
    if (!select) return;
    var current = selectedNaam || select.value || '';
    var label = filterRol === 'manager' ? 'manager' : 'teamleider';
    select.innerHTML = '<option value="">— Geen ' + label + ' —</option>';
    allTeamleiders
      .filter(function (tl) {
        if (!filterRol) return true;
        return (tl.rol || 'teamleider') === filterRol;
      })
      .forEach(function (tl) {
        var opt = document.createElement('option');
        opt.value = tl.naam;
        opt.textContent = tl.naam;
        if (tl.naam === current) opt.selected = true;
        select.appendChild(opt);
      });
  }

  // Dynamisch formulier: toon velden op basis van functiegroep
  function updateFormFields(prefix, fgCode) {
    var zorgFields = document.querySelectorAll('.' + prefix + '-zorg-field');
    var kantoorFields = document.querySelectorAll('.' + prefix + '-kantoor-field');
    var sharedFields = document.querySelectorAll('.' + prefix + '-shared-field');
    var hint = document.getElementById(prefix + '-fg-hint');

    if (!fgCode) {
      // Situatie C: geen functiegroep gekozen — toon hint, verberg alles
      zorgFields.forEach(function (el) { el.style.display = 'none'; });
      kantoorFields.forEach(function (el) { el.style.display = 'none'; });
      sharedFields.forEach(function (el) { el.style.display = 'none'; });
      if (hint) hint.style.display = '';
      return;
    }

    if (hint) hint.style.display = 'none';

    var fg = allFunctiegroepen.find(function (f) { return f.code === fgCode; });
    // Onbekende functiegroep = behandel als zorgfunctie (toon teams etc.)
    var isKantoor = fg ? fg.is_kantoor : false;

    if (isKantoor) {
      // Situatie B: kantoorpersoneel
      zorgFields.forEach(function (el) { el.style.display = 'none'; });
      kantoorFields.forEach(function (el) { el.style.display = ''; });
      sharedFields.forEach(function (el) { el.style.display = ''; });
    } else {
      // Situatie A: zorgfunctie
      zorgFields.forEach(function (el) { el.style.display = ''; });
      kantoorFields.forEach(function (el) { el.style.display = 'none'; });
      sharedFields.forEach(function (el) { el.style.display = ''; });
    }
  }

  function initFunctiegroepFormToggle() {
    // Populeer manager dropdowns met dezelfde data als teamleider
    function syncManagerDropdowns() {
      populateTeamleiderDropdown('invite-manager', '', 'manager');
      populateTeamleiderDropdown('edit-manager', '', 'manager');
    }

    // Invite formulier
    var inviteFg = document.getElementById('invite-functiegroep');
    if (inviteFg) {
      inviteFg.addEventListener('change', function () {
        updateFormFields('invite', inviteFg.value);
        syncManagerDropdowns();
      });
      // Start staat: nog geen functiegroep
      updateFormFields('invite', '');
    }

    // Edit formulier
    var editFg = document.getElementById('edit-functiegroep');
    if (editFg) {
      editFg.addEventListener('change', function () {
        updateFormFields('edit', editFg.value);
        syncManagerDropdowns();
      });
    }
  }

  // =============================================
  // DOCUMENTEN
  // =============================================
  var pendingFiles = null;
  var allMappen = [];

  async function loadMappen() {
    // Haal mappen op uit document_mappen tabel
    var result = await supabaseClient
      .from('document_mappen')
      .select('id, naam')
      .eq('tenant_id', tenantId)
      .order('naam');

    allMappen = result.data ? result.data.map(function (m) { return m.naam; }) : [];

    // Vul alle map dropdowns
    populateMapDropdowns();

    // Render mappen lijst
    renderMappenLijst(result.data || []);
  }

  function populateMapDropdowns() {
    ['doc-map', 'edit-doc-map', 'bulk-move-map'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var current = el.value;
      el.innerHTML = '<option value="">Overig (geen map)</option>';
      allMappen.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        el.appendChild(opt);
      });
      el.value = current;
    });
  }

  function renderMappenLijst(mappen) {
    var container = document.getElementById('mappen-lijst');
    if (!container) return;
    if (mappen.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nog geen mappen aangemaakt.</p>';
      return;
    }
    container.innerHTML = mappen.map(function (m) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:1rem">📁</span>' +
        '<span style="font-weight:600;font-size:0.85rem;flex:1">' + escapeHtml(m.naam) + '</span>' +
        '<button class="btn-icon" onclick="window.renameMap(\'' + m.id + '\', \'' + escapeHtml(m.naam) + '\')" title="Hernoemen">✏️</button>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteMap(\'' + m.id + '\', \'' + escapeHtml(m.naam) + '\')" title="Verwijderen">🗑️</button>' +
        '</div>';
    }).join('');
  }

  window.renameMap = async function (id, oudeNaam) {
    var nieuweNaam = prompt('Nieuwe mapnaam:', oudeNaam);
    if (!nieuweNaam || nieuweNaam.trim() === oudeNaam) return;
    nieuweNaam = nieuweNaam.trim();

    // Update de mapnaam in de mappen tabel
    await supabaseClient.from('document_mappen').update({ naam: nieuweNaam }).eq('id', id);
    // Update alle documenten met de oude mapnaam
    await supabaseClient.from('documents').update({ map: nieuweNaam }).eq('tenant_id', tenantId).eq('map', oudeNaam);

    await loadMappen();
    await loadDocuments();
  };

  window.deleteMap = async function (id, mapNaam) {
    if (!confirm('Map "' + mapNaam + '" verwijderen? Documenten worden verplaatst naar Overig.')) return;

    // Zet documenten in deze map op null
    await supabaseClient.from('documents').update({ map: null }).eq('tenant_id', tenantId).eq('map', mapNaam);
    // Verwijder de map
    await supabaseClient.from('document_mappen').delete().eq('id', id);

    await loadMappen();
    await loadDocuments();
  };

  (function initMapBtn() {
    var btn = document.getElementById('add-map-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var input = document.getElementById('nieuwe-map-naam');
      var naam = input ? input.value.trim() : '';
      if (!naam) { alert('Vul een mapnaam in.'); return; }

      var result = await supabaseClient.from('document_mappen').insert({
        tenant_id: tenantId,
        naam: naam
      });

      if (result.error) {
        alert('Map aanmaken mislukt: ' + result.error.message);
        return;
      }

      if (input) input.value = '';
      await loadMappen();
    });
  })();

  // Bulk verplaatsen
  (function initBulkMove() {
    var moveBtn = document.getElementById('bulk-move-btn');
    if (!moveBtn) return;
    moveBtn.addEventListener('click', async function () {
      var checked = document.querySelectorAll('.doc-select-cb:checked');
      if (checked.length === 0) return;
      var mapSelect = document.getElementById('bulk-move-map');
      var mapValue = mapSelect ? mapSelect.value || null : null;

      for (var i = 0; i < checked.length; i++) {
        await supabaseClient.from('documents').update({ map: mapValue }).eq('id', checked[i].value);
      }

      await loadDocuments();
      document.getElementById('bulk-move-bar').style.display = 'none';
      var selectAll = document.getElementById('doc-select-all');
      if (selectAll) selectAll.checked = false;
    });
  })();

  function initUpload() {
    var zone = document.getElementById('upload-zone');
    var input = document.getElementById('file-input');
    var confirmBtn = document.getElementById('upload-confirm-btn');
    var cancelBtn = document.getElementById('upload-cancel-btn');

    zone.addEventListener('click', function () { input.click(); });

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', function () {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        showUploadPreview(e.dataTransfer.files);
      }
    });

    input.addEventListener('change', function () {
      if (input.files.length > 0) {
        showUploadPreview(input.files);
      }
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async function () {
        console.log('[Upload] Upload knop geklikt');
        if (!pendingFiles || pendingFiles.length === 0) {
          console.warn('[Upload] Geen bestanden in pendingFiles');
          return;
        }
        console.log('[Upload] Bevestigd, start verwerking van', pendingFiles.length, 'bestand(en)');
        // Kopieer FileList naar array zodat het niet verdwijnt bij input.value reset
        var filesToUpload = [];
        for (var k = 0; k < pendingFiles.length; k++) {
          filesToUpload.push(pendingFiles[k]);
        }
        console.log('[Upload] Array gekopieerd:', filesToUpload.length, 'items');
        pendingFiles = null;
        document.getElementById('upload-preview').style.display = 'none';
        confirmBtn.disabled = true;
        try {
          await handleFiles(filesToUpload);
        } finally {
          confirmBtn.disabled = false;
          document.getElementById('file-input').value = '';
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        pendingFiles = null;
        document.getElementById('upload-preview').style.display = 'none';
        document.getElementById('file-input').value = '';
        console.log('[Upload] Geannuleerd');
      });
    }
  }

  function showUploadPreview(files) {
    console.log('[Upload] Bestanden geselecteerd:', files.length);
    pendingFiles = files;
    var preview = document.getElementById('upload-preview');
    var list = document.getElementById('upload-preview-list');
    var confirmBtn = document.getElementById('upload-confirm-btn');

    var items = [];
    for (var i = 0; i < files.length; i++) {
      var sizeKb = Math.round(files[i].size / 1024);
      items.push('<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem"><span>📄 ' + escapeHtml(files[i].name) + '</span><span style="color:var(--text-muted)">' + sizeKb + ' KB</span></div>');
    }
    list.innerHTML = items.join('');
    confirmBtn.textContent = 'Upload ' + files.length + ' bestand' + (files.length > 1 ? 'en' : '');
    preview.style.display = 'block';
  }

  async function handleFiles(files) {
    console.log('[Upload] handleFiles start met', files.length, 'bestand(en), tenantId:', tenantId);
    var progress = document.getElementById('upload-progress');
    var itemsContainer = document.getElementById('upload-items');
    progress.classList.add('show');
    itemsContainer.innerHTML = '';

    // Lees extra metadata velden
    var docTypeEl = document.getElementById('doc-type');
    var docRevisieEl = document.getElementById('doc-revisiedatum');
    var documenttype = docTypeEl ? docTypeEl.value : null;
    var revisiedatum = docRevisieEl ? docRevisieEl.value : null;
    var docMapEl = document.getElementById('doc-map');
    var docMap = docMapEl ? docMapEl.value : null;

    // Maak per-bestand voortgangsitems
    var fileItems = [];
    for (var i = 0; i < files.length; i++) {
      var item = document.createElement('div');
      item.className = 'upload-item';
      item.innerHTML =
        '<div class="upload-item-header">' +
          '<span class="upload-item-name">' + escapeHtml(files[i].name) + '</span>' +
          '<span class="upload-item-status" id="upload-status-' + i + '">Wachten...</span>' +
        '</div>' +
        '<div class="progress-bar"><div class="progress-fill" id="upload-fill-' + i + '"></div></div>';
      itemsContainer.appendChild(item);
      fileItems.push(item);
    }

    // Haal profiel id op
    var profileResult = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('user_id', window.wegwijzerUser.id)
      .single();
    var profileId = profileResult.data ? profileResult.data.id : null;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var ext = file.name.split('.').pop().toLowerCase();
      var statusEl = document.getElementById('upload-status-' + i);
      var fillEl = document.getElementById('upload-fill-' + i);

      if (!['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx'].includes(ext)) {
        statusEl.textContent = 'Ongeldig type';
        statusEl.style.color = 'var(--error)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--error)';
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        statusEl.textContent = 'Te groot (max 20MB)';
        statusEl.style.color = 'var(--error)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--error)';
        continue;
      }

      // Stap 1: Tekst extraheren
      console.log('[Upload] Stap 1 — Tekst extraheren:', file.name);
      statusEl.textContent = 'Tekst extraheren...';
      fillEl.style.width = '20%';

      var extractedText = '';
      try {
        extractedText = await extractTextFromFile(file);
        console.log('[Upload] Tekst geëxtraheerd, lengte:', extractedText.length);
      } catch (err) {
        console.error('[Upload] Extractie fout:', err);
      }

      // Stap 2: Uploaden naar storage
      console.log('[Upload] Stap 2 — Uploaden naar storage:', file.name);
      statusEl.textContent = 'Uploaden...';
      fillEl.style.width = '50%';

      var fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var filePath = tenantId + '/' + fileName;

      try {
        var uploadResult = await supabaseClient.storage
          .from('documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        console.log('[Upload] Storage resultaat:', uploadResult.error ? 'FOUT: ' + uploadResult.error.message : 'OK, pad: ' + filePath);

        if (uploadResult.error) {
          statusEl.textContent = 'Upload mislukt: ' + uploadResult.error.message;
          statusEl.style.color = 'var(--error)';
          fillEl.style.width = '100%';
          fillEl.style.background = 'var(--error)';
          continue;
        }

        // Stap 3: Metadata + content opslaan
        console.log('[Upload] Stap 3 — Metadata opslaan in documents tabel');
        statusEl.textContent = 'Opslaan...';
        fillEl.style.width = '80%';

        var insertData = {
          tenant_id: tenantId,
          naam: file.name,
          bestandspad: filePath,
          geupload_door: profileId,
          content: extractedText || null,
          user_id: null
        };
        if (documenttype) insertData.documenttype = documenttype;
        if (revisiedatum) insertData.revisiedatum = revisiedatum;
        if (docMap) insertData.map = docMap;

        var insertResult = await supabaseClient
          .from('documents')
          .insert(insertData)
          .select('id')
          .single();

        console.log('[Upload] Insert resultaat:', insertResult.error ? 'FOUT: ' + insertResult.error.message : 'OK');

        if (insertResult.error) {
          statusEl.textContent = 'Metadata mislukt: ' + insertResult.error.message;
          statusEl.style.color = 'var(--error)';
          fillEl.style.width = '100%';
          fillEl.style.background = 'var(--error)';
          continue;
        }

        // Stap 4: Zoektermen genereren via Claude
        if (insertResult.data && insertResult.data.id && extractedText) {
          statusEl.textContent = 'Zoektermen genereren...';
          fillEl.style.width = '90%';
          try {
            var session = (await supabaseClient.auth.getSession()).data.session;
            var ztResponse = await fetch(SUPABASE_URL + '/functions/v1/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + session.access_token
              },
              body: JSON.stringify({ generate_zoektermen: true, document_id: insertResult.data.id })
            });
            var ztData = await ztResponse.json();
            console.log('[Upload] Zoektermen:', ztData.count || 0, 'voor', file.name);
          } catch (e) {
            console.error('[Upload] Zoektermen fout:', e);
          }
        }

        // Klaar
        console.log('[Upload] ✓ Voltooid:', file.name);
        statusEl.textContent = 'Gereed ✓';
        statusEl.style.color = 'var(--success)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--success)';

      } catch (err) {
        console.error('[Upload] Exception:', err);
        statusEl.textContent = 'Fout: ' + (err.message || 'onbekend');
        statusEl.style.color = 'var(--error)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--error)';
      }
    }

    // Direct lijst verversen
    console.log('[Upload] Klaar met alle bestanden, lijst verversen');
    await loadMappen();
    await loadDocuments();

    // Reset progress UI na 3 seconden
    setTimeout(function () {
      progress.classList.remove('show');
      itemsContainer.innerHTML = '';
    }, 3000);
  }

  async function loadDocuments() {
    console.log('[loadDocuments] Start, tenantId:', tenantId);
    var tbody = document.getElementById('documents-body');

    var result = await supabaseClient
      .from('documents')
      .select('id, naam, created_at, bestandspad, content, documenttype, revisiedatum, map, synoniemen, zoektermen')
      .eq('tenant_id', tenantId)
      .is('user_id', null)
      .order('created_at', { ascending: false });

    console.log('[loadDocuments] Resultaat:', result.error ? 'FOUT: ' + result.error.message : (result.data.length + ' documenten'));

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">Kon documenten niet laden.</td></tr>';
      return;
    }

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">Nog geen documenten geüpload.</td></tr>';
      var bannerEl = document.getElementById('reprocess-banner');
      if (bannerEl) bannerEl.style.display = 'none';
      var herinneringenEl = document.getElementById('revisie-herinneringen');
      if (herinneringenEl) herinneringenEl.innerHTML = '';
      return;
    }

    allDocuments = result.data;

    // Revisie herinneringen
    var herinneringenContainer = document.getElementById('revisie-herinneringen');
    if (herinneringenContainer) {
      var now = new Date();
      var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var prevMonth = prevMonthDate.getFullYear() + '-' + String(prevMonthDate.getMonth() + 1).padStart(2, '0');

      var herinneringen = result.data.filter(function (doc) {
        if (!doc.revisiedatum) return false;
        var docMonth = doc.revisiedatum.substring(0, 7);
        return docMonth === currentMonth || docMonth === prevMonth;
      });

      if (herinneringen.length > 0) {
        var html = '<div class="alert alert-warning show" style="margin-bottom:16px">' +
          '<strong>Revisie herinneringen:</strong><ul style="margin:8px 0 0 16px;padding:0">';
        herinneringen.forEach(function (doc) {
          var revisieDate = new Date(doc.revisiedatum).toLocaleDateString('nl-NL', {
            day: 'numeric', month: 'short', year: 'numeric'
          });
          var isPast = new Date(doc.revisiedatum) < now;
          var label = isPast ? ' (verlopen!)' : ' (binnenkort)';
          html += '<li>' + escapeHtml(doc.naam) + ' — revisiedatum: ' + revisieDate + label + '</li>';
        });
        html += '</ul></div>';
        herinneringenContainer.innerHTML = html;
      } else {
        herinneringenContainer.innerHTML = '';
      }
    }

    // Check of er documenten zonder content zijn
    var zonderContent = result.data.filter(function (doc) { return !doc.content; });
    var banner = document.getElementById('reprocess-banner');
    if (banner) {
      if (zonderContent.length > 0) {
        banner.style.display = 'block';
        document.getElementById('reprocess-message').textContent =
          zonderContent.length + ' document(en) zonder geëxtraheerde tekst. Klik hier om ze te verwerken.';
        banner.onclick = function () { reprocessDocuments(zonderContent); };
      } else {
        banner.style.display = 'none';
      }
    }

    // Activeer zoekfilter
    var searchInput = document.getElementById('doc-search');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = '1';
      searchInput.addEventListener('input', function () {
        var q = searchInput.value.trim().toLowerCase();
        var rows = tbody.querySelectorAll('tr');
        rows.forEach(function (tr) {
          var naam = tr.getAttribute('data-doc-naam') || '';
          tr.style.display = (q === '' || naam.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
        });
      });
    }

    // Groepeer documenten per map
    var grouped = {};
    result.data.forEach(function (doc) {
      var mapNaam = doc.map || 'Overig';
      if (!grouped[mapNaam]) grouped[mapNaam] = [];
      grouped[mapNaam].push(doc);
    });

    // Sorteer mappen: benoemde mappen eerst, Overig laatst
    var mapKeys = Object.keys(grouped).sort(function (a, b) {
      if (a === 'Overig') return 1;
      if (b === 'Overig') return -1;
      return a.localeCompare(b);
    });

    function renderDocRow(doc) {
      var datum = new Date(doc.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      var contentStatus = doc.content
        ? '<span style="color:var(--success);font-size:0.75rem" title="Tekst geëxtraheerd">✓</span>'
        : '<span style="color:var(--error);font-size:0.75rem" title="Geen tekst">✗</span>';
      var typeLabel = formatDocumentType(doc.documenttype);
      var revisieLabel = '-';
      if (doc.revisiedatum) {
        var color = getRevisieColor(doc.revisiedatum);
        var revisieFormatted = new Date(doc.revisiedatum).toLocaleDateString('nl-NL', {
          day: 'numeric', month: 'short', year: 'numeric'
        });
        revisieLabel = '<span style="color:' + color + ';font-weight:600">' + revisieFormatted + '</span>';
      }
      var synCount = (doc.synoniemen && doc.synoniemen.length) || 0;
      var zoekCount = (doc.zoektermen && doc.zoektermen.length) || 0;
      var synTitle = 'Synoniemen & afkortingen' + (synCount ? ' (' + synCount + ')' : '');
      var zoekIndicator = zoekCount > 0 ? '<span style="color:var(--success);font-size:0.7rem;margin-left:4px" title="' + zoekCount + ' zoektermen geïndexeerd">🔍' + zoekCount + '</span>' : '';
      return '<tr data-doc-naam="' + escapeHtml(doc.naam) + '" data-doc-id="' + doc.id + '" data-doc-pad="' + escapeHtml(doc.bestandspad) + '">' +
        '<td><input type="checkbox" class="doc-select-cb" value="' + doc.id + '" style="accent-color:var(--primary)" onchange="window.updateBulkBar()"></td>' +
        '<td>' + escapeHtml(doc.naam) + ' ' + contentStatus + zoekIndicator + '</td>' +
        '<td>' + typeLabel + '</td>' +
        '<td>' + revisieLabel + '</td>' +
        '<td>' + datum + '</td>' +
        '<td>' +
          '<button class="btn-icon" onclick="window.previewDocument(\'' + escapeHtml(doc.bestandspad) + '\')" title="Bekijken">👁️</button>' +
          '<button class="btn-icon" onclick="window.editDocument(\'' + doc.id + '\')" title="Bewerken">✏️</button>' +
          '<button class="btn-icon" onclick="window.editSynoniemen(\'' + doc.id + '\')" title="' + synTitle + '">🏷️' + (synCount ? '<sup style="font-size:0.6rem">' + synCount + '</sup>' : '') + '</button>' +
          '<button class="btn-icon btn-icon-danger" onclick="window.deleteDocument(\'' + doc.id + '\', \'' + escapeHtml(doc.bestandspad) + '\')" title="Verwijderen">🗑️</button>' +
        '</td>' +
        '</tr>';
    }

    // Lees ingeklapte mappen uit localStorage
    var ingeklapt = {};
    try { ingeklapt = JSON.parse(localStorage.getItem('wegwijzer_mappen_ingeklapt') || '{}'); } catch (e) {}

    var html = '';
    mapKeys.forEach(function (mapNaam) {
      var isIngeklapt = ingeklapt[mapNaam] === true;
      var icoon = isIngeklapt ? '📁' : '📂';
      html += '<tr class="map-header" data-map="' + escapeHtml(mapNaam) + '" style="cursor:pointer;user-select:none">' +
        '<td colspan="6" style="background:var(--bg);font-weight:700;font-size:0.85rem;color:var(--primary);padding:10px 12px;border-bottom:2px solid var(--primary)">' +
        '<span class="map-icoon">' + icoon + '</span> ' + escapeHtml(mapNaam) + ' (' + grouped[mapNaam].length + ')' +
        '</td></tr>';
      grouped[mapNaam].forEach(function (doc) {
        html += renderDocRow(doc).replace('<tr ', '<tr data-map-groep="' + escapeHtml(mapNaam) + '" ' + (isIngeklapt ? 'style="display:none" ' : '') );
      });
    });
    tbody.innerHTML = html;

    // Event delegation voor map headers
    if (!tbody.dataset.mapListenerBound) {
      tbody.dataset.mapListenerBound = '1';
      tbody.addEventListener('click', function (e) {
        var header = e.target.closest('.map-header');
        if (!header) return;
        var mapNaam = header.getAttribute('data-map');
        var rijen = tbody.querySelectorAll('tr[data-map-groep="' + mapNaam + '"]');
        var icoonEl = header.querySelector('.map-icoon');

        // Toggle
        var nuIngeklapt = rijen.length > 0 && rijen[0].style.display !== 'none';
        rijen.forEach(function (r) { r.style.display = nuIngeklapt ? 'none' : ''; });
        if (icoonEl) icoonEl.textContent = nuIngeklapt ? '📁' : '📂';

        // Sla staat op
        try {
          var staat = JSON.parse(localStorage.getItem('wegwijzer_mappen_ingeklapt') || '{}');
          staat[mapNaam] = nuIngeklapt;
          localStorage.setItem('wegwijzer_mappen_ingeklapt', JSON.stringify(staat));
        } catch (e) {}
      });
    }

    // Re-apply filter als er al een zoekterm is
    if (searchInput && searchInput.value.trim()) {
      searchInput.dispatchEvent(new Event('input'));
    }
  }

  // ---- Bulk selectie ----
  window.updateBulkBar = function () {
    var checked = document.querySelectorAll('.doc-select-cb:checked');
    var bar = document.getElementById('bulk-delete-bar');
    var btn = document.getElementById('bulk-delete-btn');
    var moveBar = document.getElementById('bulk-move-bar');
    if (checked.length > 0) {
      if (bar) { bar.style.display = ''; btn.textContent = 'Verwijder geselecteerde (' + checked.length + ')'; }
      if (moveBar) moveBar.style.display = '';
    } else {
      if (bar) bar.style.display = 'none';
      if (moveBar) moveBar.style.display = 'none';
    }
    var allCbs = document.querySelectorAll('.doc-select-cb');
    var selectAll = document.getElementById('doc-select-all');
    if (selectAll) selectAll.checked = allCbs.length > 0 && checked.length === allCbs.length;
  };

  (function initBulkSelect() {
    var selectAll = document.getElementById('doc-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        var cbs = document.querySelectorAll('.doc-select-cb');
        cbs.forEach(function (cb) { cb.checked = selectAll.checked; });
        window.updateBulkBar();
      });
    }

    var bulkBtn = document.getElementById('bulk-delete-btn');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', async function () {
        var checked = document.querySelectorAll('.doc-select-cb:checked');
        if (checked.length === 0) return;
        if (!confirm('Weet je zeker dat je ' + checked.length + ' document' + (checked.length > 1 ? 'en' : '') + ' wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;

        bulkBtn.disabled = true;
        bulkBtn.textContent = 'Verwijderen...';

        for (var i = 0; i < checked.length; i++) {
          var docId = checked[i].value;
          var row = checked[i].closest('tr');
          var pad = row ? row.getAttribute('data-doc-pad') : null;
          if (pad) {
            await supabaseClient.storage.from('documents').remove([pad]);
          }
          await supabaseClient.from('documents').delete().eq('id', docId);
        }

        bulkBtn.disabled = false;
        document.getElementById('bulk-delete-bar').style.display = 'none';
        if (selectAll) selectAll.checked = false;
        await loadDocuments();
      });
    }
  })();

  // Verwerk bestaande documenten zonder content
  async function reprocessDocuments(documents) {
    var banner = document.getElementById('reprocess-banner');
    var messageEl = document.getElementById('reprocess-message');
    var total = documents.length;
    var done = 0;

    messageEl.textContent = 'Verwerken: 0/' + total + '...';
    banner.onclick = null;

    for (var i = 0; i < documents.length; i++) {
      var doc = documents[i];
      messageEl.textContent = 'Verwerken: ' + (done + 1) + '/' + total + ' — ' + doc.naam;

      try {
        var downloadResult = await supabaseClient.storage
          .from('documents')
          .download(doc.bestandspad);

        if (downloadResult.error || !downloadResult.data) {
          done++;
          continue;
        }

        var text = await extractTextFromBlob(downloadResult.data, doc.naam);

        if (text && text.trim().length > 0) {
          await supabaseClient
            .from('documents')
            .update({ content: text })
            .eq('id', doc.id);
        }
      } catch (err) {
        console.error('Verwerking mislukt voor:', doc.naam, err);
      }

      done++;
    }

    messageEl.textContent = 'Klaar! ' + done + ' document(en) verwerkt.';
    setTimeout(function () {
      banner.style.display = 'none';
      loadDocuments();
    }, 2000);
  }

  window.previewDocument = async function (bestandspad) {
    var result = await supabaseClient.storage
      .from('documents')
      .createSignedUrl(bestandspad, 3600);

    if (result.error || !result.data) {
      alert('Kon document niet openen.');
      return;
    }

    window.open(result.data.signedUrl, '_blank');
  };

  window.deleteDocument = async function (id, bestandspad) {
    if (!confirm('Weet je zeker dat je dit document wilt verwijderen?')) return;

    await supabaseClient.storage.from('documents').remove([bestandspad]);
    await supabaseClient.from('documents').delete().eq('id', id);

    loadDocuments();
  };

  // ---- Kennissuggesties (proactieve scan) ----
  // Parse de gestructureerde omschrijving die de scan genereert.
  // Format: "{titel}\n\nUITLEG: {2-3 zinnen}\n\nAANBEVELING: {1 zin}"
  // Backwards-compatible: oude items zonder UITLEG/AANBEVELING worden
  // volledig als titel teruggegeven (uitleg en aanbeveling leeg).
  // STAAT OP MODULE SCOPE — wordt zowel door renderGroep als door
  // window.notitieSuggestie aangeroepen.
  function parseSuggestieOmschrijving(raw) {
    var result = { titel: '', uitleg: '', aanbeveling: '' };
    if (!raw) return result;
    var tekst = String(raw);

    var uitlegMatch = tekst.match(/(?:^|\n)\s*UITLEG:\s*([\s\S]*?)(?=\n\s*AANBEVELING:|$)/i);
    var aanbevelingMatch = tekst.match(/(?:^|\n)\s*AANBEVELING:\s*([\s\S]*?)$/i);

    if (uitlegMatch) {
      result.titel = tekst.substring(0, uitlegMatch.index).trim();
      result.uitleg = uitlegMatch[1].trim();
      if (aanbevelingMatch) result.aanbeveling = aanbevelingMatch[1].trim();
    } else if (aanbevelingMatch) {
      // Edge case: alleen AANBEVELING zonder UITLEG
      result.titel = tekst.substring(0, aanbevelingMatch.index).trim();
      result.aanbeveling = aanbevelingMatch[1].trim();
    } else {
      // Geen rich format → hele tekst is de titel (oude items)
      result.titel = tekst.trim();
    }
    return result;
  }

  async function loadKennissuggesties() {
    var conflictenContainer = document.getElementById('ks-conflicten-lijst');
    var hiatenContainer = document.getElementById('ks-hiaten-lijst');
    var suggestiesContainer = document.getElementById('ks-suggesties-lijst');
    if (!conflictenContainer || !hiatenContainer || !suggestiesContainer) {
      console.warn('[Kennissuggesties] container(s) ontbreken in DOM');
      return;
    }

    var result = await supabaseClient
      .from('kennissuggesties')
      .select('*')
      .eq('tenant_id', tenantId)
      .neq('status', 'niet_relevant')
      .order('aangemaakt_op', { ascending: false });

    if (result.error) {
      console.error('[Kennissuggesties] query fout:', result.error);
    }
    var data = result.data || [];
    // Cache vullen voor lookup vanuit notitieSuggestie etc.
    suggestiesCache = {};
    data.forEach(function (s) { suggestiesCache[s.id] = s; });

    // Haal actieve kennisnotities op zodat we ze persistent kunnen tonen
    // onder de matchende suggestie-cards (op basis van originele_vraag === titel).
    var notitiesPerTitel = {};
    var notitiesResult = await supabaseClient
      .from('kennisnotities')
      .select('id, originele_vraag, notitie, created_at')
      .eq('tenant_id', tenantId)
      .eq('actief', true)
      .order('created_at', { ascending: false });
    if (notitiesResult.data) {
      notitiesResult.data.forEach(function (kn) {
        var key = (kn.originele_vraag || '').trim();
        if (!notitiesPerTitel[key]) notitiesPerTitel[key] = [];
        notitiesPerTitel[key].push(kn);
      });
    }
    console.log('[Kennissuggesties] geladen:', data.length, 'items',
      'conflicten:', data.filter(function (s) { return s.type === 'conflict'; }).length,
      'hiaten:', data.filter(function (s) { return s.type === 'hiaat'; }).length,
      'suggesties:', data.filter(function (s) { return s.type === 'suggestie'; }).length);

    // Badge: alleen nieuwe items
    var nieuw = data.filter(function (s) { return s.status === 'nieuw'; }).length;
    updateTabBadge('kennissuggesties', nieuw);

    function renderGroep(items, container, icoon) {
      if (items.length === 0) {
        container.innerHTML = '<p class="no-data" style="font-size:0.85rem">Geen items.</p>';
        return;
      }
      container.innerHTML = items.map(function (s) {
        var datum = new Date(s.aangemaakt_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
        var parsed = parseSuggestieOmschrijving(s.omschrijving);

        var docs = '';
        if (s.document_a) docs += '<span style="font-size:0.72rem;color:var(--text-muted)"> 📄 ' + escapeHtml(s.document_a) + '</span>';
        if (s.document_b) docs += '<span style="font-size:0.72rem;color:var(--text-muted)"> ↔ ' + escapeHtml(s.document_b) + '</span>';
        var docsHtml = docs ? '<div style="margin-top:2px">' + docs + '</div>' : '';

        var uitlegHtml = parsed.uitleg
          ? '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;line-height:1.5;display:flex;gap:6px"><span aria-hidden="true">📝</span><span>' + escapeHtml(parsed.uitleg) + '</span></div>'
          : '';
        var aanbevelingHtml = parsed.aanbeveling
          ? '<div style="font-size:0.8rem;font-weight:600;margin-top:6px;line-height:1.5;display:flex;gap:6px"><span aria-hidden="true">💡</span><span>' + escapeHtml(parsed.aanbeveling) + '</span></div>'
          : '';

        var statusClass = s.status === 'opgepakt' ? 'badge-success' : 'badge-warning';
        var opacity = s.status === 'opgepakt' ? 'opacity:0.6;' : '';
        var notitieHtml = s.notitie ? '<div style="font-size:0.75rem;font-style:italic;margin-top:6px;color:var(--text-muted)">💬 ' + escapeHtml(s.notitie) + '</div>' : '';

        // Persistente kennisnotities die bij deze suggestie horen (match op titel === originele_vraag).
        // Zorgt dat een opgeslagen notitie zichtbaar blijft in de card, niet alleen onder Verbeterpunten.
        var ownNotities = notitiesPerTitel[parsed.titel.trim()] || [];
        var ownNotitiesHtml = '';
        if (ownNotities.length > 0) {
          ownNotitiesHtml = ownNotities.map(function (kn) {
            var knDatum = new Date(kn.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            return '<div style="font-size:0.78rem;background:#F0FFF4;border-left:3px solid var(--success);padding:8px 10px;margin-top:8px;border-radius:4px;line-height:1.5">' +
              '<div style="font-weight:600;color:var(--success);margin-bottom:2px">📝 Notitie opgeslagen <span style="font-weight:400;color:var(--text-muted);font-size:0.72rem">' + knDatum + '</span></div>' +
              '<div style="color:var(--text);white-space:pre-wrap">' + escapeHtml(kn.notitie) + '</div>' +
              '</div>';
          }).join('');
        }

        return '<div class="kennisbank-item" style="margin-bottom:8px;' + opacity + '" data-suggestie-id="' + s.id + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;gap:12px">' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-size:0.9rem;font-weight:600">' + icoon + ' ' + escapeHtml(parsed.titel) + '</div>' +
          docsHtml +
          uitlegHtml +
          aanbevelingHtml +
          ownNotitiesHtml +
          '<div style="margin-top:8px">' +
            '<span class="badge ' + statusClass + '" style="font-size:0.7rem">' + (s.status === 'opgepakt' ? 'Opgepakt' : 'Nieuw') + '</span>' +
            '<span style="font-size:0.7rem;color:var(--text-muted);margin-left:6px">' + datum + ' • ' + (s.scan_type === 'grondig' ? 'grondige' : 'snelle') + ' scan</span>' +
          '</div>' +
          notitieHtml +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
          (s.status === 'nieuw'
            ? '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto" onclick="window.markeerSuggestie(\'' + s.id + '\', \'opgepakt\')" title="Opgepakt">✅ Opgepakt</button>'
            : '') +
          '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto" onclick="window.markeerSuggestie(\'' + s.id + '\', \'niet_relevant\')" title="Niet relevant">❌ Niet relevant</button>' +
          '<button type="button" class="btn btn-secondary notitie-suggestie-btn" data-suggestie-id="' + s.id + '" style="padding:4px 8px;font-size:0.7rem;width:auto" title="Notitie">💬 Notitie</button>' +
          '<button class="btn-icon btn-icon-danger" onclick="window.deleteSuggestie(\'' + s.id + '\')" title="Verwijderen">🗑️</button>' +
          '</div></div></div>';
      }).join('');
    }

    renderGroep(data.filter(function (s) { return s.type === 'conflict'; }), conflictenContainer, '🔴');
    renderGroep(data.filter(function (s) { return s.type === 'hiaat'; }), hiatenContainer, '🟡');
    renderGroep(data.filter(function (s) { return s.type === 'suggestie'; }), suggestiesContainer, '🟢');
  }

  window.markeerSuggestie = async function (id, status) {
    await supabaseClient.from('kennissuggesties').update({ status: status }).eq('id', id);
    loadKennissuggesties();
  };

  window.deleteSuggestie = async function (id) {
    if (!confirm('Suggestie verwijderen?')) return;
    console.log('[DELETE suggestie] Verwijder id:', id);
    var result = await supabaseClient
      .from('kennissuggesties')
      .delete()
      .eq('id', id)
      .select();
    console.log('[DELETE suggestie] Response:', result.error, 'rows:', result.data);
    if (result.error) {
      alert('Verwijderen mislukt: ' + result.error.message);
      return;
    }
    if (!result.data || result.data.length === 0) {
      alert('Geen rij verwijderd — mogelijk een rechten-issue. Check console.');
      return;
    }
    loadKennissuggesties();
  };

  // Notitie bij een kennissuggestie — slaat op in de kennisnotities tabel
  // (zelfde flow als window.openKennisnotitie voor verbeterpunten).
  window.notitieSuggestie = function (id) {
    var card = document.querySelector('[data-suggestie-id="' + id + '"]');
    if (!card) {
      console.error('[notitieSuggestie] suggestie card niet gevonden voor id', id);
      return;
    }
    // Bestaande inline form van een andere suggestie sluiten
    var bestaand = document.getElementById('suggestie-notitie-form');
    if (bestaand) bestaand.remove();

    var s = suggestiesCache[id];
    if (!s) {
      console.error('[notitieSuggestie] suggestie niet in cache voor id', id);
      return;
    }
    var parsed = parseSuggestieOmschrijving(s.omschrijving);
    var titel = parsed.titel || (s.omschrijving || '').substring(0, 200);

    var form = document.createElement('div');
    form.id = 'suggestie-notitie-form';
    form.style.cssText = 'margin-top:10px;padding:12px;background:#F0FFF4;border:1px solid #C6F6D5;border-radius:8px';
    form.innerHTML =
      '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">Notitie bij: <strong>' + escapeHtml(titel) + '</strong></div>' +
      '<textarea id="sug-kn-tekst" placeholder="Schrijf een korte notitie (max 500 tekens)..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:var(--font);font-size:0.85rem;resize:vertical;min-height:60px" maxlength="500"></textarea>' +
      '<div id="sug-kn-bevestiging" style="display:none;color:var(--success);font-size:0.78rem;margin-top:6px">✓ Notitie opgeslagen</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn btn-primary" id="sug-kn-opslaan" style="width:auto;padding:6px 14px;font-size:0.8rem">Opslaan als kennisnotitie</button>' +
      '<button class="btn btn-secondary" id="sug-kn-annuleer" style="width:auto;padding:6px 14px;font-size:0.8rem">Annuleren</button>' +
      '</div>';

    card.appendChild(form);
    var textarea = form.querySelector('#sug-kn-tekst');
    textarea.focus();

    form.querySelector('#sug-kn-annuleer').addEventListener('click', function () { form.remove(); });

    form.querySelector('#sug-kn-opslaan').addEventListener('click', async function () {
      var tekst = textarea.value.trim();
      if (!tekst) { alert('Vul een notitie in.'); return; }

      var opslaanBtn = form.querySelector('#sug-kn-opslaan');
      opslaanBtn.disabled = true;
      opslaanBtn.textContent = 'Opslaan...';

      var insertResult = await supabaseClient.from('kennisnotities').insert({
        tenant_id: tenantId,
        originele_vraag: titel,
        notitie: tekst.substring(0, 500),
        aangemaakt_door: currentUserId
      }).select();

      console.log('[notitieSuggestie] Insert response:', insertResult.error, 'rows:', insertResult.data);

      if (insertResult.error) {
        alert('Notitie opslaan mislukt: ' + insertResult.error.message);
        opslaanBtn.disabled = false;
        opslaanBtn.textContent = 'Opslaan als kennisnotitie';
        return;
      }

      // Form sluiten en kennissuggesties + verbeterpunten opnieuw renderen.
      // Door loadKennissuggesties() opnieuw uit te voeren, leest renderGroep
      // de zojuist toegevoegde kennisnotitie en toont hem persistent als
      // groen "📝 Notitie opgeslagen" blok onder de matchende suggestie-card.
      form.remove();
      await loadKennissuggesties();
      if (typeof loadKennisnotities === 'function') loadKennisnotities();
    });
  };

  function initKennisScanBtns() {
    var snelBtn = document.getElementById('ks-snelle-scan-btn');
    var grondigBtn = document.getElementById('ks-grondige-scan-btn');
    var mappenSelectie = document.getElementById('ks-mappen-selectie');
    var mappenContainer = document.getElementById('ks-mappen-checkboxes');
    var selectAll = document.getElementById('ks-select-all');
    var startGrondig = document.getElementById('ks-start-grondig-btn');
    var cancelGrondig = document.getElementById('ks-cancel-grondig-btn');
    var statusEl = document.getElementById('ks-status');
    var progressEl = document.getElementById('ks-progress');
    var progressFill = document.getElementById('ks-progress-fill');

    if (!snelBtn || !grondigBtn) return;

    async function runScan(type, mappen) {
      statusEl.textContent = (type === 'snel' ? '⚡ Snelle scan' : '🔍 Grondige scan') + ' loopt... Dit kan even duren.';
      progressEl.style.display = 'block';
      progressFill.style.width = '50%';

      try {
        var session = (await supabaseClient.auth.getSession()).data.session;
        var resp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
          body: JSON.stringify({ kennis_scan: true, scan_type: type, mappen: mappen || [] })
        });
        var data = await resp.json();
        progressFill.style.width = '100%';
        if (data.error) {
          statusEl.textContent = '❌ Fout: ' + data.error;
          statusEl.style.color = 'var(--error)';
        } else {
          statusEl.textContent = '✓ Klaar: ' + (data.count || 0) + ' suggesties gevonden';
          statusEl.style.color = 'var(--success)';
          loadKennissuggesties();
        }
      } catch (e) {
        statusEl.textContent = '❌ Fout: ' + (e.message || 'onbekend');
        statusEl.style.color = 'var(--error)';
      }
      setTimeout(function () {
        progressEl.style.display = 'none';
        progressFill.style.width = '0%';
      }, 2000);
    }

    snelBtn.addEventListener('click', function () { runScan('snel'); });

    grondigBtn.addEventListener('click', function () {
      // Toon mappen selectie
      var mappen = {};
      (allDocuments || []).forEach(function (d) {
        var m = d.map || 'Overig';
        mappen[m] = (mappen[m] || 0) + 1;
      });
      var keys = Object.keys(mappen).sort();
      mappenContainer.innerHTML = keys.map(function (m) {
        return '<label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer">' +
          '<input type="checkbox" class="ks-map-cb" value="' + escapeHtml(m) + '"> ' +
          escapeHtml(m) + ' (' + mappen[m] + ')</label>';
      }).join('');
      mappenSelectie.style.display = 'block';
    });

    selectAll.addEventListener('change', function () {
      var cbs = mappenContainer.querySelectorAll('.ks-map-cb');
      cbs.forEach(function (cb) { cb.checked = selectAll.checked; });
    });

    cancelGrondig.addEventListener('click', function () {
      mappenSelectie.style.display = 'none';
    });

    startGrondig.addEventListener('click', function () {
      var checked = Array.prototype.slice.call(mappenContainer.querySelectorAll('.ks-map-cb:checked'));
      if (checked.length === 0) {
        alert('Selecteer minstens één map.');
        return;
      }
      var mappen = checked.map(function (cb) { return cb.value; });
      mappenSelectie.style.display = 'none';
      runScan('grondig', mappen);
    });
  }

  // ---- Herindexeer alle documenten ----
  function initHerindexeerBtn() {
    var btn = document.getElementById('herindexeer-btn');
    var statusEl = document.getElementById('herindexeer-status');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      if (!allDocuments || allDocuments.length === 0) {
        alert('Geen documenten om te indexeren.');
        return;
      }
      if (!confirm('Alle ' + allDocuments.length + ' documenten herindexeren via Claude? Dit kan een paar minuten duren.')) return;

      btn.disabled = true;
      var session = (await supabaseClient.auth.getSession()).data.session;
      var token = session.access_token;
      var totaal = allDocuments.length;
      var gedaan = 0;
      var fouten = 0;

      for (var i = 0; i < allDocuments.length; i++) {
        var doc = allDocuments[i];
        if (!doc.content) { gedaan++; continue; }
        statusEl.textContent = (gedaan + 1) + ' van ' + totaal + ' documenten geïndexeerd...';
        try {
          var resp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ generate_zoektermen: true, document_id: doc.id })
          });
          var data = await resp.json();
          if (data.error) fouten++;
        } catch (e) {
          fouten++;
        }
        gedaan++;
      }

      statusEl.textContent = '✓ Klaar: ' + gedaan + ' verwerkt, ' + fouten + ' fouten';
      btn.disabled = false;
      await loadDocuments();
    });
  }

  // ---- Synoniemen & afkortingen per document ----
  window.editSynoniemen = async function (docId) {
    var doc = allDocuments.find(function (d) { return d.id === docId; });
    if (!doc) return;
    var huidige = (doc.synoniemen || []).join(', ');
    var nieuwe = prompt('Synoniemen & afkortingen voor "' + doc.naam + '"\n\nVoeg synoniemen toe, gescheiden door komma\'s.\nVoorbeeld: O&O, Ontwikkelingstraject, OenO', huidige);
    if (nieuwe === null) return;

    var arr = nieuwe.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    var result = await supabaseClient.from('documents').update({ synoniemen: arr }).eq('id', docId);
    if (result.error) {
      alert('Opslaan mislukt: ' + result.error.message);
      return;
    }
    loadDocuments();
  };

  // ---- Document bewerken ----
  window.editDocument = function (docId) {
    var doc = allDocuments.find(function (d) { return d.id === docId; });
    if (!doc) return;

    document.getElementById('edit-doc-id').value = doc.id;
    document.getElementById('edit-doc-naam').value = doc.naam || '';
    document.getElementById('edit-doc-type').value = doc.documenttype || 'overig';
    document.getElementById('edit-doc-revisie').value = doc.revisiedatum || '';
    var editMapEl = document.getElementById('edit-doc-map');
    if (editMapEl) editMapEl.value = doc.map || '';

    var alertBox = document.getElementById('edit-doc-alert');
    if (alertBox) alertBox.className = 'alert';

    document.getElementById('modal-edit-document').classList.add('show');
  };

  function initEditDocModal() {
    var modal = document.getElementById('modal-edit-document');
    if (!modal) return;
    var form = document.getElementById('edit-doc-form');
    var cancelBtn = document.getElementById('edit-doc-cancel-btn');
    var submitBtn = document.getElementById('edit-doc-submit-btn');
    var alertBox = document.getElementById('edit-doc-alert');
    var alertMsg = document.getElementById('edit-doc-alert-message');

    cancelBtn.addEventListener('click', function () {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var docId = document.getElementById('edit-doc-id').value;
      var naam = document.getElementById('edit-doc-naam').value.trim();
      var documenttype = document.getElementById('edit-doc-type').value;
      // versienummer verwijderd
      var revisiedatum = document.getElementById('edit-doc-revisie').value || null;
      var editMapVal = document.getElementById('edit-doc-map');
      var mapValue = editMapVal ? editMapVal.value || null : null;

      if (!naam) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Documentnaam is verplicht.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Opslaan...';

      var result = await supabaseClient
        .from('documents')
        .update({
          naam: naam,
          documenttype: documenttype,
          revisiedatum: revisiedatum,
          map: mapValue
        })
        .eq('id', docId);

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Opslaan mislukt: ' + result.error.message;
      } else {
        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Document bijgewerkt.';
        loadMappen();
        loadDocuments();
        setTimeout(function () {
          modal.classList.remove('show');
        }, 1000);
      }

      submitBtn.disabled = false;
      submitBtn.textContent = 'Opslaan';
    });
  }

  // =============================================
  // MEDEWERKERS
  // =============================================
  async function loadMedewerkers() {
    var tbody = document.getElementById('medewerkers-body');

    var result = await supabaseClient
      .from('profiles')
      .select('id, naam, email, role, functiegroep, startdatum, user_id, inwerktraject_url, werkuren, afdeling, account_type, einddatum, teams, teamleider_naam, inwerken_afgerond')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="9" class="no-data">Kon medewerkers niet laden.</td></tr>';
      return;
    }

    allProfiles = result.data;

    // Debug: toon admin profiel data
    result.data.forEach(function (p) {
      if (p.role === 'admin') {
        console.log('[DEBUG] Admin profiel uit profiles tabel:', JSON.stringify({ id: p.id, email: p.email, naam: p.naam, role: p.role, user_id: p.user_id }));
      }
    });

    updateMedewerkerFilter();

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="no-data">Nog geen medewerkers.</td></tr>';
      return;
    }

    // Sorteer: actieve accounts eerst, verlopen tijdelijke accounts onderaan
    var now = new Date();
    var sorted = result.data.slice().sort(function (a, b) {
      var aExpired = a.einddatum && new Date(a.einddatum) < now;
      var bExpired = b.einddatum && new Date(b.einddatum) < now;
      if (aExpired && !bExpired) return 1;
      if (!aExpired && bExpired) return -1;
      return 0;
    });

    tbody.innerHTML = sorted.map(function (p) {
      var fg = formatFunctiegroep(p.functiegroep);
      var sd = p.startdatum ? new Date(p.startdatum).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      }) : '-';

      var isExpired = p.einddatum && new Date(p.einddatum) < now;
      var rowStyle = isExpired ? ' style="opacity:0.5"' : '';

      var badge = '';
      if (p.role === 'admin') {
        badge = '<span class="badge badge-admin">Admin</span>';
      } else if (p.account_type === 'tijdelijk') {
        badge = '<span class="badge badge-medewerker" style="background:#ff9800;color:#fff">Tijdelijk</span>';
      } else {
        badge = '<span class="badge badge-medewerker">Medewerker</span>';
      }

      var teamsStr = '-';
      if (p.teams && Array.isArray(p.teams) && p.teams.length > 0) {
        teamsStr = p.teams.join(', ');
      }

      var editBtn = p.role !== 'admin'
        ? '<button class="btn-icon" onclick="window.editMedewerker(\'' + p.id + '\')" title="Bewerken">✏️</button>'
        : '';
      var deleteBtn = p.role !== 'admin'
        ? '<button class="btn-icon btn-icon-danger" onclick="window.deleteMedewerker(\'' + p.id + '\', \'' + p.user_id + '\')" title="Verwijderen">🗑️</button>'
        : '';
      var docsBtn = p.role !== 'admin'
        ? '<button class="btn-icon" onclick="window.showPersoonlijkeDocs(\'' + p.id + '\', \'' + escapeHtml(p.naam || p.email) + '\')" title="Persoonlijke documenten">📄</button>'
        : '';
      var inwerkBtn = (p.role === 'medewerker' && !p.inwerken_afgerond)
        ? '<button class="btn-icon" onclick="window.sluitInwerktrajectAf(\'' + p.id + '\', \'' + escapeHtml(p.naam) + '\')" title="Inwerktraject afsluiten" style="color:var(--success)">✅</button>'
        : '';

      return '<tr' + rowStyle + '>' +
        '<td>' + escapeHtml(p.naam || '-') + ' ' + badge + '</td>' +
        '<td>' + escapeHtml(p.email) + '</td>' +
        '<td class="functiegroep-label">' + fg + '</td>' +
        '<td>' + escapeHtml(teamsStr) + '</td>' +
        '<td>' + escapeHtml(p.afdeling || '-') + '</td>' +
        '<td>' + escapeHtml(p.werkuren || '-') + '</td>' +
        '<td>' + escapeHtml(p.teamleider_naam || '-') + '</td>' +
        '<td>' + sd + '</td>' +
        '<td>' + editBtn + docsBtn + inwerkBtn + deleteBtn + '</td>' +
        '</tr>';
    }).join('');
  }

  function updateMedewerkerFilter() {
    var select = document.getElementById('filter-medewerker');
    var current = select.value;
    select.innerHTML = '<option value="">Alle medewerkers</option>';
    allProfiles
      .filter(function (p) { return p.role === 'medewerker'; })
      .forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.naam || p.email;
        select.appendChild(opt);
      });
    select.value = current;
  }

  window.sluitInwerktrajectAf = async function (profileId, naam) {
    if (!confirm('Wil je het inwerktraject van ' + naam + ' afsluiten? De medewerker wordt direct in kennisassistent modus gezet.')) return;

    await supabaseClient
      .from('profiles')
      .update({ inwerken_afgerond: true })
      .eq('id', profileId);

    loadMedewerkers();
  };

  window.deleteMedewerker = async function (profileId, userId) {
    if (!confirm('Weet je zeker dat je deze medewerker wilt verwijderen? Dit verwijdert ook alle gesprekken en het account.')) return;

    // Verwijder profiel (cascade verwijdert conversations)
    await supabaseClient.from('profiles').delete().eq('id', profileId);

    // Verwijder auth account permanent via Edge Function
    if (userId) {
      try {
        var session = await supabaseClient.auth.getSession();
        var token = session.data.session.access_token;
        var delResponse = await fetch(SUPABASE_URL + '/functions/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ delete_user: true, delete_user_id: userId })
        });
        var delData = await delResponse.json();
        console.log('[Delete] Auth account:', delData.deleted ? 'verwijderd' : 'fout: ' + (delData.error || ''));
      } catch (err) {
        console.error('[Delete] Auth verwijdering mislukt:', err);
      }
    }

    loadMedewerkers();
    loadGesprekken();
    loadStatistieken();
  };

  // =============================================
  // PERSOONLIJKE DOCUMENTEN
  // =============================================
  window.showPersoonlijkeDocs = function (profileId, naam) {
    var section = document.getElementById('persoonlijke-docs-section');
    if (section) {
      section.style.display = 'block';
      var titleEl = document.getElementById('pers-docs-title');
      if (titleEl) titleEl.textContent = 'Persoonlijke documenten — ' + naam;
      section.dataset.profileId = profileId;
      loadPersoonlijkeDocs(profileId);
      initPersoonlijkeDocsUpload(profileId);
    }
  };

  async function loadPersoonlijkeDocs(profileId) {
    var listEl = document.getElementById('pers-docs-list');
    if (!listEl) return;

    var result = await supabaseClient
      .from('documents')
      .select('id, naam, created_at, bestandspad')
      .eq('tenant_id', tenantId)
      .eq('user_id', profileId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data || result.data.length === 0) {
      listEl.innerHTML = '<p class="no-data">Geen persoonlijke documenten.</p>';
      return;
    }

    listEl.innerHTML = result.data.map(function (doc) {
      var datum = new Date(doc.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      return '<div class="pers-doc-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span>' + escapeHtml(doc.naam) + ' <small style="color:var(--text-muted)">' + datum + '</small></span>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deletePersoonlijkDoc(\'' + doc.id + '\', \'' + escapeHtml(doc.bestandspad) + '\', \'' + profileId + '\')" title="Verwijderen">🗑️</button>' +
        '</div>';
    }).join('');
  }

  function initPersoonlijkeDocsUpload(profileId) {
    var zone = document.getElementById('pers-docs-upload');
    var input = document.getElementById('pers-docs-input');
    if (!zone || !input) return;

    // Clone to remove old listeners
    var newZone = zone.cloneNode(true);
    zone.parentNode.replaceChild(newZone, zone);
    var newInput = newZone.querySelector('#pers-docs-input') || document.getElementById('pers-docs-input');

    newZone.addEventListener('click', function () { newInput.click(); });

    newZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      newZone.classList.add('drag-over');
    });

    newZone.addEventListener('dragleave', function () {
      newZone.classList.remove('drag-over');
    });

    newZone.addEventListener('drop', function (e) {
      e.preventDefault();
      newZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handlePersoonlijkeUpload(e.dataTransfer.files, profileId);
      }
    });

    newInput.addEventListener('change', function () {
      if (newInput.files.length > 0) {
        handlePersoonlijkeUpload(newInput.files, profileId);
        newInput.value = '';
      }
    });
  }

  async function handlePersoonlijkeUpload(files, profileId) {
    var uploaderProfileResult = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('user_id', window.wegwijzerUser.id)
      .single();
    var uploaderProfileId = uploaderProfileResult.data ? uploaderProfileResult.data.id : null;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var ext = file.name.split('.').pop().toLowerCase();

      if (!['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx'].includes(ext)) continue;
      if (file.size > 20 * 1024 * 1024) continue;

      var extractedText = '';
      try {
        extractedText = await extractTextFromFile(file);
      } catch (err) {
        console.error('Extractie fout:', err);
      }

      var fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var filePath = tenantId + '/persoonlijk/' + profileId + '/' + fileName;

      try {
        var uploadResult = await supabaseClient.storage
          .from('documents')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });

        if (uploadResult.error) continue;

        await supabaseClient
          .from('documents')
          .insert({
            tenant_id: tenantId,
            naam: file.name,
            bestandspad: filePath,
            geupload_door: uploaderProfileId,
            content: extractedText || null,
            user_id: profileId
          });
      } catch (err) {
        console.error('Persoonlijke upload fout:', err);
      }
    }

    loadPersoonlijkeDocs(profileId);
  }

  window.deletePersoonlijkDoc = async function (id, bestandspad, profileId) {
    if (!confirm('Weet je zeker dat je dit document wilt verwijderen?')) return;

    await supabaseClient.storage.from('documents').remove([bestandspad]);
    await supabaseClient.from('documents').delete().eq('id', id);

    loadPersoonlijkeDocs(profileId);
  };

  // =============================================
  // INVITE MODAL
  // =============================================
  function initInviteModal() {
    var modal = document.getElementById('modal-medewerker');
    var form = document.getElementById('invite-form');
    var cancelBtn = document.getElementById('modal-cancel-btn');
    var addBtn = document.getElementById('add-medewerker-btn');
    var submitBtn = document.getElementById('modal-submit-btn');
    var alertBox = document.getElementById('modal-alert');
    var alertMsg = document.getElementById('modal-alert-message');

    // Populate team checkboxes en teamleider dropdown
    populateTeamCheckboxes('invite-teams', []);
    populateTeamleiderDropdown('invite-teamleider', '', 'teamleider');
    populateTeamleiderDropdown('invite-manager', '', 'manager');

    // Account type radio toggle einddatum
    var accountRadios = document.querySelectorAll('input[name="invite-account-type"]');
    var einddatumEl = document.getElementById('invite-einddatum');
    var einddatumGroup = einddatumEl ? einddatumEl.closest('.form-group') : null;
    if (einddatumGroup) {
      einddatumGroup.style.display = 'none';
    }
    accountRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (einddatumGroup) {
          einddatumGroup.style.display = radio.value === 'tijdelijk' ? 'block' : 'none';
        }
      });
    });

    addBtn.addEventListener('click', function () {
      form.reset();
      alertBox.className = 'alert';
      populateTeamCheckboxes('invite-teams', []);
      if (einddatumGroup) einddatumGroup.style.display = 'none';
      // Reset dynamische velden naar situatie C (geen functiegroep)
      updateFormFields('invite', '');
      modal.classList.add('show');
    });

    cancelBtn.addEventListener('click', function () {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var naam = document.getElementById('invite-naam').value.trim();
      var email = document.getElementById('invite-email').value.trim();
      var functiegroep = document.getElementById('invite-functiegroep').value;
      var startdatum = document.getElementById('invite-startdatum').value;
      var inwerktrajectUrl = document.getElementById('invite-inwerktraject-url').value.trim();
      var werkuren = document.getElementById('invite-werkuren').value.trim();
      var afdeling = document.getElementById('invite-afdeling').value.trim();

      // Nieuwe velden
      var accountTypeEl = document.querySelector('input[name="invite-account-type"]:checked');
      var accountType = accountTypeEl ? accountTypeEl.value : 'vast';
      var einddatum = document.getElementById('invite-einddatum').value || null;
      var teams = getCheckedTeams('invite-teams');
      var teamleiderNaam = document.getElementById('invite-teamleider').value || null;
      var managerNaam = document.getElementById('invite-manager').value || null;
      // Gebruik manager als leidinggevende als dat ingevuld is
      if (managerNaam && !teamleiderNaam) teamleiderNaam = managerNaam;

      if (!naam || !email || !functiegroep) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Vul alle verplichte velden in.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Even geduld...';

      try {
        // Uitnodiging via Edge Function (service role key) met 10s timeout
        console.log('[Invite] Start voor:', email);
        var session = await supabaseClient.auth.getSession();
        if (!session.data.session) {
          alertBox.className = 'alert alert-error show';
          alertMsg.textContent = 'Sessie verlopen. Log opnieuw in.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }
        var token = session.data.session.access_token;

        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 30000);

        var inviteResponse;
        try {
          inviteResponse = await fetch(SUPABASE_URL + '/functions/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            signal: controller.signal,
            body: JSON.stringify({
              invite_user: true,
              invite_email: email,
              invite_naam: naam,
              invite_role: 'medewerker',
              invite_functiegroep: functiegroep,
              redirect_url: window.location.origin + appUrl('wachtwoord-instellen.html')
            })
          });
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          console.error('[Invite] Fetch fout:', fetchErr.name, fetchErr.message);
          alertBox.className = 'alert alert-error show';
          if (fetchErr.name === 'AbortError') {
            alertMsg.textContent = 'Uitnodiging kon niet worden verstuurd — timeout na 30 seconden. Controleer of het emailadres correct is.';
          } else {
            alertMsg.textContent = 'Verbindingsfout: ' + fetchErr.message;
          }
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }
        clearTimeout(timeoutId);

        console.log('[Invite] HTTP status:', inviteResponse.status);
        var inviteText = await inviteResponse.text();
        console.log('[Invite] Ruwe response:', inviteText.substring(0, 500));

        if (inviteResponse.status === 404) {
          alertBox.className = 'alert alert-error show';
          alertMsg.textContent = 'Profiel niet gevonden. Mogelijk zijn database migraties niet uitgevoerd.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }

        if (inviteResponse.status === 403) {
          alertBox.className = 'alert alert-error show';
          alertMsg.textContent = 'Niet geautoriseerd. Log opnieuw in als admin.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }

        var inviteData;
        try {
          inviteData = JSON.parse(inviteText);
        } catch (parseErr) {
          console.error('[Invite] JSON parse fout:', parseErr.message);
          alertBox.className = 'alert alert-error show';
          alertMsg.textContent = 'Server gaf onverwacht antwoord (status ' + inviteResponse.status + '). Check de console.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }

        if (inviteData.error) {
          console.error('[Invite] Server fout:', inviteData.error);
          alertBox.className = 'alert alert-error show';
          alertMsg.textContent = 'Uitnodigen mislukt: ' + inviteData.error;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Uitnodigen';
          return;
        }

        console.log('[Invite] Succes, user_id:', inviteData.user_id);

        // Wacht op trigger die profiel aanmaakt
        await new Promise(function (r) { setTimeout(r, 2000); });

        // Update profiel met extra velden
        if (inviteData.user_id) {
          var updateData = { startdatum: startdatum || null, account_type: accountType };
          if (inwerktrajectUrl) updateData.inwerktraject_url = inwerktrajectUrl;
          if (werkuren) updateData.werkuren = werkuren;
          if (afdeling) updateData.afdeling = afdeling;
          var inwerkCheckbox = document.getElementById('invite-inwerktraject-actief');
          if (inwerkCheckbox) updateData.inwerktraject_actief = inwerkCheckbox.checked;
          if (einddatum) updateData.einddatum = einddatum;
          if (teams.length > 0) updateData.teams = teams;
          if (teamleiderNaam) updateData.teamleider_naam = teamleiderNaam;
          console.log('[Invite] Profiel updaten');
          await supabaseClient.from('profiles').update(updateData).eq('user_id', inviteData.user_id);
        }

        alertBox.className = 'alert alert-success show';
        alertMsg.innerHTML = 'Uitnodiging verstuurd naar <strong>' + escapeHtml(email) + '</strong>.<br>' +
          '<span style="font-size:0.8rem;margin-top:4px;display:inline-block">' +
          '⚠️ Let op: de uitnodigingsmail kan in de spamfolder terechtkomen.</span>';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Uitnodigen';
        loadMedewerkers();
        setTimeout(function () { modal.classList.remove('show'); }, 5000);
      } catch (err) {
        console.error('[Invite] Exception:', err);
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Uitnodiging kon niet worden verstuurd. Controleer of het emailadres correct is.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Uitnodigen';
      }
    });
  }

  // =============================================
  // EDIT MODAL
  // =============================================
  window.editMedewerker = function (profileId) {
    var p = allProfiles.find(function (pr) { return pr.id === profileId; });
    if (!p) return;

    document.getElementById('edit-profile-id').value = p.id;
    document.getElementById('edit-naam').value = p.naam || '';
    var editFgSelect = document.getElementById('edit-functiegroep');
    editFgSelect.value = p.functiegroep || '';
    // Als functiegroep niet in dropdown staat, voeg als optie toe
    if (editFgSelect.value !== (p.functiegroep || '')) {
      var tempOpt = document.createElement('option');
      tempOpt.value = p.functiegroep;
      tempOpt.textContent = p.functiegroep.replace(/_/g, ' ');
      editFgSelect.appendChild(tempOpt);
      editFgSelect.value = p.functiegroep;
    }
    document.getElementById('edit-werkuren').value = p.werkuren || '';
    document.getElementById('edit-afdeling').value = p.afdeling || '';
    document.getElementById('edit-startdatum').value = p.startdatum || '';
    document.getElementById('edit-inwerktraject-actief').checked = p.inwerktraject_actief === true;
    document.getElementById('edit-inwerktraject-url').value = p.inwerktraject_url || '';

    // Account type
    var accountType = p.account_type || 'vast';
    var editAccountRadios = document.querySelectorAll('input[name="edit-account-type"]');
    editAccountRadios.forEach(function (radio) {
      radio.checked = (radio.value === accountType);
    });

    // Einddatum
    var editEinddatumEl = document.getElementById('edit-einddatum');
    if (editEinddatumEl) {
      editEinddatumEl.value = p.einddatum || '';
      var einddatumGroup = editEinddatumEl.closest('.form-group');
      if (einddatumGroup) {
        einddatumGroup.style.display = accountType === 'tijdelijk' ? 'block' : 'none';
      }
    }

    // Teams checkboxes
    populateTeamCheckboxes('edit-teams', p.teams || []);

    // Teamleider dropdown (alleen rol=teamleider)
    populateTeamleiderDropdown('edit-teamleider', p.teamleider_naam, 'teamleider');

    // Manager dropdown (alleen rol=manager)
    populateTeamleiderDropdown('edit-manager', p.teamleider_naam, 'manager');

    // Dynamische velden tonen op basis van functiegroep
    updateFormFields('edit', p.functiegroep || '');

    var editAlert = document.getElementById('edit-alert');
    editAlert.className = 'alert';

    document.getElementById('modal-edit-medewerker').classList.add('show');
  };

  (function initEditModal() {
    var modal = document.getElementById('modal-edit-medewerker');
    var form = document.getElementById('edit-form');
    var cancelBtn = document.getElementById('edit-cancel-btn');
    var submitBtn = document.getElementById('edit-submit-btn');
    var alertBox = document.getElementById('edit-alert');
    var alertMsg = document.getElementById('edit-alert-message');

    // Account type radio toggle einddatum
    var editAccountRadios = document.querySelectorAll('input[name="edit-account-type"]');
    editAccountRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        var editEinddatumEl = document.getElementById('edit-einddatum');
        if (editEinddatumEl) {
          var group = editEinddatumEl.closest('.form-group');
          if (group) {
            group.style.display = radio.value === 'tijdelijk' ? 'block' : 'none';
          }
        }
      });
    });

    cancelBtn.addEventListener('click', function () {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var profileId = document.getElementById('edit-profile-id').value;
      var naam = document.getElementById('edit-naam').value.trim();
      var functiegroep = document.getElementById('edit-functiegroep').value;
      var startdatum = document.getElementById('edit-startdatum').value;
      var inwerktrajectUrl = document.getElementById('edit-inwerktraject-url').value.trim();
      var werkuren = document.getElementById('edit-werkuren').value.trim();
      var afdeling = document.getElementById('edit-afdeling').value.trim();

      // Nieuwe velden
      var accountTypeEl = document.querySelector('input[name="edit-account-type"]:checked');
      var accountType = accountTypeEl ? accountTypeEl.value : 'vast';
      var einddatum = document.getElementById('edit-einddatum').value || null;
      var teams = getCheckedTeams('edit-teams');
      var teamleiderNaam = document.getElementById('edit-teamleider').value || null;
      var managerNaam = document.getElementById('edit-manager').value || null;
      if (managerNaam && !teamleiderNaam) teamleiderNaam = managerNaam;

      if (!naam || !functiegroep) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Naam en functiegroep zijn verplicht.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Opslaan...';

      // Check of functiegroep is gewijzigd — log in functie_historie
      var huidigProfiel = allProfiles.find(function (pr) { return pr.id === profileId; });
      if (huidigProfiel && huidigProfiel.functiegroep && huidigProfiel.functiegroep !== functiegroep) {
        // Log functiewijziging
        try {
          await supabaseClient.from('functie_historie').insert({
            profile_id: profileId,
            vorige_functie: huidigProfiel.functiegroep,
            nieuwe_functie: functiegroep,
            gewijzigd_op: new Date().toISOString()
          });
        } catch (e) { /* functie_historie tabel bestaat mogelijk niet */ }
        // Rol-wissel: sla oude functie op en reset gezien-status
        updateData.vorige_functiegroep = huidigProfiel.functiegroep;
        updateData.rolwissel_gezien = false;
      }

      // Bouw update object — sla alleen niet-lege velden op
      var updateData = { naam: naam, functiegroep: functiegroep };
      if (startdatum) updateData.startdatum = startdatum;
      if (inwerktrajectUrl !== undefined) updateData.inwerktraject_url = inwerktrajectUrl || null;
      if (werkuren !== undefined) updateData.werkuren = werkuren || null;
      if (accountType) updateData.account_type = accountType;
      if (einddatum !== undefined) updateData.einddatum = einddatum || null;
      if (teams.length > 0) updateData.teams = teams;
      if (teamleiderNaam !== undefined) updateData.teamleider_naam = teamleiderNaam || null;
      // Optionele kolommen — alleen toevoegen als ze bestaan
      try { updateData.afdeling = afdeling || null; } catch(e) {}
      try { updateData.inwerktraject_actief = document.getElementById('edit-inwerktraject-actief').checked; } catch(e) {}

      console.log('[Edit] Update data:', JSON.stringify(updateData));
      var result = await supabaseClient
        .from('profiles')
        .update(updateData)
        .eq('id', profileId);

      console.log('[Edit] Result:', result.error ? 'FOUT: ' + result.error.message : 'OK, status: ' + result.status);

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Opslaan mislukt: ' + result.error.message;
      } else {
        // Update ook auth.users metadata via Edge Function
        var huidigProfiel2 = allProfiles.find(function (pr) { return pr.id === profileId; });
        if (huidigProfiel2 && huidigProfiel2.user_id) {
          try {
            var session = await supabaseClient.auth.getSession();
            var token = session.data.session.access_token;
            await fetch(SUPABASE_URL + '/functions/v1/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({
                update_user_meta: true,
                update_user_id: huidigProfiel2.user_id,
                user_metadata: { naam: naam, functiegroep: functiegroep }
              })
            });
            console.log('[Edit] Auth metadata bijgewerkt');
          } catch (metaErr) {
            console.error('[Edit] Auth metadata update fout:', metaErr);
          }
        }

        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Medewerker bijgewerkt.';
        await loadMedewerkers();
        setTimeout(function () {
          modal.classList.remove('show');
        }, 1500);
      }

      submitBtn.disabled = false;
      submitBtn.textContent = 'Opslaan';
    });
  })();

  // =============================================
  // GESPREKKEN
  // =============================================
  async function loadGesprekken() {
    var tbody = document.getElementById('gesprekken-body');

    var result = await supabaseClient
      .from('conversations')
      .select('id, vraag, antwoord, feedback, created_at, user_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Kon gesprekken niet laden.</td></tr>';
      return;
    }

    allConversations = result.data;
    renderGesprekken();

    document.getElementById('filter-medewerker').addEventListener('change', renderGesprekken);
    document.getElementById('filter-feedback').addEventListener('change', renderGesprekken);
  }

  function renderGesprekken() {
    var tbody = document.getElementById('gesprekken-body');
    var filterUser = document.getElementById('filter-medewerker').value;
    var filterFeedback = document.getElementById('filter-feedback').value;

    var filtered = allConversations.filter(function (c) {
      if (filterUser && c.user_id !== filterUser) return false;
      if (filterFeedback === 'goed' && c.feedback !== 'goed') return false;
      if (filterFeedback === 'niet_goed' && c.feedback !== 'niet_goed') return false;
      if (filterFeedback === 'geen' && c.feedback !== null) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Geen gesprekken gevonden.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (c) {
      var datum = new Date(c.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });

      var profile = allProfiles.find(function (p) { return p.id === c.user_id; });
      var naam;
      if (namenZichtbaar) {
        naam = profile ? (profile.naam || profile.email) : 'Onbekend';
      } else {
        var fg = profile ? formatFunctiegroep(profile.functiegroep) : '';
        var teams = profile && profile.teams ? profile.teams.join(', ') : '';
        naam = 'Medewerker' + (fg ? ' — ' + fg : '') + (teams ? ' — ' + teams : '');
      }

      var feedbackBadge = '';
      if (c.feedback === 'goed') {
        feedbackBadge = '<span class="badge badge-goed">👍 Nuttig</span>';
      } else if (c.feedback === 'niet_goed') {
        feedbackBadge = '<span class="badge badge-niet-goed">👎 Niet handig</span>';
      } else {
        feedbackBadge = '<span class="badge badge-geen">—</span>';
      }

      var antwoord = c.antwoord || '<em style="color:var(--error)">Niet beantwoord</em>';

      return '<tr onclick="window.showGesprekDetail(\'' + c.id + '\')" style="cursor:pointer">' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td>' + escapeHtml(naam) + '</td>' +
        '<td><div class="answer-preview">' + escapeHtml(c.vraag) + '</div></td>' +
        '<td><div class="answer-preview">' + (c.antwoord ? escapeHtml(c.antwoord) : antwoord) + '</div></td>' +
        '<td>' + feedbackBadge + '</td>' +
        '</tr>';
    }).join('');
  }

  // ---- Gesprek detail modal ----
  function initGesprekDetail() {
    var modal = document.getElementById('modal-gesprek');
    var closeBtn = document.getElementById('detail-close-btn');

    closeBtn.addEventListener('click', function () {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });
  }

  window.showGesprekDetail = function (id) {
    var c = allConversations.find(function (conv) { return conv.id === id; });
    if (!c) return;

    document.getElementById('detail-vraag').textContent = c.vraag;
    document.getElementById('detail-antwoord').textContent = c.antwoord || 'Niet beantwoord';

    var fb = document.getElementById('detail-feedback');
    if (c.feedback === 'goed') {
      fb.innerHTML = '<span class="badge badge-goed">👍 Nuttig</span>';
    } else if (c.feedback === 'niet_goed') {
      fb.innerHTML = '<span class="badge badge-niet-goed">👎 Niet handig</span>';
    } else {
      fb.innerHTML = '<span class="badge badge-geen">Geen feedback gegeven</span>';
    }

    document.getElementById('modal-gesprek').classList.add('show');
  };

  (function initToggleNamen() {
    var btn = document.getElementById('toggle-namen-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (namenZichtbaar) {
        namenZichtbaar = false;
        btn.textContent = 'Namen tonen 🔒';
        renderGesprekken();
      } else {
        if (confirm('Je staat op het punt namen zichtbaar te maken. Dit is alleen bedoeld bij klachten of incidenten. Doorgaan?')) {
          namenZichtbaar = true;
          btn.textContent = 'Namen verbergen 🔓';
          renderGesprekken();
        }
      }
    });
  })();

  // =============================================
  // STATISTIEKEN
  // =============================================
  async function loadStatistieken() {
    var result = await supabaseClient
      .from('conversations')
      .select('id, feedback, created_at')
      .eq('tenant_id', tenantId);

    if (result.error || !result.data) return;

    var data = result.data;
    var now = new Date();
    var today = now.toISOString().split('T')[0];

    var dayOfWeek = now.getDay();
    var mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var weekStart = new Date(now);
    weekStart.setDate(now.getDate() - mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    var totaal = data.length;
    var vandaag = data.filter(function (c) {
      return c.created_at.startsWith(today);
    }).length;
    var week = data.filter(function (c) {
      return new Date(c.created_at) >= weekStart;
    }).length;

    var metFeedback = data.filter(function (c) { return c.feedback !== null; });
    var positief = metFeedback.filter(function (c) { return c.feedback === 'goed'; });
    var positiefPct = metFeedback.length > 0
      ? Math.round((positief.length / metFeedback.length) * 100)
      : 0;

    document.getElementById('stat-totaal').textContent = totaal;
    document.getElementById('stat-vandaag').textContent = vandaag;
    document.getElementById('stat-week').textContent = week;
    document.getElementById('stat-positief').textContent = positiefPct + '%';

    var perDag = {};
    for (var i = 13; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = d.toISOString().split('T')[0];
      perDag[key] = 0;
    }

    data.forEach(function (c) {
      var key = c.created_at.split('T')[0];
      if (key in perDag) {
        perDag[key]++;
      }
    });

    var tbody = document.getElementById('stats-per-dag-body');
    var rows = Object.keys(perDag).map(function (key) {
      var datum = new Date(key).toLocaleDateString('nl-NL', {
        weekday: 'short', day: 'numeric', month: 'short'
      });
      var count = perDag[key];
      var bar = count > 0
        ? '<div style="background:var(--primary);height:8px;border-radius:4px;width:' + Math.min(count * 20, 100) + '%;display:inline-block;margin-right:8px;vertical-align:middle"></div>' + count
        : '<span style="color:var(--text-muted)">0</span>';
      return '<tr><td>' + datum + '</td><td>' + bar + '</td></tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  // =============================================
  // VERBETERPUNTEN
  // =============================================
  async function loadVerbeterpunten() {
    var tbody = document.getElementById('verbeterpunten-body');
    if (!tbody) return;

    // Haal alle gesprekken op met feedback niet_goed
    var nietGoedResult = await supabaseClient
      .from('conversations')
      .select('id, vraag, feedback')
      .eq('tenant_id', tenantId)
      .eq('feedback', 'niet_goed');

    // Haal alle gesprekken op (voor totaal aantal per vraag)
    var alleResult = await supabaseClient
      .from('conversations')
      .select('id, vraag')
      .eq('tenant_id', tenantId);

    // Haal kennisbank items op
    var kbResult = await supabaseClient
      .from('kennisbank_items')
      .select('id, vraag, antwoord, created_at')
      .eq('tenant_id', tenantId);

    var kennisbankItems = (kbResult.data || []);
    var kbVragen = kennisbankItems.map(function (kb) { return kb.vraag; });

    if (nietGoedResult.error || !nietGoedResult.data || nietGoedResult.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Geen verbeterpunten gevonden.</td></tr>';
      // Notities en kennisbank-items moeten OOK geladen worden als er geen
      // negatieve feedback is — anders verschijnt de hele sectie leeg.
      loadKennisbankItems(kennisbankItems);
      loadKennisnotities();
      loadAppFeedback();
      return;
    }

    // Groepeer thumbs down per vraag
    var vraagMap = {};
    nietGoedResult.data.forEach(function (c) {
      var v = c.vraag.trim().toLowerCase();
      if (!vraagMap[v]) {
        vraagMap[v] = { vraag: c.vraag, count: 0 };
      }
      vraagMap[v].count++;
    });

    // Tel totaal aantal keer gesteld per vraag
    var alleVraagMap = {};
    (alleResult.data || []).forEach(function (c) {
      var v = c.vraag.trim().toLowerCase();
      if (!alleVraagMap[v]) {
        alleVraagMap[v] = 0;
      }
      alleVraagMap[v]++;
    });

    // Sorteer op aantal thumbs down (desc)
    var sorted = Object.keys(vraagMap).map(function (key) {
      return {
        vraag: vraagMap[key].vraag,
        thumbsDown: vraagMap[key].count,
        totaal: alleVraagMap[key] || vraagMap[key].count
      };
    }).sort(function (a, b) { return b.thumbsDown - a.thumbsDown; });

    // Check notificaties
    var alertHtml = '';
    var highThumbsDown = sorted.filter(function (s) { return s.thumbsDown >= 3; });
    var highAsked = sorted.filter(function (s) { return s.totaal >= 5; });

    if (highThumbsDown.length > 0) {
      alertHtml += '<div class="alert alert-error show" style="margin-bottom:12px">' +
        '<strong>Let op:</strong> ' + highThumbsDown.length + ' vraag/vragen met 3+ negatieve feedback.' +
        '</div>';
    }
    if (highAsked.length > 0) {
      alertHtml += '<div class="alert alert-warning show" style="margin-bottom:12px">' +
        '<strong>Suggestie:</strong> ' + highAsked.length + ' vraag/vragen worden vaak gesteld (5+). Overweeg een nieuwe chip.' +
        '</div>';
    }

    var alertContainer = tbody.closest('.card') || tbody.parentElement;
    var existingAlerts = alertContainer.querySelectorAll('.verbeter-alert');
    existingAlerts.forEach(function (el) { el.remove(); });
    if (alertHtml) {
      var alertDiv = document.createElement('div');
      alertDiv.className = 'verbeter-alert';
      alertDiv.innerHTML = alertHtml;
      tbody.closest('table').parentElement.insertBefore(alertDiv, tbody.closest('table'));
    }

    tbody.innerHTML = sorted.map(function (item) {
      var truncated = item.vraag.length > 80 ? item.vraag.substring(0, 80) + '...' : item.vraag;
      var isBeantwoord = kbVragen.indexOf(item.vraag) !== -1;
      var statusBadge = isBeantwoord
        ? '<span class="badge badge-goed">Beantwoord</span>'
        : '<span class="badge badge-niet-goed">Open</span>';
      var escapedVraag = escapeHtml(item.vraag.replace(/'/g, "\\'"));
      var actieBtn = !isBeantwoord
        ? '<button class="btn btn-sm" onclick="window.openVerbeterModal(\'' + escapedVraag + '\')">Beantwoord</button> ' +
          '<button class="btn btn-sm" style="font-size:0.75rem;padding:4px 8px" onclick="window.openKennisnotitie(\'' + escapedVraag + '\')">+ Notitie</button> '
        : '<span class="badge badge-goed" style="font-size:0.7rem">✓</span> ';
      actieBtn += '<button class="btn-icon btn-icon-danger" onclick="window.deleteVerbeterpunt(\'' + escapedVraag + '\')" title="Verwijderen uit verbeterpunten">🗑️</button>';

      return '<tr>' +
        '<td title="' + escapeHtml(item.vraag) + '">' + escapeHtml(truncated) + '</td>' +
        '<td style="text-align:center">' + item.thumbsDown + '</td>' +
        '<td style="text-align:center">' + item.totaal + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + actieBtn + '</td>' +
        '</tr>';
    }).join('');

    loadKennisbankItems(kennisbankItems);
    loadKennisnotities();
    loadAppFeedback();
  }

  // ---- Verbeterpunt verwijderen (feedback resetten) ----
  window.deleteVerbeterpunt = async function (vraag) {
    if (!confirm('Dit verbeterpunt verwijderen? De negatieve feedback wordt gereset op alle conversations met deze vraag.')) return;
    var unescapedVraag = vraag.replace(/\\'/g, "'");
    console.log('[DELETE verbeterpunt] Reset feedback voor vraag:', unescapedVraag);
    var result = await supabaseClient
      .from('conversations')
      .update({ feedback: null })
      .eq('tenant_id', tenantId)
      .eq('vraag', unescapedVraag)
      .eq('feedback', 'niet_goed')
      .select();
    console.log('[DELETE verbeterpunt] Response:', result.error, 'rows bijgewerkt:', result.data ? result.data.length : 0);
    if (result.error) { alert('Verwijderen mislukt: ' + result.error.message); return; }
    if (!result.data || result.data.length === 0) {
      alert('Geen rij gereset — mogelijk een rechten-issue of de vraag matcht niet meer. Check console.');
      return;
    }
    loadVerbeterpunten();
  };

  // ---- App feedback van medewerkers ----
  async function loadAppFeedback() {
    var container = document.getElementById('app-feedback-lijst');
    if (!container) return;

    var result = await supabaseClient
      .from('app_feedback')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('ingediend_op', { ascending: false });

    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p class="no-data">Nog geen feedback ontvangen.</p>';
      updateFeedbackBadge(0);
      return;
    }

    var nieuw = result.data.filter(function (f) { return f.status === 'nieuw'; }).length;
    updateFeedbackBadge(nieuw);

    var categorieLabels = {
      werkt_niet: '🔧 Werkt niet',
      verbetering: '💡 Idee',
      antwoord_klopt_niet: '⚠️ Antwoord klopt niet',
      anders: '💬 Anders'
    };
    var statusLabels = { nieuw: 'Nieuw', gelezen: 'Gelezen', afgehandeld: 'Afgehandeld' };
    var nextStatus = { nieuw: 'gelezen', gelezen: 'afgehandeld', afgehandeld: 'nieuw' };

    container.innerHTML = result.data.map(function (f) {
      var datum = new Date(f.ingediend_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
      var fg = formatFunctiegroep(f.functiegroep || '');
      var statusClass = f.status === 'nieuw' ? 'badge-warning' : (f.status === 'afgehandeld' ? 'badge-success' : 'badge-info');
      var opacity = f.status === 'afgehandeld' ? 'opacity:0.6;' : '';
      return '<div class="kennisbank-item" style="margin-bottom:8px;' + opacity + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;gap:12px">' +
        '<div style="flex:1">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
        '<strong style="font-size:0.85rem">' + (categorieLabels[f.categorie] || f.categorie) + '</strong>' +
        '<span class="badge ' + statusClass + '" style="font-size:0.7rem">' + statusLabels[f.status] + '</span>' +
        '<span style="font-size:0.7rem;color:var(--text-muted)">' + datum + (fg ? ' • ' + fg : '') + '</span>' +
        '</div>' +
        '<div style="font-size:0.85rem;white-space:pre-wrap">' + escapeHtml(f.bericht) + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto" onclick="window.cycleFeedbackStatus(\'' + f.id + '\', \'' + nextStatus[f.status] + '\')">→ ' + statusLabels[nextStatus[f.status]] + '</button>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteAppFeedback(\'' + f.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div></div></div>';
    }).join('');
  }

  function updateFeedbackBadge(count) {
    updateTabBadge('verbeterpunten', count);
  }

  function updateTabBadge(tabName, count) {
    // Sla count op en re-apply naar zowel sub-tab knop als hoofdgroep knop
    tabBadgeCounts[tabName] = count;
    reapplyBadges();
  }

  window.cycleFeedbackStatus = async function (id, newStatus) {
    await supabaseClient.from('app_feedback').update({ status: newStatus }).eq('id', id);
    loadAppFeedback();
  };

  window.deleteAppFeedback = async function (id) {
    if (!confirm('Feedback verwijderen?')) return;
    await supabaseClient.from('app_feedback').delete().eq('id', id);
    loadAppFeedback();
  };

  // Kennisnotitie toevoegen
  window.openKennisnotitie = function (vraag) {
    var bestaandForm = document.getElementById('kennisnotitie-form-inline');
    if (bestaandForm) bestaandForm.remove();

    var form = document.createElement('tr');
    form.id = 'kennisnotitie-form-inline';
    form.innerHTML = '<td colspan="5" style="padding:12px;background:#F0FFF4">' +
      '<textarea id="kn-tekst" placeholder="Schrijf een korte notitie over dit onderwerp (max 500 tekens)..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:var(--font);font-size:0.85rem;resize:vertical;min-height:60px" maxlength="500"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn btn-primary" id="kn-opslaan" style="width:auto;padding:6px 14px;font-size:0.8rem">Opslaan als kennisnotitie</button>' +
      '<button class="btn btn-secondary" id="kn-annuleer" style="width:auto;padding:6px 14px;font-size:0.8rem">Annuleren</button>' +
      '</div></td>';

    // Zoek de rij met deze vraag en voeg form eronder toe
    var rijen = document.querySelectorAll('#verbeterpunten-body tr');
    var doelRij = null;
    rijen.forEach(function (r) {
      if (r.getAttribute('title') === vraag || (r.querySelector('td') && r.querySelector('td').getAttribute('title') === vraag)) {
        doelRij = r;
      }
    });
    if (doelRij) {
      doelRij.parentNode.insertBefore(form, doelRij.nextSibling);
    } else {
      document.getElementById('verbeterpunten-body').appendChild(form);
    }

    document.getElementById('kn-annuleer').addEventListener('click', function () { form.remove(); });
    document.getElementById('kn-opslaan').addEventListener('click', async function () {
      var tekst = document.getElementById('kn-tekst').value.trim();
      if (!tekst) { alert('Vul een notitie in.'); return; }

      await supabaseClient.from('kennisnotities').insert({
        tenant_id: tenantId,
        originele_vraag: vraag,
        notitie: tekst.substring(0, 500)
      });

      form.remove();
      loadVerbeterpunten();
    });
  };

  async function loadKennisnotities() {
    var container = document.getElementById('kennisnotities-lijst');
    if (!container) return;

    var result = await supabaseClient
      .from('kennisnotities')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('actief', true)
      .order('created_at', { ascending: false });

    console.log('[Notities] Geladen:', result.data ? result.data.length : 0, result.error);

    if (result.error) {
      container.innerHTML = '<p style="color:var(--error);font-size:0.85rem">Notities laden mislukt: ' + escapeHtml(result.error.message) + '</p>';
      return;
    }
    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nog geen kennisnotities.</p>';
      return;
    }

    container.innerHTML = result.data.map(function (kn) {
      var datum = new Date(kn.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
      return '<div class="kennisbank-item" style="margin-bottom:8px" data-kn-id="' + kn.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">' +
        '<div style="flex:1"><div class="kennisbank-item-vraag">📝 ' + escapeHtml(kn.originele_vraag) + '</div>' +
        '<div class="kennisbank-item-antwoord kn-tekst">' + escapeHtml(kn.notitie) + '</div>' +
        '<span style="font-size:0.7rem;color:var(--text-muted)">' + datum + '</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<button class="btn-icon" onclick="window.editKennisnotitieInline(\'' + kn.id + '\')" title="Bewerken">✏️</button>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteKennisnotitie(\'' + kn.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div></div></div>';
    }).join('');
  }

  window.editKennisnotitieInline = async function (id) {
    var card = document.querySelector('[data-kn-id="' + id + '"]');
    if (!card) return;
    var tekstEl = card.querySelector('.kn-tekst');
    var origineel = tekstEl.textContent;

    var textarea = document.createElement('textarea');
    textarea.value = origineel;
    textarea.maxLength = 1000;
    textarea.style.cssText = 'width:100%;padding:6px;border:1px solid var(--primary);border-radius:4px;font-family:inherit;font-size:0.85rem;min-height:60px;resize:vertical';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.cssText = 'padding:4px 10px;font-size:0.75rem;width:auto;margin-right:6px;margin-top:6px';
    saveBtn.textContent = 'Opslaan';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.style.cssText = 'padding:4px 10px;font-size:0.75rem;width:auto;margin-top:6px';
    cancelBtn.textContent = 'Annuleren';

    var wrapper = document.createElement('div');
    wrapper.appendChild(textarea);
    var actions = document.createElement('div');
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    wrapper.appendChild(actions);

    tekstEl.replaceWith(wrapper);

    cancelBtn.addEventListener('click', function () { loadKennisnotities(); });
    saveBtn.addEventListener('click', async function () {
      var nieuw = textarea.value.trim();
      if (!nieuw) return;
      await supabaseClient.from('kennisnotities').update({ notitie: nieuw.substring(0, 1000) }).eq('id', id);
      loadKennisnotities();
    });
    textarea.focus();
  };

  window.deleteKennisnotitie = async function (id) {
    if (!confirm('Kennisnotitie verwijderen?')) return;
    console.log('[DELETE kennisnotitie] Verwijder id:', id);
    var result = await supabaseClient
      .from('kennisnotities')
      .update({ actief: false })
      .eq('id', id)
      .select();
    console.log('[DELETE kennisnotitie] Response:', result.error, 'rows:', result.data);
    if (result.error) {
      alert('Verwijderen mislukt: ' + result.error.message);
      return;
    }
    if (!result.data || result.data.length === 0) {
      alert('Geen rij verwijderd — mogelijk een rechten-issue. Check console.');
      return;
    }
    loadKennisnotities();
  };

  window.editKennisnotitie = async function (id) {
    var nieuweTekst = prompt('Bewerk kennisnotitie (max 1000 tekens):');
    if (nieuweTekst === null) return;
    nieuweTekst = nieuweTekst.trim();
    if (!nieuweTekst) return;
    await supabaseClient.from('kennisnotities').update({ notitie: nieuweTekst.substring(0, 1000) }).eq('id', id);
    loadKennisnotities();
  };

  // ---- Proactief kennisbank item toevoegen (zonder gekoppelde vraag) ----
  function initKbToevoegen() {
    var btn = document.getElementById('kb-toevoegen-btn');
    var form = document.getElementById('kb-toevoegen-form');
    var opslaan = document.getElementById('kb-toevoegen-opslaan');
    var annuleer = document.getElementById('kb-toevoegen-annuleer');
    var bevestiging = document.getElementById('kb-bevestiging');
    if (!btn || !form) return;

    btn.addEventListener('click', function () {
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (bevestiging) bevestiging.style.display = 'none';
    });
    annuleer.addEventListener('click', function () {
      form.style.display = 'none';
      document.getElementById('kb-vraag').value = '';
      document.getElementById('kb-antwoord').value = '';
      if (bevestiging) bevestiging.style.display = 'none';
    });
    opslaan.addEventListener('click', async function () {
      var vraag = document.getElementById('kb-vraag').value.trim();
      var antwoord = document.getElementById('kb-antwoord').value.trim();
      if (!vraag || !antwoord) { alert('Vul beide velden in.'); return; }

      opslaan.disabled = true;
      var origineelLabel = opslaan.textContent;
      opslaan.textContent = 'Opslaan...';

      var result = await supabaseClient.from('kennisbank_items').insert({
        tenant_id: tenantId,
        vraag: vraag.substring(0, 200),
        antwoord: antwoord.substring(0, 2000)
      }).select();

      console.log('[KennisItem] Insert result:', result.error, 'rows:', result.data);

      opslaan.disabled = false;
      opslaan.textContent = origineelLabel;

      if (result.error) {
        alert('Opslaan mislukt: ' + result.error.message);
        return;
      }
      if (!result.data || result.data.length === 0) {
        alert('Opslaan mislukt: geen rij ingevoegd. Mogelijk een rechten-issue. Check console.');
        return;
      }

      // Bevestiging tonen, velden leegmaken, form sluit na 1.5s, lijst verversen
      if (bevestiging) bevestiging.style.display = 'block';
      document.getElementById('kb-vraag').value = '';
      document.getElementById('kb-antwoord').value = '';
      setTimeout(function () {
        form.style.display = 'none';
        if (bevestiging) bevestiging.style.display = 'none';
      }, 1500);
      loadVerbeterpunten();
    });
  }

  // ---- Proactief kennisnotitie toevoegen (zonder gekoppelde vraag) ----
  function initKnToevoegen() {
    var btn = document.getElementById('kn-toevoegen-btn');
    var form = document.getElementById('kn-toevoegen-form');
    var opslaan = document.getElementById('kn-toevoegen-opslaan');
    var annuleer = document.getElementById('kn-toevoegen-annuleer');
    if (!btn || !form) return;

    btn.addEventListener('click', function () {
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    annuleer.addEventListener('click', function () {
      form.style.display = 'none';
      document.getElementById('kn-onderwerp').value = '';
      document.getElementById('kn-notitie-tekst').value = '';
    });
    opslaan.addEventListener('click', async function () {
      var onderwerp = document.getElementById('kn-onderwerp').value.trim();
      var tekst = document.getElementById('kn-notitie-tekst').value.trim();
      if (!onderwerp || !tekst) { alert('Vul beide velden in.'); return; }

      var result = await supabaseClient.from('kennisnotities').insert({
        tenant_id: tenantId,
        originele_vraag: onderwerp.substring(0, 100),
        notitie: tekst.substring(0, 1000)
      });
      if (result.error) { alert('Opslaan mislukt: ' + result.error.message); return; }

      document.getElementById('kn-onderwerp').value = '';
      document.getElementById('kn-notitie-tekst').value = '';
      form.style.display = 'none';
      loadKennisnotities();
    });
  }

  function loadKennisbankItems(items) {
    var container = document.getElementById('kennisbank-items-list');
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = '<p class="no-data">Nog geen kennisbank items.</p>';
      return;
    }

    container.innerHTML = items.map(function (kb) {
      var datum = new Date(kb.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      return '<div class="kennisbank-item" style="margin-bottom:8px" data-kb-id="' + kb.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">' +
        '<div style="flex:1">' +
        '<div class="kennisbank-item-vraag kb-vraag" style="font-weight:600;margin-bottom:4px">✏️ ' + escapeHtml(kb.vraag) + '</div>' +
        '<div class="kennisbank-item-antwoord kb-antwoord" style="white-space:pre-wrap">' + escapeHtml(kb.antwoord) + '</div>' +
        '<span style="font-size:0.7rem;color:var(--text-muted)">' + datum + '</span>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<button class="btn-icon" onclick="window.editKennisbankItemInline(\'' + kb.id + '\')" title="Bewerken">✏️</button>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteKennisbankItem(\'' + kb.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div></div></div>';
    }).join('');
  }

  window.deleteKennisbankItem = async function (id) {
    if (!confirm('Weet je zeker dat je dit kennisbank item wilt verwijderen?')) return;
    console.log('[DELETE kennisbank-item] Verwijder id:', id);
    var result = await supabaseClient
      .from('kennisbank_items')
      .delete()
      .eq('id', id)
      .select();
    console.log('[DELETE kennisbank-item] Response:', result.error, 'rows:', result.data);
    if (result.error) {
      alert('Verwijderen mislukt: ' + result.error.message);
      return;
    }
    if (!result.data || result.data.length === 0) {
      alert('Geen rij verwijderd — mogelijk een rechten-issue. Check console.');
      return;
    }
    loadVerbeterpunten();
  };

  window.editKennisbankItemInline = function (id) {
    var card = document.querySelector('[data-kb-id="' + id + '"]');
    if (!card) return;
    var vraagEl = card.querySelector('.kb-vraag');
    var antwoordEl = card.querySelector('.kb-antwoord');
    var huidigeVraag = vraagEl.textContent.replace(/^✏️\s*/, '');
    var huidigAntwoord = antwoordEl.textContent;

    var vraagInput = document.createElement('input');
    vraagInput.type = 'text';
    vraagInput.value = huidigeVraag;
    vraagInput.style.cssText = 'width:100%;padding:6px;border:1px solid var(--primary);border-radius:4px;font-family:inherit;font-weight:600;margin-bottom:6px';

    var antwoordTa = document.createElement('textarea');
    antwoordTa.value = huidigAntwoord;
    antwoordTa.style.cssText = 'width:100%;padding:6px;border:1px solid var(--primary);border-radius:4px;font-family:inherit;font-size:0.9rem;min-height:80px;resize:vertical';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.cssText = 'padding:4px 10px;font-size:0.75rem;width:auto;margin-right:6px;margin-top:6px';
    saveBtn.textContent = 'Opslaan';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.style.cssText = 'padding:4px 10px;font-size:0.75rem;width:auto;margin-top:6px';
    cancelBtn.textContent = 'Annuleren';

    vraagEl.replaceWith(vraagInput);
    antwoordEl.replaceWith(antwoordTa);
    var actions = document.createElement('div');
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    antwoordTa.parentNode.appendChild(actions);

    cancelBtn.addEventListener('click', function () { loadVerbeterpunten(); });
    saveBtn.addEventListener('click', async function () {
      var nieuweVraag = vraagInput.value.trim();
      var nieuwAntwoord = antwoordTa.value.trim();
      if (!nieuweVraag || !nieuwAntwoord) return;
      var result = await supabaseClient.from('kennisbank_items')
        .update({ vraag: nieuweVraag, antwoord: nieuwAntwoord })
        .eq('id', id);
      if (result.error) { alert('Opslaan mislukt: ' + result.error.message); return; }
      loadVerbeterpunten();
    });
    vraagInput.focus();
  };

  function initVerbeterModal() {
    var modal = document.getElementById('modal-verbeter-antwoord');
    if (!modal) return;

    var form = document.getElementById('verbeter-antwoord-form');
    var cancelBtn = document.getElementById('verbeter-cancel-btn');
    var submitBtn = document.getElementById('verbeter-submit-btn');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('show');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var vraag = document.getElementById('verbeter-vraag-id').value;
        var antwoord = document.getElementById('verbeter-antwoord-tekst').value.trim();

        if (!antwoord) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Opslaan...';
        }

        var result = await supabaseClient
          .from('kennisbank_items')
          .insert({
            tenant_id: tenantId,
            vraag: vraag,
            antwoord: antwoord
          })
          .select();

        console.log('[KennisItem] Insert result:', result.error, 'rows:', result.data);

        if (result.error) {
          alert('Opslaan mislukt: ' + result.error.message);
        } else if (!result.data || result.data.length === 0) {
          alert('Opslaan mislukt: geen rij ingevoegd. Mogelijk een rechten-issue. Check console.');
        } else {
          modal.classList.remove('show');
          loadVerbeterpunten();
        }

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Opslaan';
        }
      });
    }
  }

  window.openVerbeterModal = function (vraag) {
    var modal = document.getElementById('modal-verbeter-antwoord');
    if (!modal) { console.error('[Verbeter] Modal niet gevonden'); return; }

    var vraagIdEl = document.getElementById('verbeter-vraag-id');
    var vraagTekstEl = document.getElementById('verbeter-vraag-tekst');
    var antwoordEl = document.getElementById('verbeter-antwoord-tekst');

    if (vraagIdEl) vraagIdEl.value = vraag;
    if (vraagTekstEl) vraagTekstEl.textContent = vraag;
    if (antwoordEl) antwoordEl.value = '';

    modal.classList.add('show');
  };

  // =============================================
  // TEAMLEIDERS
  // =============================================
  async function loadTeamleiders() {
    var tbody = document.getElementById('teamleiders-body');

    var result = await supabaseClient
      .from('teamleiders')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('naam', { ascending: true });

    if (result.error || !result.data) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="no-data">Kon leidinggevenden niet laden.</td></tr>';
      return;
    }

    allTeamleiders = result.data;

    // Update teamleider dropdowns in invite en edit modals
    populateTeamleiderDropdown('invite-teamleider', '', 'teamleider');
    populateTeamleiderDropdown('edit-teamleider', '', 'teamleider');
    populateTeamleiderDropdown('invite-manager', '', 'manager');
    populateTeamleiderDropdown('edit-manager', '', 'manager');

    if (!tbody) return;

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">Nog geen leidinggevenden.</td></tr>';
      return;
    }

    var rolLabels = { teamleider: 'Leidinggevende', manager: 'Manager', hr: 'HR Medewerker' };

    tbody.innerHTML = result.data.map(function (tl) {
      var rolLabel = rolLabels[tl.rol] || 'Leidinggevende';
      var koppelingStr = '-';
      if (tl.rol === 'manager' && tl.afdelingen && tl.afdelingen.length > 0) {
        koppelingStr = tl.afdelingen.join(', ');
      } else if (tl.teams && Array.isArray(tl.teams) && tl.teams.length > 0) {
        koppelingStr = tl.teams.join(', ');
      } else if (tl.rol === 'hr') {
        koppelingStr = 'Alle medewerkers';
      }

      return '<tr>' +
        '<td>' + escapeHtml(tl.naam) + '</td>' +
        '<td>' + escapeHtml(tl.titel || '-') + '</td>' +
        '<td>' + escapeHtml(tl.email || '-') + '</td>' +
        '<td>' + escapeHtml(tl.telefoon || '-') + '</td>' +
        '<td><span class="badge badge-admin">' + rolLabel + '</span></td>' +
        '<td>' + escapeHtml(koppelingStr) + '</td>' +
        '<td>' +
          '<button class="btn-icon" onclick="window.editTeamleider(\'' + tl.id + '\')" title="Bewerken">✏️</button>' +
          (tl.email ? '<button class="btn-icon" onclick="window.resendInvite(\'' + escapeHtml(tl.email) + '\', \'' + escapeHtml(tl.naam) + '\')" title="Uitnodiging opnieuw sturen">📧</button>' : '') +
          '<button class="btn-icon btn-icon-danger" onclick="window.deleteTeamleider(\'' + tl.id + '\')" title="Verwijderen">🗑️</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function initTeamleiderModal() {
    var modal = document.getElementById('modal-teamleider');
    if (!modal) return;

    var form = document.getElementById('teamleider-form');
    var cancelBtn = document.getElementById('tl-cancel-btn');
    var submitBtn = document.getElementById('tl-submit-btn');
    var addBtn = document.getElementById('add-teamleider-btn');

    var rolSelect = document.getElementById('tl-rol');
    var teamsGroup = document.getElementById('tl-teams-group');
    var afdelingenGroup = document.getElementById('tl-afdelingen-group');
    var modalTitle = document.getElementById('teamleider-modal-title');

    var rolTitels = { teamleider: 'Leidinggevende toevoegen', manager: 'Manager toevoegen', hr: 'HR Medewerker toevoegen' };
    var rolTitelsEdit = { teamleider: 'Leidinggevende bewerken', manager: 'Manager bewerken', hr: 'HR Medewerker bewerken' };

    function toggleRolVelden() {
      var rol = rolSelect ? rolSelect.value : 'teamleider';
      if (teamsGroup) teamsGroup.style.display = (rol === 'teamleider') ? '' : 'none';
      if (afdelingenGroup) afdelingenGroup.style.display = (rol === 'manager') ? '' : 'none';
      // Update modal titel als het een nieuw record is
      var isEdit = document.getElementById('tl-id').value;
      if (modalTitle) modalTitle.textContent = isEdit ? (rolTitelsEdit[rol] || 'Bewerken') : (rolTitels[rol] || 'Toevoegen');
    }

    if (rolSelect) {
      rolSelect.addEventListener('change', toggleRolVelden);
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (form) form.reset();
        document.getElementById('tl-id').value = '';
        if (rolSelect) rolSelect.value = 'teamleider';
        populateTeamCheckboxes('tl-teams', []);
        // Reset afdelingen checkboxes
        var afdCheckboxes = document.querySelectorAll('input[name="tl-afdelingen"]');
        afdCheckboxes.forEach(function (cb) { cb.checked = false; });
        toggleRolVelden();
        modal.classList.add('show');
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('show');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      // Niet sluiten als gebruiker tekst aan het selecteren is (mouseup buiten input)
      var selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      modal.classList.remove('show');
    });

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var tlId = document.getElementById('tl-id').value;
        var naam = document.getElementById('tl-naam').value.trim();
        var email = document.getElementById('tl-email').value.trim();
        var telefoon = document.getElementById('tl-telefoon').value.trim();
        var titel = document.getElementById('tl-titel') ? document.getElementById('tl-titel').value.trim() : '';
        var rol = rolSelect ? rolSelect.value : 'teamleider';
        var teams = getCheckedTeams('tl-teams');

        // Afdelingen ophalen
        var afdelingen = [];
        var afdCheckboxes = document.querySelectorAll('input[name="tl-afdelingen"]:checked');
        afdCheckboxes.forEach(function (cb) { afdelingen.push(cb.value); });

        if (!naam) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Opslaan...';
        }

        var data = {
          tenant_id: tenantId,
          naam: naam,
          titel: titel || null,
          email: email || null,
          telefoon: telefoon || null,
          rol: rol,
          teams: (rol === 'teamleider' && teams.length > 0) ? teams : null,
          afdelingen: (rol === 'manager' && afdelingen.length > 0) ? afdelingen : null
        };

        var result;
        if (tlId) {
          // Update bestaande teamleider
          result = await supabaseClient
            .from('teamleiders')
            .update(data)
            .eq('id', tlId);
        } else {
          // Insert nieuwe teamleider
          result = await supabaseClient
            .from('teamleiders')
            .insert(data);

          // Stuur automatisch uitnodigingsmail via Edge Function (service role)
          if (!result.error && email) {
            console.log('[Leidinggevende] Start uitnodigingsmail via Edge Function voor:', email, 'rol:', rol);
            try {
              var session = await supabaseClient.auth.getSession();
              var token = session.data.session.access_token;

              var inviteResponse = await fetch(SUPABASE_URL + '/functions/v1/chat', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({
                  invite_user: true,
                  invite_email: email,
                  invite_naam: naam,
                  invite_role: 'teamleider',  // Alle leidinggevenden krijgen role=teamleider in profiles
                  redirect_url: window.location.origin + appUrl('wachtwoord-instellen.html')
                })
              });

              var inviteData = await inviteResponse.json();
              console.log('[Leidinggevende] Invite response:', JSON.stringify(inviteData));

              if (inviteData.error) {
                console.error('[Leidinggevende] Invite fout:', inviteData.error);
                alert('Opgeslagen, maar uitnodigingsmail mislukt: ' + inviteData.error);
              } else if (inviteData.invited) {
                console.log('[Leidinggevende] Uitnodigingsmail verstuurd, user_id:', inviteData.user_id);
                // Wacht op trigger die profiel aanmaakt
                await new Promise(function (r) { setTimeout(r, 1500); });
                // Update profiel met teams of afdelingen
                if (inviteData.user_id) {
                  var profileUpdate = { teamleider_naam: naam };
                  if (rol === 'teamleider' && teams.length > 0) profileUpdate.teams = teams;
                  if (rol === 'manager') profileUpdate.afdeling = afdelingen.length > 0 ? afdelingen[0] : null;
                  await supabaseClient
                    .from('profiles')
                    .update(profileUpdate)
                    .eq('user_id', inviteData.user_id);
                }
                var rolNaam = { teamleider: 'Leidinggevende', manager: 'Manager', hr: 'HR Medewerker' };
                alert((rolNaam[rol] || 'Leidinggevende') + ' toegevoegd.\nUitnodigingsmail verstuurd naar ' + email + '.\nLet op: controleer ook de spamfolder.');
              }
            } catch (err) {
              console.error('[Leidinggevende] Invite exception:', err);
              alert('Opgeslagen, maar uitnodigingsmail kon niet verstuurd worden.');
            }
          }
        }

        if (result.error) {
          alert('Opslaan mislukt: ' + result.error.message);
        } else {
          // Sync profiles.role naar 'teamleider' voor deze email
          if (email) {
            await supabaseClient
              .from('profiles')
              .update({ role: 'teamleider' })
              .eq('email', email)
              .eq('tenant_id', tenantId)
              .neq('role', 'admin');
            console.log('[Leidinggevende] profiles.role gesynced naar teamleider voor:', email);
          }
          modal.classList.remove('show');
          loadTeamleiders();
        }

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Opslaan';
        }
      });
    }
  }

  window.editTeamleider = function (id) {
    var tl = allTeamleiders.find(function (t) { return t.id === id; });
    if (!tl) return;

    var modal = document.getElementById('modal-teamleider');
    if (!modal) return;

    document.getElementById('tl-id').value = tl.id;
    document.getElementById('tl-naam').value = tl.naam || '';
    var titelEl = document.getElementById('tl-titel');
    if (titelEl) titelEl.value = tl.titel || '';
    document.getElementById('tl-email').value = tl.email || '';
    document.getElementById('tl-telefoon').value = tl.telefoon || '';

    // Rol instellen
    var rolSelect = document.getElementById('tl-rol');
    if (rolSelect) rolSelect.value = tl.rol || 'teamleider';

    // Teams checkboxes
    populateTeamCheckboxes('tl-teams', tl.teams || []);

    // Afdelingen checkboxes
    var selectedAfd = tl.afdelingen || [];
    var afdCheckboxes = document.querySelectorAll('input[name="tl-afdelingen"]');
    afdCheckboxes.forEach(function (cb) {
      cb.checked = selectedAfd.indexOf(cb.value) !== -1;
    });

    // Toggle velden op basis van rol
    var teamsGroup = document.getElementById('tl-teams-group');
    var afdelingenGroup = document.getElementById('tl-afdelingen-group');
    var modalTitle = document.getElementById('teamleider-modal-title');
    var rolTitelsEdit = { teamleider: 'Leidinggevende bewerken', manager: 'Manager bewerken', hr: 'HR Medewerker bewerken' };
    var rol = tl.rol || 'teamleider';
    if (teamsGroup) teamsGroup.style.display = (rol === 'teamleider') ? '' : 'none';
    if (afdelingenGroup) afdelingenGroup.style.display = (rol === 'manager') ? '' : 'none';
    if (modalTitle) modalTitle.textContent = rolTitelsEdit[rol] || 'Bewerken';

    modal.classList.add('show');
  };

  window.resendInvite = async function (email, naam) {
    if (!confirm('Uitnodigingsmail opnieuw sturen naar ' + email + '?')) return;

    console.log('[Invite] Heruitnodiging starten voor:', email);
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
          resend_invite: true,
          invite_email: email,
          invite_naam: naam,
          redirect_url: window.location.origin + appUrl('wachtwoord-instellen.html')
        })
      });

      var data = await response.json();
      console.log('[Invite] Response:', JSON.stringify(data));

      if (data.error) {
        alert('Uitnodiging mislukt: ' + data.error);
      } else {
        alert('Uitnodigingsmail verstuurd naar ' + email + '.\nControleer ook de spamfolder.');
      }
    } catch (err) {
      console.error('[Invite] Exception:', err);
      alert('Er ging iets mis bij het versturen van de uitnodiging.');
    }
  };

  window.deleteTeamleider = async function (id) {
    if (!confirm('Weet je zeker dat je deze leidinggevende wilt verwijderen?')) return;

    await supabaseClient
      .from('teamleiders')
      .delete()
      .eq('id', id);

    loadTeamleiders();
  };

  // =============================================
  // MELDINGEN (patroon detectie)
  // =============================================
  async function loadMeldingen() {
    var container = document.getElementById('meldingen-lijst-container');
    var toonAfgehandeld = document.getElementById('meldingen-toon-afgehandeld');

    if (toonAfgehandeld && !toonAfgehandeld.dataset.bound) {
      toonAfgehandeld.dataset.bound = '1';
      toonAfgehandeld.addEventListener('change', loadMeldingen);
    }

    var result = await supabaseClient
      .from('meldingen')
      .select('id, type, bericht, created_at, gelezen')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (result.error || !result.data) {
      if (container) container.innerHTML = '<p class="no-data">Geen meldingen gevonden.</p>';
      updateMeldingenBadge(0);
      return;
    }

    var nieuw = result.data.filter(function (m) { return !m.gelezen; });
    updateMeldingenBadge(nieuw.length);

    var weergave = (toonAfgehandeld && toonAfgehandeld.checked) ? result.data : nieuw;

    if (container) {
      if (weergave.length === 0) {
        container.innerHTML = '<p class="no-data">Geen meldingen.</p>';
      } else {
        container.innerHTML = weergave.map(function (m) {
          var datum = new Date(m.created_at).toLocaleDateString('nl-NL', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          var afgehandeld = m.gelezen;
          var bgClass = afgehandeld ? '' : 'alert alert-warning show';
          var style = afgehandeld
            ? 'margin-bottom:8px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;opacity:0.6;display:flex;justify-content:space-between;align-items:center;gap:12px'
            : 'margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px';
          var statusBadge = afgehandeld
            ? '<span class="badge badge-success" style="font-size:0.7rem;margin-left:8px">Afgehandeld</span>'
            : '<span class="badge badge-warning" style="font-size:0.7rem;margin-left:8px">Nieuw</span>';
          return '<div class="' + bgClass + '" style="' + style + '">' +
            '<div style="flex:1"><strong>' + escapeHtml(m.type || 'Melding') + '</strong>' + statusBadge +
            '<br>' + escapeHtml(m.bericht) +
            '<br><small style="color:var(--text-muted)">' + datum + '</small></div>' +
            '<div style="display:flex;flex-direction:column;gap:4px">' +
            (afgehandeld
              ? ''
              : '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto" onclick="window.markeerAfgehandeld(\'' + m.id + '\')" title="Markeer als afgehandeld">✅ Afgehandeld</button>') +
            '<button class="btn-icon btn-icon-danger" onclick="window.deleteMelding(\'' + m.id + '\')" title="Verwijderen">🗑️</button>' +
            '</div></div>';
        }).join('');
      }
    }
  }

  function updateMeldingenBadge(count) {
    // Routeert via de centrale badge-cache zodat sub-tab + hoofdgroep tegelijk updaten
    updateTabBadge('meldingen', count);
  }

  window.markeerAfgehandeld = async function (id) {
    await supabaseClient.from('meldingen').update({ gelezen: true }).eq('id', id);
    loadMeldingen();
  };

  window.markeerGelezen = window.markeerAfgehandeld; // Backwards-compat alias

  window.deleteMelding = async function (id) {
    if (!confirm('Melding verwijderen?')) return;
    await supabaseClient.from('meldingen').delete().eq('id', id);
    loadMeldingen();
  };

  // =============================================
  // AANVRAGEN
  // =============================================
  async function loadAanvragen() {
    var tbody = document.getElementById('aanvragen-body');
    if (!tbody) return;

    var result = await supabaseClient
      .from('aanvragen')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="8" class="no-data">Kon aanvragen niet laden.</td></tr>';
      return;
    }

    // Badge updaten via centrale helper (sub-tab + hoofdgroep "Medewerkers")
    var openstaand = result.data.filter(function (a) { return a.status === 'in_afwachting'; });
    updateTabBadge('aanvragen', openstaand.length);

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="no-data">Geen aanvragen.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (a) {
      var datum = new Date(a.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      var typeBadge = a.type === 'nieuw'
        ? '<span class="badge badge-medewerker">Nieuw</span>'
        : '<span class="badge badge-niet-goed">Verwijder</span>';
      var statusBadge = '';
      if (a.status === 'in_afwachting') statusBadge = '<span class="badge badge-open">In afwachting ⏳</span>';
      else if (a.status === 'goedgekeurd') statusBadge = '<span class="badge badge-goed">Goedgekeurd ✅</span>';
      else if (a.status === 'afgekeurd') statusBadge = '<span class="badge badge-niet-goed">Afgekeurd ❌</span>';

      var acties = '';
      if (a.status === 'in_afwachting') {
        acties = '<button class="btn-icon" onclick="window.keurAanvraagGoed(\'' + a.id + '\')" title="Goedkeuren" style="color:var(--success)">✅</button>' +
          '<button class="btn-icon" onclick="window.keurAanvraagAf(\'' + a.id + '\')" title="Afkeuren" style="color:var(--error)">❌</button>';
      } else if (a.status === 'afgekeurd' && a.afkeurreden) {
        acties = '<span style="font-size:0.75rem;color:var(--text-muted)">' + escapeHtml(a.afkeurreden) + '</span>';
      }

      return '<tr>' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + escapeHtml(a.medewerker_naam || '-') + '</td>' +
        '<td>' + escapeHtml(a.medewerker_email || '-') + '</td>' +
        '<td>' + escapeHtml(a.medewerker_team || '-') + '</td>' +
        '<td>' + escapeHtml(a.aanvrager_naam || '-') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + acties + '</td>' +
        '</tr>';
    }).join('');
  }

  window.keurAanvraagGoed = async function (id) {
    if (!confirm('Weet je zeker dat je deze aanvraag wilt goedkeuren? Er wordt automatisch een uitnodigingsmail verstuurd.')) return;

    // Haal aanvraag op
    var result = await supabaseClient
      .from('aanvragen')
      .select('*')
      .eq('id', id)
      .single();

    if (result.error || !result.data) {
      alert('Aanvraag niet gevonden.');
      return;
    }

    var a = result.data;

    if (a.type === 'nieuw') {
      // Uitnodiging via Edge Function (service role key)
      console.log('[Aanvraag] Goedkeuren, uitnodiging sturen naar:', a.medewerker_email);
      var session = await supabaseClient.auth.getSession();
      var token = session.data.session.access_token;

      var invResp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          invite_user: true,
          invite_email: a.medewerker_email,
          invite_naam: a.medewerker_naam,
          invite_role: 'medewerker',
          invite_functiegroep: a.medewerker_functiegroep,
          redirect_url: window.location.origin + appUrl('wachtwoord-instellen.html')
        })
      });

      var invData = await invResp.json();
      console.log('[Aanvraag] Invite response:', JSON.stringify(invData));

      if (invData.error) {
        alert('Uitnodigen mislukt: ' + invData.error);
        return;
      }

      await new Promise(function (r) { setTimeout(r, 2000); });

      if (invData.user_id) {
        var updateData = {};
        if (a.medewerker_startdatum) updateData.startdatum = a.medewerker_startdatum;
        if (a.medewerker_werkuren) updateData.werkuren = a.medewerker_werkuren;
        if (a.medewerker_team) updateData.teams = [a.medewerker_team];
        await supabaseClient
          .from('profiles')
          .update(updateData)
          .eq('user_id', invData.user_id);
      }
    } else if (a.type === 'verwijder' && a.medewerker_profile_id) {
      await supabaseClient.from('profiles').delete().eq('id', a.medewerker_profile_id);
    }

    // Update status
    await supabaseClient
      .from('aanvragen')
      .update({ status: 'goedgekeurd', behandeld_op: new Date().toISOString() })
      .eq('id', id);

    loadAanvragen();
    loadMedewerkers();
  };

  window.keurAanvraagAf = async function (id) {
    var reden = prompt('Reden voor afkeuring (optioneel):');

    await supabaseClient
      .from('aanvragen')
      .update({
        status: 'afgekeurd',
        afkeurreden: reden || null,
        behandeld_op: new Date().toISOString()
      })
      .eq('id', id);

    loadAanvragen();
  };

  // =============================================
  // INSTELLINGEN
  // =============================================
  var settingsFields = [
    { sleutel: 'organisatienaam', elementId: 'setting-organisatienaam', fallback: '' },
    { sleutel: 'primaire_kleur', elementId: 'setting-kleur', fallback: '#E8720C' },
    { sleutel: 'website_url', elementId: 'setting-website', fallback: '' },
    { sleutel: 'logo_url', elementId: 'setting-logo-url', fallback: '' },
    { sleutel: 'disclaimer', elementId: 'disclaimer-text', fallback: 'Deel geen persoonsgegevens of cliëntinformatie in deze chat.' }
  ];

  async function loadSettings() {
    var result = await supabaseClient
      .from('settings')
      .select('sleutel, waarde')
      .eq('tenant_id', tenantId);

    var waarden = {};
    if (result.data) {
      result.data.forEach(function (s) { waarden[s.sleutel] = s.waarde; });
    }

    settingsFields.forEach(function (field) {
      var el = document.getElementById(field.elementId);
      if (el) {
        el.value = waarden[field.sleutel] || field.fallback;
      }
    });

    var kleurInput = document.getElementById('setting-kleur');
    var kleurPicker = document.getElementById('setting-kleur-picker');
    kleurPicker.value = kleurInput.value || '#E8720C';

    kleurPicker.addEventListener('input', function () {
      kleurInput.value = kleurPicker.value;
    });

    kleurInput.addEventListener('input', function () {
      var val = kleurInput.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        kleurPicker.value = val;
      }
    });

    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    // Logo en organisatienaam in admin header
    console.log('[Admin] logo_url uit settings:', waarden.logo_url || '(leeg)');
    var adminLogoContainer = document.getElementById('admin-logo-container');
    if (adminLogoContainer && waarden.logo_url) {
      adminLogoContainer.innerHTML = '<img src="' + waarden.logo_url + '" alt="Logo" style="max-height:36px;width:auto;object-fit:contain;border-radius:6px">';
    }
    if (waarden.organisatienaam) {
      var adminTitle = document.getElementById('admin-header-title');
      if (adminTitle) adminTitle.textContent = waarden.organisatienaam;
    }

    // Toegestane websites
    loadToegestaneWebsites();
    document.getElementById('add-website-btn').addEventListener('click', addToegestaneWebsite);
  }

  async function saveSettings() {
    var alertBox = document.getElementById('settings-alert');
    var alertMsg = document.getElementById('settings-alert-message');
    alertBox.className = 'alert';

    var kleurVal = document.getElementById('setting-kleur').value.trim();
    if (kleurVal && !/^#[0-9A-Fa-f]{6}$/.test(kleurVal)) {
      alertBox.className = 'alert alert-error show';
      alertMsg.textContent = 'Ongeldige kleurcode. Gebruik het formaat #RRGGBB (bijv. #E8720C).';
      return;
    }

    var urlVal = document.getElementById('setting-website').value.trim();
    if (urlVal && !urlVal.startsWith('https://') && !urlVal.startsWith('http://')) {
      alertBox.className = 'alert alert-error show';
      alertMsg.textContent = 'Website URL moet beginnen met https:// of http://';
      return;
    }

    var disclaimerVal = document.getElementById('disclaimer-text').value.trim();
    if (!disclaimerVal) {
      alertBox.className = 'alert alert-error show';
      alertMsg.textContent = 'Disclaimer mag niet leeg zijn.';
      return;
    }

    var upserts = settingsFields.map(function (field) {
      var el = document.getElementById(field.elementId);
      return {
        tenant_id: tenantId,
        sleutel: field.sleutel,
        waarde: el.value.trim() || field.fallback,
        updated_at: new Date().toISOString()
      };
    });

    var result = await supabaseClient
      .from('settings')
      .upsert(upserts, { onConflict: 'tenant_id,sleutel' });

    if (result.error) {
      alertBox.className = 'alert alert-error show';
      alertMsg.textContent = 'Opslaan mislukt: ' + result.error.message;
    } else {
      alertBox.className = 'alert alert-success show';
      alertMsg.textContent = 'Instellingen opgeslagen.';
      setTimeout(function () {
        alertBox.className = 'alert';
      }, 3000);
    }
  }

  // =============================================
  // TOEGESTANE WEBSITES
  // =============================================
  async function loadToegestaneWebsites() {
    var container = document.getElementById('websites-list');
    if (!container) return;

    var result = await supabaseClient
      .from('toegestane_websites')
      .select('id, naam, url')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nog geen websites toegevoegd.</p>';
      return;
    }

    container.innerHTML = result.data.map(function (w) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600;font-size:0.85rem">' + escapeHtml(w.naam) + '</span>' +
        '<span style="font-size:0.8rem;color:var(--text-light);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(w.url) + '</span>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteWebsite(\'' + w.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div>';
    }).join('');
  }

  async function addToegestaneWebsite() {
    var naamEl = document.getElementById('website-naam');
    var urlEl = document.getElementById('website-url');
    var naam = naamEl.value.trim();
    var url = urlEl.value.trim();

    if (!naam || !url) { alert('Vul naam en URL in.'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) { alert('URL moet beginnen met http:// of https://'); return; }

    await supabaseClient.from('toegestane_websites').insert({
      tenant_id: tenantId,
      naam: naam,
      url: url
    });

    naamEl.value = '';
    urlEl.value = '';
    loadToegestaneWebsites();
  }

  window.deleteWebsite = async function (id) {
    if (!confirm('Website verwijderen?')) return;
    await supabaseClient.from('toegestane_websites').delete().eq('id', id);
    loadToegestaneWebsites();
  };

  // =============================================
  // FUNCTIEGROEPEN CONFIGURATIE
  // =============================================
  async function loadFunctiegroepen() {
    var result = await supabaseClient
      .from('functiegroepen')
      .select('id, code, naam, beschrijving, is_kantoor')
      .eq('tenant_id', tenantId)
      .order('naam');

    if (!result.data) return;
    allFunctiegroepen = result.data;

    // Populate dropdowns — toon alle functiegroepen (zorg + kantoor)
    var dropdowns = ['invite-functiegroep', 'edit-functiegroep'];
    dropdowns.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '<option value="">Kies een functiegroep</option>';
      result.data
        .forEach(function (fg) {
          var opt = document.createElement('option');
          opt.value = fg.code;
          opt.textContent = fg.naam;
          el.appendChild(opt);
        });
    });

    // Vul afdelingen-checkboxes in Leidinggevende/HR modal vanuit kantoor-functiegroepen
    var afdContainer = document.getElementById('tl-afdelingen');
    if (afdContainer) {
      var kantoorFgs = result.data.filter(function (fg) { return fg.is_kantoor; });
      afdContainer.innerHTML = kantoorFgs.map(function (fg) {
        return '<label style="display:flex;align-items:center;gap:4px;font-size:0.88rem">' +
          '<input type="checkbox" name="tl-afdelingen" value="' + escapeHtml(fg.naam) + '"> ' + escapeHtml(fg.naam) +
          '</label>';
      }).join('');
    }

    // Render list in settings
    var container = document.getElementById('functiegroepen-list');
    if (!container) return;
    if (result.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nog geen functiegroepen.</p>';
      return;
    }
    container.innerHTML = result.data.map(function (fg) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<strong style="font-size:0.85rem;min-width:100px">' + escapeHtml(fg.naam) + '</strong>' +
        '<span style="font-size:0.78rem;color:var(--text-light);flex:1;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(fg.beschrijving || '') + '</span>' +
        (fg.is_kantoor ? '<span class="badge badge-admin" style="font-size:0.65rem">Kantoor</span>' : '') +
        '<button class="btn-icon" onclick="window.editFunctiegroep(\'' + fg.id + '\')" title="Bewerken">✏️</button>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteFunctiegroep(\'' + fg.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div>';
    }).join('');
  }

  window.deleteFunctiegroep = async function (id) {
    if (!confirm('Functiegroep verwijderen?')) return;
    await supabaseClient.from('functiegroepen').delete().eq('id', id);
    loadFunctiegroepen();
  };

  window.editFunctiegroep = async function (id) {
    var result = await supabaseClient.from('functiegroepen').select('*').eq('id', id).single();
    if (!result.data) return;
    var fg = result.data;

    var naam = prompt('Naam:', fg.naam);
    if (naam === null) return;
    var code = prompt('Code (steekwoorden, komma-gescheiden):', fg.code);
    if (code === null) return;
    var beschrijving = prompt('Beschrijving (voor AI prompt):', fg.beschrijving || '');
    if (beschrijving === null) return;
    var isKantoor = confirm('Is dit kantoorpersoneel? (OK = ja, Annuleren = nee)');

    await supabaseClient.from('functiegroepen').update({
      naam: naam.trim() || fg.naam,
      beschrijving: beschrijving.trim(),
      code: code.trim().toLowerCase().replace(/\s+/g, '_') || fg.code,
      is_kantoor: isKantoor
    }).eq('id', id);

    loadFunctiegroepen();
  };

  (function initFgBtn() {
    var btn = document.getElementById('add-fg-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var code = document.getElementById('fg-code').value.trim().toLowerCase().replace(/\s+/g, '_');
      var naam = document.getElementById('fg-naam').value.trim();
      var isKantoor = document.getElementById('fg-is-kantoor') ? document.getElementById('fg-is-kantoor').checked : false;
      if (!code || !naam) { alert('Vul code en naam in.'); return; }
      await supabaseClient.from('functiegroepen').insert({
        tenant_id: tenantId, code: code, naam: naam, beschrijving: '', is_kantoor: isKantoor
      });
      document.getElementById('fg-code').value = '';
      document.getElementById('fg-naam').value = '';
      loadFunctiegroepen();
    });
  })();

  // =============================================
  // RAPPORTEN
  // =============================================
  async function loadRapporten() {
    var container = document.getElementById('rapporten-list');
    if (!container) return;
    var result = await supabaseClient
      .from('rapporten')
      .select('id, maand, inhoud, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:24px;text-align:center">Nog geen rapporten beschikbaar.</p>';
      return;
    }
    container.innerHTML = result.data.map(function (r) {
      return '<div class="kennisbank-item" style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;cursor:pointer" onclick="window.showRapport(\'' + r.id + '\')">' +
          '<div class="kennisbank-item-vraag">Rapport ' + escapeHtml(r.maand) + '</div>' +
          '<div class="kennisbank-item-antwoord">' + new Date(r.created_at).toLocaleDateString('nl-NL') + '</div>' +
        '</div>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteRapport(\'' + r.id + '\')" title="Verwijderen">🗑️</button>' +
        '</div>';
    }).join('');
  }

  // ---- Helper: bereken datum range op basis van filter ----
  function berekenDatumRange(tijdsbestek) {
    var nu = new Date();
    var van, tot, label;
    function startVanWeek(d) {
      var dag = d.getDay();
      var diff = (dag === 0 ? -6 : 1 - dag);
      var ma = new Date(d);
      ma.setDate(d.getDate() + diff);
      ma.setHours(0, 0, 0, 0);
      return ma;
    }
    if (tijdsbestek === 'deze_week') {
      van = startVanWeek(nu);
      tot = new Date(); tot.setHours(23, 59, 59, 999);
      label = 'Deze week';
    } else if (tijdsbestek === 'vorige_week') {
      var deze = startVanWeek(nu);
      van = new Date(deze); van.setDate(deze.getDate() - 7);
      tot = new Date(deze); tot.setMilliseconds(-1);
      label = 'Vorige week';
    } else if (tijdsbestek === 'deze_maand') {
      van = new Date(nu.getFullYear(), nu.getMonth(), 1);
      tot = new Date(); tot.setHours(23, 59, 59, 999);
      label = nu.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    } else if (tijdsbestek === 'vorige_maand') {
      van = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
      tot = new Date(nu.getFullYear(), nu.getMonth(), 0); tot.setHours(23, 59, 59, 999);
      label = van.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    } else if (tijdsbestek === 'dit_kwartaal') {
      var qStart = Math.floor(nu.getMonth() / 3) * 3;
      van = new Date(nu.getFullYear(), qStart, 1);
      tot = new Date(); tot.setHours(23, 59, 59, 999);
      label = 'Q' + (Math.floor(nu.getMonth() / 3) + 1) + ' ' + nu.getFullYear();
    } else {
      // aangepast — wordt meegegeven
      var vanInput = document.getElementById('rap-van').value;
      var totInput = document.getElementById('rap-tot').value;
      van = vanInput ? new Date(vanInput) : new Date(nu.getFullYear(), nu.getMonth(), 1);
      tot = totInput ? new Date(totInput) : new Date();
      tot.setHours(23, 59, 59, 999);
      label = van.toLocaleDateString('nl-NL') + ' – ' + tot.toLocaleDateString('nl-NL');
    }
    return { van: van, tot: tot, label: label };
  }

  // Haal alle unieke teams op uit de teamleiders.teams[] kolom voor de huidige tenant.
  // Werkt onafhankelijk van de globale allTeamleiders cache (die wordt async gevuld).
  async function fetchTeamsVoorTenant() {
    var result = await supabaseClient
      .from('teamleiders')
      .select('teams')
      .eq('tenant_id', tenantId);
    if (result.error || !result.data) {
      console.error('[fetchTeamsVoorTenant] fout:', result.error);
      return [];
    }
    var set = {};
    result.data.forEach(function (tl) {
      if (Array.isArray(tl.teams)) tl.teams.forEach(function (t) { if (t) set[t] = true; });
    });
    return Object.keys(set).sort();
  }

  function vulTeamSelect(selectEl, teams) {
    if (!selectEl) return;
    // Bewaar bestaande "Alle teams" optie en eventuele huidige selectie
    var huidig = selectEl.value;
    var bestaand = {};
    Array.prototype.forEach.call(selectEl.options, function (o) { bestaand[o.value] = true; });
    teams.forEach(function (t) {
      if (bestaand[t]) return;
      var opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      selectEl.appendChild(opt);
    });
    if (huidig) selectEl.value = huidig;
  }

  function initRapportBtn() {
    var btn = document.getElementById('generate-rapport-btn');
    if (!btn) return;

    // Filter: aangepaste periode tonen/verbergen
    var tijdSelect = document.getElementById('rap-tijdsbestek');
    var aangepastVelden = document.getElementById('rap-aangepast-velden');
    if (tijdSelect && aangepastVelden) {
      tijdSelect.addEventListener('change', function () {
        aangepastVelden.style.display = tijdSelect.value === 'aangepast' ? 'flex' : 'none';
      });
    }

    // Vul team filter dropdowns ASYNC uit teamleiders.teams[] (huidige tenant)
    // Dit moet async omdat loadTeamleiders mogelijk nog niet klaar is.
    fetchTeamsVoorTenant().then(function (teams) {
      console.log('[Rapport teams] gevonden:', teams.length, teams);
      vulTeamSelect(document.getElementById('rap-team'), teams);
      vulTeamSelect(document.getElementById('tb-team-select'), teams);
    });
    var teamSelect = document.getElementById('rap-team');

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Genereren...';

      var tijdsbestek = tijdSelect ? tijdSelect.value : 'deze_maand';
      var range = berekenDatumRange(tijdsbestek);
      var teamFilter = teamSelect ? teamSelect.value : '';

      var inclGebruik = document.getElementById('rap-incl-gebruik').checked;
      var inclKwaliteit = document.getElementById('rap-incl-kwaliteit').checked;
      var inclTijdwinst = document.getElementById('rap-incl-tijdwinst').checked;
      var inclVertrouwen = document.getElementById('rap-incl-vertrouwen').checked;
      var inclQuiz = document.getElementById('rap-incl-quiz').checked;

      // Gather data binnen tijdsbestek
      var convResult = await supabaseClient.from('conversations').select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', range.van.toISOString())
        .lte('created_at', range.tot.toISOString());
      var profResult = await supabaseClient.from('profiles').select('*').eq('tenant_id', tenantId);
      var convs = convResult.data || [];
      var profs = profResult.data || [];

      // Team filter: filter conversations op user_id van profiles in dat team
      if (teamFilter) {
        var teamProfileIds = profs.filter(function (p) {
          return p.teams && p.teams.indexOf(teamFilter) !== -1;
        }).map(function (p) { return p.id; });
        convs = convs.filter(function (c) { return teamProfileIds.indexOf(c.user_id) !== -1; });
      }

      var medewerkers = profs.filter(function(p) { return p.role === 'medewerker'; });
      if (teamFilter) {
        medewerkers = medewerkers.filter(function (p) {
          return p.teams && p.teams.indexOf(teamFilter) !== -1;
        });
      }
      var actief = medewerkers.filter(function(p) {
        return convs.some(function(c) { return c.user_id === p.id; });
      });
      var inactief = medewerkers.filter(function(p) {
        return !convs.some(function(c) { return c.user_id === p.id; });
      });

      var metFeedback = convs.filter(function(c) { return c.feedback !== null; });
      var positief = metFeedback.filter(function(c) { return c.feedback === 'goed'; });
      var pct = metFeedback.length > 0 ? Math.round((positief.length / metFeedback.length) * 100) : 0;

      // Eerlijke tijdwinst
      var aantalVragen = convs.length;
      var medewerkerMinutenBespaard = aantalVragen * 6; // 8 min - 2 min wegwijzer
      var teamleiderMinutenVrij = aantalVragen * 8;

      var rapport = {
        periode: range.label,
        team_filter: teamFilter || 'alle teams',
        secties: {
          gebruik: inclGebruik,
          kwaliteit: inclKwaliteit,
          tijdwinst: inclTijdwinst,
          vertrouwen: inclVertrouwen,
          quiz: inclQuiz
        },
        gebruik: { actief: actief.length, inactief: inactief.length, totaal_vragen: aantalVragen },
        kwaliteit: { positief_percentage: pct, totaal_met_feedback: metFeedback.length },
        tijdwinst: {
          vragen: aantalVragen,
          medewerker_minuten_bespaard: medewerkerMinutenBespaard,
          teamleider_minuten_vrij: teamleiderMinutenVrij,
          medewerker_uren: Math.round(medewerkerMinutenBespaard / 60 * 10) / 10,
          teamleider_uren: Math.round(teamleiderMinutenVrij / 60 * 10) / 10
        },
        aanbevelingen: []
      };

      // Vertrouwenscheck data — alleen gedeelde scores
      if (inclVertrouwen) {
        var vcResult = await supabaseClient.from('vertrouwens_scores').select('score, week_nummer').eq('gedeeld', true);
        var vcData = vcResult.data || [];
        if (vcData.length > 0) {
          var som = vcData.reduce(function (s, v) { return s + v.score; }, 0);
          rapport.vertrouwen = { aantal: vcData.length, gemiddelde: Math.round(som / vcData.length * 10) / 10 };
        }
      }

      // Quiz data — alleen gedeelde resultaten
      if (inclQuiz) {
        var quizResult = await supabaseClient.from('quiz_resultaten').select('score').eq('gedeeld', true);
        var quizData = quizResult.data || [];
        if (quizData.length > 0) {
          var quizSom = quizData.reduce(function (s, q) { return s + (q.score || 0); }, 0);
          rapport.quiz = { aantal: quizData.length, gemiddelde: Math.round(quizSom / quizData.length * 10) / 10 };
        }
      }

      if (pct < 70 && metFeedback.length > 10) rapport.aanbevelingen.push('Positief percentage is onder 70% — overweeg de kennisbank aan te vullen.');
      if (inactief.length > actief.length) rapport.aanbevelingen.push('Meer inactieve dan actieve accounts — controleer of alle medewerkers op de hoogte zijn.');
      if (aantalVragen > 500) rapport.aanbevelingen.push('Hoog gebruik — overweeg extra documenten toe te voegen voor veelgestelde onderwerpen.');

      await supabaseClient.from('rapporten').insert({
        tenant_id: tenantId, maand: range.label, inhoud: rapport
      });

      btn.disabled = false;
      btn.textContent = 'Rapport genereren';
      loadRapporten();
    });
  }

  window.deleteRapport = async function (id) {
    if (!confirm('Weet je zeker dat je dit rapport wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    await supabaseClient.from('rapporten').delete().eq('id', id);
    loadRapporten();
  };

  window.showRapport = function (id) {
    var container = document.getElementById('rapporten-list');
    supabaseClient.from('rapporten').select('*').eq('id', id).single().then(function (result) {
      if (!result.data) return;
      var r = result.data.inhoud;
      var secties = r.secties || { gebruik: true, kwaliteit: true, tijdwinst: true };
      var html = '<div style="background:var(--bg-white);padding:24px;border-radius:var(--radius);margin-top:16px;border:1px solid var(--border)">' +
        '<h3>Rapport ' + escapeHtml(result.data.maand) + '</h3>' +
        '<p style="color:var(--text-muted);font-size:0.85rem">Periode: ' + escapeHtml(r.periode || result.data.maand) + ' • ' + escapeHtml(r.team_filter || 'alle teams') + '</p>';

      if (secties.gebruik !== false && r.gebruik) {
        html += '<h4 style="margin-top:16px;color:var(--primary)">📊 Gebruik</h4>' +
          '<p>Actieve medewerkers: <strong>' + r.gebruik.actief + '</strong> | Inactief: <strong>' + r.gebruik.inactief + '</strong> | Totaal vragen: <strong>' + r.gebruik.totaal_vragen + '</strong></p>';
      }
      if (secties.kwaliteit !== false && r.kwaliteit) {
        html += '<h4 style="margin-top:16px;color:var(--primary)">⭐ Kwaliteit</h4>' +
          '<p>Positieve feedback: <strong>' + r.kwaliteit.positief_percentage + '%</strong> (van ' + r.kwaliteit.totaal_met_feedback + ' beoordeelde antwoorden)</p>';
      }
      if (secties.tijdwinst !== false && r.tijdwinst) {
        // Backwards-compat: oude rapporten hadden geschatte_minuten
        if (typeof r.tijdwinst.medewerker_minuten_bespaard !== 'undefined') {
          html += '<h4 style="margin-top:16px;color:var(--primary)">⏱️ Tijdwinst</h4>' +
            '<p><strong>Teamleider tijdwinst:</strong> ' + r.tijdwinst.vragen + ' vragen × 8 min (zonder Wegwijzer) = ' + r.tijdwinst.teamleider_minuten_vrij + ' minuten (' + r.tijdwinst.teamleider_uren + ' uur) vrijgekomen</p>' +
            '<p><strong>Medewerker tijdwinst:</strong> ' + r.tijdwinst.vragen + ' vragen × 6 min (wachten + zoeken − 2 min Wegwijzer gebruik) = ' + r.tijdwinst.medewerker_minuten_bespaard + ' minuten (' + r.tijdwinst.medewerker_uren + ' uur) bespaard</p>' +
            '<p style="margin-top:8px"><strong>Voordelen:</strong></p>' +
            '<ul style="margin:4px 0 0 18px"><li>Antwoord direct beschikbaar zonder wachten</li><li>Antwoord terug te lezen wanneer nodig</li><li>Brondocument direct zichtbaar</li><li>Beschikbaar buiten kantooruren</li></ul>' +
            '<p style="font-size:0.72rem;color:var(--text-muted);font-style:italic;margin-top:8px">Disclaimer: schatting op basis van gemiddeld 8 minuten per vraag zonder Wegwijzer vs 2 minuten met Wegwijzer.</p>';
        } else {
          html += '<h4 style="margin-top:16px;color:var(--primary)">⏱️ Tijdwinst (oud rapport)</h4>' +
            '<p>' + (r.tijdwinst.vragen || 0) + ' vragen × 10 min = ' + (r.tijdwinst.geschatte_minuten || 0) + ' minuten</p>';
        }
      }
      if (secties.vertrouwen && r.vertrouwen) {
        html += '<h4 style="margin-top:16px;color:var(--primary)">🤝 Vertrouwenscheck</h4>' +
          '<p>Gemiddelde score: <strong>' + r.vertrouwen.gemiddelde + '/5</strong> (' + r.vertrouwen.aantal + ' metingen)</p>';
      }
      if (secties.quiz && r.quiz) {
        html += '<h4 style="margin-top:16px;color:var(--primary)">📝 Quiz</h4>' +
          '<p>Gemiddelde score: <strong>' + r.quiz.gemiddelde + '</strong> (' + r.quiz.aantal + ' resultaten)</p>';
      }

      if (r.aanbevelingen && r.aanbevelingen.length > 0) {
        html += '<h4 style="margin-top:16px;color:var(--primary)">💡 Aanbevelingen</h4><ul>';
        r.aanbevelingen.forEach(function (a) { html += '<li>' + escapeHtml(a) + '</li>'; });
        html += '</ul>';
      }
      html += '</div>';
      container.innerHTML += html;
    });
  };

  // =============================================
  // TERUGBLIK EMAIL
  // =============================================
  (function initTerugblikBtn() {
    var btn = document.getElementById('test-terugblik-btn');
    var modal = document.getElementById('modal-terugblik');
    var cancelBtn = document.getElementById('tb-cancel');
    var verstuurBtn = document.getElementById('tb-verstuur');
    var teamSelect = document.getElementById('tb-team-select');
    var tlSelect = document.getElementById('tb-tl-select');
    var resultEl = document.getElementById('tb-result');

    if (!btn || !modal) return;

    btn.addEventListener('click', function () {
      // Vul team dropdown
      if (teamSelect) {
        teamSelect.innerHTML = '<option value="">Alle teams</option>';
        var teamSet = {};
        allTeamleiders.forEach(function (tl) {
          if (tl.teams) tl.teams.forEach(function (t) { teamSet[t] = true; });
        });
        Object.keys(teamSet).sort().forEach(function (t) {
          var opt = document.createElement('option');
          opt.value = t; opt.textContent = t;
          teamSelect.appendChild(opt);
        });
      }
      // Vul teamleider dropdown
      vulTlDropdown('');
      if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
      modal.classList.add('show');
    });

    function vulTlDropdown(teamFilter) {
      if (!tlSelect) return;
      tlSelect.innerHTML = '<option value="">Alle leidinggevenden</option>';
      var filtered = allTeamleiders;
      if (teamFilter) {
        filtered = allTeamleiders.filter(function (tl) {
          return tl.teams && tl.teams.indexOf(teamFilter) !== -1;
        });
      }
      filtered.forEach(function (tl) {
        var opt = document.createElement('option');
        opt.value = tl.id;
        opt.textContent = tl.naam + (tl.email ? ' (' + tl.email + ')' : ' (geen email)');
        tlSelect.appendChild(opt);
      });
    }

    if (teamSelect) {
      teamSelect.addEventListener('change', function () {
        vulTlDropdown(teamSelect.value);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { modal.classList.remove('show'); });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('show');
    });

    if (verstuurBtn) {
      verstuurBtn.addEventListener('click', async function () {
        verstuurBtn.disabled = true;
        verstuurBtn.textContent = 'Versturen...';

        try {
          var session = await supabaseClient.auth.getSession();
          var token = session.data.session.access_token;
          var bodyData = { generate_terugblik: true, is_test: true };
          if (tlSelect && tlSelect.value) bodyData.teamleider_id = tlSelect.value;
          if (teamSelect && teamSelect.value) bodyData.team_filter = teamSelect.value;

          var resp = await fetch(SUPABASE_URL + '/functions/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(bodyData)
          });
          var data = await resp.json();

          if (resultEl) {
            resultEl.style.display = '';
            if (data.error) {
              resultEl.innerHTML = '<div class="alert alert-error show">' + escapeHtml(data.error) + '</div>';
            } else {
              var namen = data.ontvangers ? data.ontvangers.join('<br>') : (data.aantal_ontvangers + ' ontvanger(s)');
              resultEl.innerHTML = '<div class="alert alert-success show">Terugblik verstuurd naar:<br><strong>' + namen + '</strong></div>';
              loadTerugblikLog();
              setTimeout(function () { modal.classList.remove('show'); }, 3000);
            }
          }
        } catch (err) {
          if (resultEl) {
            resultEl.style.display = '';
            resultEl.innerHTML = '<div class="alert alert-error show">Versturen mislukt.</div>';
          }
        }
        verstuurBtn.disabled = false;
        verstuurBtn.textContent = 'Terugblik versturen';
      });
    }
  })();

  async function loadTerugblikLog() {
    var container = document.getElementById('terugblik-log-list');
    if (!container) return;
    var result = await supabaseClient.from('terugblik_log').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10);
    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nog geen terugblikken verstuurd.</p>';
      return;
    }
    container.innerHTML = result.data.map(function (t, idx) {
      var datum = new Date(t.verstuurd_op || t.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      var statusBadge = t.status === 'verstuurd' ? '<span class="badge badge-goed">Verstuurd</span>'
        : t.status === 'test' ? '<span class="badge badge-admin">Test</span>'
        : '<span class="badge badge-niet-goed">Mislukt</span>';

      var ontvangersTekst = '-';
      if (t.ontvangers && Array.isArray(t.ontvangers) && t.ontvangers.length > 0) {
        ontvangersTekst = t.ontvangers.map(function (o) { return escapeHtml(o); }).join('<br>');
      }

      var teamTekst = t.team ? escapeHtml(t.team) : 'Alle teams';
      var foutTekst = t.foutmelding ? '<div style="color:var(--error);font-size:0.78rem;margin-top:4px">' + escapeHtml(t.foutmelding) + '</div>' : '';

      var detailId = 'terugblik-detail-' + idx;
      var bekijkBtn = t.inhoud ? '<button class="btn-icon" onclick="window.toggleTerugblikDetail(\'' + detailId + '\')" title="Bekijk rapport">📊</button>' : '';
      var verwijderBtn = '<button class="btn-icon btn-icon-danger" onclick="window.deleteTerugblikLog(\'' + t.id + '\')" title="Verwijderen uit log">🗑️</button>';

      var detailHtml = '';
      if (t.inhoud) {
        try {
          var data = JSON.parse(t.inhoud);
          var s = data.statistieken || {};
          var tw = data.tijdwinst || {};
          detailHtml = '<div id="' + detailId + '" style="display:none;background:var(--bg);padding:12px;border-radius:8px;margin-top:8px;font-size:0.82rem">' +
            '<strong>Statistieken</strong>' +
            '<div style="margin:4px 0">Totaal vragen: ' + (s.totaal_vragen || 0) + '</div>' +
            '<div>Positieve feedback: ' + (s.positief_feedback || 0) + ' (' + (s.positief_percentage || 0) + '%)</div>' +
            '<div>Negatieve feedback: ' + (s.negatief_feedback || 0) + '</div>' +
            '<div>Actieve medewerkers: ' + (s.actieve_medewerkers || 0) + ' van ' + (s.totaal_medewerkers || 0) + '</div>' +
            '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">' +
            '<strong>Tijdwinst (schatting)</strong>' +
            '<div>' + (s.totaal_vragen || 0) + ' vragen × 8 min = ' + (tw.uren || 0) + ' uur</div>' +
            '<div>Equivalent: €' + (tw.kosten_euro || 0) + '</div>' +
            '</div>';
        } catch (e) { detailHtml = ''; }
      }

      return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem">' +
          '<div><strong>' + escapeHtml(t.maand || '') + '</strong><br><span style="color:var(--text-muted);font-size:0.78rem">' + datum + ' · ' + teamTekst + '</span></div>' +
          '<div style="text-align:right">' + statusBadge + ' ' + bekijkBtn + ' ' + verwijderBtn + '<br><span style="font-size:0.78rem;color:var(--text-muted)">' + (t.aantal_ontvangers || 0) + ' ontvanger(s)</span></div>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--text-light);margin-top:4px">' + ontvangersTekst + '</div>' +
        foutTekst +
        detailHtml +
        '</div>';
    }).join('');
  }

  window.toggleTerugblikDetail = function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  };

  window.deleteTerugblikLog = async function (id) {
    if (!confirm('Weet je zeker dat je deze terugblik wilt verwijderen uit de log?')) return;
    console.log('[DELETE terugblik-log] Verwijder id:', id);
    var result = await supabaseClient
      .from('terugblik_log')
      .delete()
      .eq('id', id)
      .select();
    console.log('[DELETE terugblik-log] Response:', result.error, 'rows:', result.data);
    if (result.error) {
      alert('Verwijderen mislukt: ' + result.error.message);
      return;
    }
    if (!result.data || result.data.length === 0) {
      alert('Geen rij verwijderd — mogelijk een rechten-issue. Check console.');
      return;
    }
    loadTerugblikLog();
  };

  // =============================================
  // PRIVACY VERZOEKEN
  // =============================================
  async function loadPrivacyVerzoeken() {
    var tbody = document.getElementById('privacy-body');
    if (!tbody) return;

    var result = await supabaseClient
      .from('privacy_verzoeken')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="no-data">Geen privacy verzoeken.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (pv) {
      var datum = new Date(pv.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      var typeBadge = '';
      if (pv.type === 'inzage') typeBadge = '<span class="badge badge-admin">Inzage</span>';
      else if (pv.type === 'correctie') typeBadge = '<span class="badge badge-open">Correctie</span>';
      else typeBadge = '<span class="badge badge-niet-goed">Verwijdering</span>';

      var statusBadge = '';
      if (pv.status === 'ontvangen') statusBadge = '<span class="badge badge-open">Nieuw</span>';
      else if (pv.status === 'in_behandeling') statusBadge = '<span class="badge badge-admin">In behandeling</span>';
      else statusBadge = '<span class="badge badge-goed">Afgehandeld</span>';

      var acties = '';
      if (pv.status !== 'afgehandeld') {
        acties = '<button class="btn-icon" onclick="window.handlePrivacyInzage(\'' + escapeHtml(pv.email) + '\')" title="Inzage (export)">📋</button>' +
          '<button class="btn-icon btn-icon-danger" onclick="window.handlePrivacyVerwijdering(\'' + pv.id + '\', \'' + escapeHtml(pv.email) + '\')" title="Verwijdering">🗑️</button>' +
          '<button class="btn-icon" onclick="window.handlePrivacyCorrectie(\'' + escapeHtml(pv.email) + '\')" title="Correctie (profiel)">✏️</button>';
      }

      return '<tr>' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td>' + escapeHtml(pv.naam) + '</td>' +
        '<td>' + escapeHtml(pv.email) + '</td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + acties + '</td>' +
        '</tr>';
    }).join('');
  }

  window.handlePrivacyInzage = async function (email) {
    // Zoek profiel
    var profResult = await supabaseClient.from('profiles').select('*').eq('email', email).single();
    if (!profResult.data) { alert('Profiel niet gevonden.'); return; }

    var profiel = profResult.data;
    var convResult = await supabaseClient.from('conversations').select('vraag, antwoord, feedback, created_at').eq('user_id', profiel.id).order('created_at');

    var exportData = {
      profiel: {
        naam: profiel.naam,
        email: profiel.email,
        functiegroep: profiel.functiegroep,
        teams: profiel.teams,
        werkuren: profiel.werkuren,
        startdatum: profiel.startdatum,
        afdeling: profiel.afdeling
      },
      gesprekken: (convResult.data || []).map(function (c) {
        return { datum: c.created_at, vraag: c.vraag, antwoord: c.antwoord, feedback: c.feedback };
      })
    };

    // Download als JSON
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'privacy_export_' + email.replace(/@/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);

    // Update status
    await supabaseClient.from('privacy_verzoeken').update({ status: 'afgehandeld' }).eq('tenant_id', tenantId).match({ email: email, type: 'inzage' });
    loadPrivacyVerzoeken();
  };

  window.handlePrivacyVerwijdering = async function (id, email) {
    if (!confirm('WAARSCHUWING: Alle data van ' + email + ' wordt permanent verwijderd. Dit kan niet ongedaan worden gemaakt. Doorgaan?')) return;

    var profResult = await supabaseClient.from('profiles').select('id').eq('email', email).single();
    if (profResult.data) {
      // Verwijder gesprekken
      await supabaseClient.from('conversations').delete().eq('user_id', profResult.data.id);
      // Verwijder profiel
      await supabaseClient.from('profiles').delete().eq('id', profResult.data.id);
    }

    // Update status
    await supabaseClient.from('privacy_verzoeken').update({ status: 'afgehandeld' }).eq('id', id);
    alert('Data van ' + email + ' is verwijderd.');
    loadPrivacyVerzoeken();
    loadMedewerkers();
  };

  window.handlePrivacyCorrectie = function (email) {
    var profiel = allProfiles.find(function (p) { return p.email === email; });
    if (profiel) {
      window.editMedewerker(profiel.id);
    } else {
      alert('Profiel niet gevonden.');
    }
  };

  // =============================================
  // DOCUMENT AANVRAGEN
  // =============================================
  async function loadDocumentAanvragen() {
    var tbody = document.getElementById('doc-aanvragen-body');
    if (!tbody) return;

    var result = await supabaseClient
      .from('document_aanvragen')
      .select('*')
      .order('created_at', { ascending: false });

    // Badge bijwerken
    var nieuw = (result.data || []).filter(function (da) { return da.status === 'nieuw'; }).length;
    updateTabBadge('doc-aanvragen', nieuw);

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Geen document aanvragen.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (da) {
      var datum = new Date(da.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
      var statusBadge = da.status === 'nieuw' ? '<span class="badge badge-open">Nieuw</span>'
        : da.status === 'gepubliceerd' ? '<span class="badge badge-goed">Toegevoegd</span>'
        : '<span class="badge badge-niet-goed">Afgewezen</span>';
      var acties = '';
      if (da.status === 'nieuw') {
        acties = '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto;margin-bottom:4px" onclick="window.editDocAanvraag(\'' + da.id + '\')" title="Bewerk vraagtekst">✏️ Bewerken</button>' +
          '<button class="btn btn-primary" style="padding:4px 8px;font-size:0.7rem;width:auto;margin-bottom:4px;background:var(--success)" onclick="window.publiceerDocAanvraag(\'' + da.id + '\')" title="Voeg toe aan kennisbank">✅ Toevoegen aan kennisbank</button>' +
          '<button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem;width:auto;margin-bottom:4px" onclick="window.afwijsDocAanvraag(\'' + da.id + '\')" title="Aanvraag afwijzen">❌ Afwijzen</button>';
      }
      acties += '<button class="btn-icon btn-icon-danger" onclick="window.deleteDocAanvraag(\'' + da.id + '\')" title="Verwijderen">🗑️</button>';

      return '<tr>' +
        '<td>' + datum + '</td>' +
        '<td><div style="white-space:pre-wrap;font-size:0.85rem" class="da-vraag-' + da.id + '">' + escapeHtml(da.vraag) + '</div></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><div style="display:flex;flex-direction:column;gap:2px">' + acties + '</div></td></tr>';
    }).join('');
  }

  window.editDocAanvraag = async function (id) {
    var huidigEl = document.querySelector('.da-vraag-' + id);
    if (!huidigEl) return;
    var huidig = huidigEl.textContent;
    var nieuw = prompt('Bewerk de aanvraag tekst:', huidig);
    if (nieuw === null) return;
    nieuw = nieuw.trim();
    if (!nieuw) return;
    var result = await supabaseClient.from('document_aanvragen').update({ vraag: nieuw }).eq('id', id);
    if (result.error) { alert('Bewerken mislukt: ' + result.error.message); return; }
    loadDocumentAanvragen();
  };

  window.deleteDocAanvraag = async function (id) {
    if (!confirm('Document aanvraag verwijderen?')) return;
    var result = await supabaseClient.from('document_aanvragen').delete().eq('id', id);
    if (result.error) { alert('Verwijderen mislukt: ' + result.error.message); return; }
    loadDocumentAanvragen();
  };

  window.publiceerDocAanvraag = async function (id) {
    var result = await supabaseClient.from('document_aanvragen').select('*').eq('id', id).single();
    if (!result.data) return;
    var da = result.data;

    // Vraag de admin om de inhoud handmatig in te voeren (geen AI generatie meer)
    var inhoud = prompt('Geef de inhoud van het nieuwe kennisbank document.\n\nAanvraag: ' + da.vraag + '\n\nLaat leeg om alleen de aanvraag tekst als placeholder document op te slaan.', '');
    if (inhoud === null) return;
    inhoud = inhoud.trim() || da.vraag;

    // Voeg toe als document
    var insertResult = await supabaseClient.from('documents').insert({
      tenant_id: tenantId,
      naam: 'Aanvraag: ' + da.vraag.substring(0, 60),
      bestandspad: '',
      content: inhoud,
      documenttype: 'overig'
    });
    if (insertResult.error) { alert('Toevoegen mislukt: ' + insertResult.error.message); return; }

    await supabaseClient.from('document_aanvragen').update({ status: 'gepubliceerd' }).eq('id', id);
    loadDocumentAanvragen();
    loadDocuments();
  };

  window.afwijsDocAanvraag = async function (id) {
    await supabaseClient.from('document_aanvragen').update({ status: 'afgewezen' }).eq('id', id);
    loadDocumentAanvragen();
  };

  // =============================================
  // VERTROUWENSCHECK DATA
  // =============================================
  async function loadVertrouwensData() {
    var tbody = document.getElementById('vertrouwen-body');
    if (!tbody) return;

    // Haal alleen scores op die expliciet zijn gedeeld door de medewerker
    var result = await supabaseClient
      .from('vertrouwens_scores')
      .select('user_id, week_nummer, score, gedeeld, created_at')
      .eq('gedeeld', true)
      .order('created_at', { ascending: false });

    var gedeeld = (result.data || []);

    // Statistieken: gemiddelde over gedeelde scores
    var gemEl = document.getElementById('vc-gem-score');
    var sigEl = document.getElementById('vc-signalen');
    if (gemEl) {
      if (gedeeld.length > 0) {
        var totaal = gedeeld.reduce(function (a, b) { return a + b.score; }, 0);
        gemEl.textContent = (totaal / gedeeld.length).toFixed(1);
      } else {
        gemEl.textContent = '-';
      }
    }
    if (sigEl) sigEl.textContent = gedeeld.length;

    // Sectie verbergen als er geen gedeelde scores zijn
    var sectie = document.getElementById('vertrouwen-sectie');
    if (sectie) sectie.style.display = gedeeld.length > 0 ? '' : 'none';

    if (gedeeld.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Geen medewerkers hebben hun score gedeeld.</td></tr>';
      return;
    }

    // Zoek namen op
    var userIds = gedeeld.map(function (s) { return s.user_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var profielResult = await supabaseClient.from('profiles').select('user_id, naam').in('user_id', userIds);
    var naamMap = {};
    if (profielResult.data) {
      profielResult.data.forEach(function (p) { naamMap[p.user_id] = p.naam; });
    }

    tbody.innerHTML = gedeeld.map(function (s) {
      var naam = naamMap[s.user_id] || 'Onbekend';
      var sterren = '';
      for (var i = 0; i < 5; i++) sterren += i < s.score ? '⭐' : '☆';
      return '<tr>' +
        '<td>' + escapeHtml(naam) + '</td>' +
        '<td>Week ' + s.week_nummer + '</td>' +
        '<td>' + sterren + ' (' + s.score + '/5)</td>' +
        '<td><span class="badge badge-goed">Gedeeld</span></td>' +
        '</tr>';
    }).join('');
  }

})();
