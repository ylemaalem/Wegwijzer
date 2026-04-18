// =============================================
// WEGWIJZER — Teamleider dashboard logica
// =============================================

(function () {
  'use strict';

  var tenantId = null;
  var profile = null;
  var teamProfiles = [];
  var tlRol = 'teamleider';       // 'teamleider' | 'manager' | 'hr'
  var tlTeams = null;
  var heeftTeams = false;

  document.addEventListener('wegwijzer-auth-ready', async function (e) {
    profile = e.detail.profile;
    var user = e.detail.user;
    tenantId = profile.tenant_id;

    // Haal rol en teams op uit teamleiders-tabel
    try {
      var tlResult = await supabaseClient
        .from('teamleiders')
        .select('rol, teams, naam, titel')
        .eq('tenant_id', tenantId)
        .eq('email', user.email)
        .maybeSingle();
      if (tlResult.data) {
        tlRol = tlResult.data.rol || 'teamleider';
        tlTeams = tlResult.data.teams || null;
        heeftTeams = !!(tlTeams && tlTeams.length > 0);
      }
    } catch (err) {
      console.warn('[TL] Kon teamleiders rol niet ophalen:', err);
    }
    // Fallbacks: als iemand manager/hr is en per ongeluk teams heeft, beschouw als teamleider-modus
    if (tlRol !== 'manager' && tlRol !== 'hr') tlRol = 'teamleider';
    console.log('[TL] Rol:', tlRol, 'heeftTeams:', heeftTeams, 'teams:', tlTeams);

    applyRoleVisibility();
    initTabs();
    initLogout();
    loadHeaderLogo();
    await loadTlaFunctiegroepen();

    if (tlRol === 'teamleider') {
      await loadTeamMedewerkers();
      loadTeamGesprekken();
      loadTeamMeldingen();
      loadTeamVertrouwen();
      loadTeamQuiz();
    } else if (tlRol === 'hr') {
      // HR heeft geen team-lijst maar heeft wel medewerkers nodig voor team-dropdown
      await loadAllTenantMedewerkers();
    }

    loadTeamStatistieken();
    loadMijnAanvragen();
    initAanvraagModal();
    initTrendanalyse();
    loadTrendanalyseGeschiedenis();

    if (tlRol === 'teamleider' || tlRol === 'hr') {
      initDocIndienen();
      loadDocIngediend();
    }

    if (tlRol === 'hr') {
      loadOnboardingChecklist();
    }
  });

  // =============================================
  // ROL-GEBASEERDE ZICHTBAARHEID
  // =============================================
  function applyRoleVisibility() {
    document.body.setAttribute('data-tl-role', tlRol);

    // Verberg tabs die niet bij deze rol horen
    document.querySelectorAll('[data-tl-roles]').forEach(function (el) {
      var toegestaan = (el.getAttribute('data-tl-roles') || '').split(',').map(function (s) { return s.trim(); });
      if (toegestaan.indexOf(tlRol) === -1) {
        el.style.display = 'none';
      }
    });
    // Verberg secties die expliciet data-tl-show hebben
    document.querySelectorAll('[data-tl-show]').forEach(function (el) {
      var toegestaan = (el.getAttribute('data-tl-show') || '').split(',').map(function (s) { return s.trim(); });
      if (toegestaan.indexOf(tlRol) === -1) {
        el.style.display = 'none';
      }
    });

    // Activeer de eerste zichtbare tab
    var firstVisible = document.querySelector('.tab-btn:not([style*="display: none"])');
    if (firstVisible) {
      var targetTab = firstVisible.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      firstVisible.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      var sec = document.getElementById('tab-' + targetTab);
      if (sec) sec.classList.add('active');
    }

    // Pas titels/labels aan per rol
    var statsTitle = document.getElementById('tl-stats-title');
    var gesprekkenTitle = document.getElementById('tl-gesprekken-title');
    var gesprekkenSub = document.getElementById('tl-gesprekken-subtitle');
    var trendSub = document.getElementById('tl-trendanalyse-sub');
    if (tlRol === 'manager') {
      if (statsTitle) statsTitle.textContent = 'Organisatieoverzicht';
      if (gesprekkenTitle) gesprekkenTitle.textContent = 'Organisatiebrede trendanalyse';
      if (gesprekkenSub) gesprekkenSub.textContent = 'Trends over alle teams binnen de organisatie.';
      if (trendSub) trendSub.textContent = 'Analyse van anonieme vragen uit de afgelopen 30 dagen — hele organisatie.';
    } else if (tlRol === 'hr') {
      if (statsTitle) statsTitle.textContent = 'HR — Organisatieoverzicht';
      if (gesprekkenTitle) gesprekkenTitle.textContent = 'Organisatiebrede trendanalyse';
      if (gesprekkenSub) gesprekkenSub.textContent = 'Trends over alle teams binnen de organisatie.';
      if (trendSub) trendSub.textContent = 'Analyse van anonieme vragen uit de afgelopen 30 dagen — hele organisatie.';
    }
  }

  // HR: haal alle medewerkers van tenant op (voor team-dropdown in aanvraagmodal)
  async function loadAllTenantMedewerkers() {
    try {
      var session = (await supabaseClient.auth.getSession()).data.session;
      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ get_team_medewerkers: true })
      });
      var data = await response.json();
      if (data && data.medewerkers) {
        teamProfiles = data.medewerkers;
      }
    } catch (err) {
      console.warn('[TL HR] Kon medewerkers niet ophalen:', err);
    }
  }

  function initTabs() {
    var buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.style.display === 'none') return;
        var tab = btn.dataset.tab;
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        var target = document.getElementById('tab-' + tab);
        if (target) target.classList.add('active');
      });
    });
  }

  async function loadHeaderLogo() {
    var result = await supabaseClient.from('settings').select('sleutel, waarde').eq('tenant_id', tenantId);
    if (!result.data) return;
    var settings = {};
    result.data.forEach(function (s) { settings[s.sleutel] = s.waarde; });
    console.log('[Teamleider] logo_url uit settings:', settings.logo_url || '(leeg)');
    var tlLogoContainer = document.getElementById('tl-logo-container');
    if (tlLogoContainer && settings.logo_url) {
      tlLogoContainer.innerHTML = '<img src="' + settings.logo_url + '" alt="Logo" style="max-height:36px;width:auto;object-fit:contain;border-radius:6px">';
    }
    if (settings.organisatienaam) {
      var title = document.getElementById('tl-header-title');
      if (title) title.textContent = settings.organisatienaam;
    }
  }

  function initLogout() {
    document.getElementById('logout-btn').addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      window.location.href = appUrl('index.html');
    });
  }

  // =============================================
  // MIJN TEAM
  // =============================================
  async function loadTeamMedewerkers() {
    var tbody = document.getElementById('tl-medewerkers-body');

    try {
      // Medewerkers ophalen via Edge Function (service role, omzeilt RLS)
      var session = (await supabaseClient.auth.getSession()).data.session;
      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ get_team_medewerkers: true })
      });

      var data = await response.json();
      console.log('[TL] Edge Function response status:', response.status);
      console.log('[TL] Edge Function response data:', JSON.stringify(data).substring(0, 500));

      if (data.error || !data.medewerkers) {
        console.error('[TL] Edge Function fout:', data.error || 'geen medewerkers array');
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Kon medewerkers niet laden.</td></tr>';
        return;
      }

      // Log alle ontvangen medewerkers vóór filtering
      console.log('[TL] Ontvangen van Edge Function:', data.medewerkers.map(function (m) {
        return m.naam + ' tl=' + m.teamleider_naam + ' teams=' + JSON.stringify(m.teams);
      }));

      // Filter op teamleider_naam OF team overlap
      var myNaam = profile.naam || '';
      var myTeams = profile.teams || [];
      console.log('[TL] Mijn naam:', myNaam, 'Mijn teams:', JSON.stringify(myTeams));

      teamProfiles = data.medewerkers.filter(function (m) {
        // Match op teamleider_naam
        if (myNaam && m.teamleider_naam === myNaam) return true;
        // Match op team overlap
        if (myTeams.length > 0 && m.teams && m.teams.length > 0) {
          return m.teams.some(function (t) { return myTeams.indexOf(t) !== -1; });
        }
        // Geen filter ingesteld = toon alles
        if (!myNaam && myTeams.length === 0) return true;
        return false;
      });

      console.log('[TL] Na filtering:', teamProfiles.length, 'medewerkers');
    } catch (err) {
      console.error('[TL] Fout bij laden medewerkers:', err);
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Fout bij laden.</td></tr>';
      return;
    }

    if (teamProfiles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Geen medewerkers in jouw team.</td></tr>';
      return;
    }

    tbody.innerHTML = teamProfiles.map(function (p) {
      var fg = formatFunctiegroep(p.functiegroep);
      var sd = p.startdatum ? new Date(p.startdatum).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      }) : '-';
      return '<tr>' +
        '<td>' + escapeHtml(p.naam || '-') + '</td>' +
        '<td>' + escapeHtml(p.email) + '</td>' +
        '<td class="functiegroep-label">' + fg + '</td>' +
        '<td>' + sd + '</td>' +
        '<td><button class="btn-icon btn-icon-danger" onclick="window.vraagVerwijdering(\'' + p.id + '\', \'' + escapeHtml(p.naam) + '\')" title="Verwijdering aanvragen">🗑️</button></td>' +
        '</tr>';
    }).join('');
  }

  window.vraagVerwijdering = async function (profileId, naam) {
    if (!confirm('Wil je een verwijderingsaanvraag indienen voor ' + naam + '?')) return;

    await supabaseClient.from('aanvragen').insert({
      tenant_id: tenantId,
      type: 'verwijder',
      aangevraagd_door: profile.id,
      aanvrager_naam: profile.naam,
      medewerker_naam: naam,
      medewerker_profile_id: profileId
    });

    alert('Verwijderingsaanvraag ingediend.');
    loadMijnAanvragen();
  };

  // =============================================
  // GESPREKKEN
  // =============================================
  async function loadTeamGesprekken() {
    var tbody = document.getElementById('tl-gesprekken-body');

    // Haal alleen gesprekken op van teamleden
    var teamIds = teamProfiles.map(function (p) { return p.id; });
    // Voeg eigen profiel ID toe
    teamIds.push(profile.id);
    console.log('[TL] Gesprekken ophalen voor', teamIds.length, 'profielen');

    if (teamIds.length <= 1) {
      // Alleen eigen profiel ID, geen teamleden gevonden
      console.log('[TL] Geen teamleden gevonden, probeer alle tenant gesprekken');
    }

    console.log('[TL] Gesprekken ophalen voor profiel IDs:', JSON.stringify(teamIds));

    // Privacy: selecteer alleen metadata — geen vraag- of antwoordtekst
    var result = await supabaseClient
      .from('conversations')
      .select('id, feedback, created_at, user_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500);

    console.log('[TL] Tenant query:', result.data ? result.data.length + ' gesprekken' : 'FOUT: ' + (result.error ? result.error.message : 'geen data'));

    if (!result.data || result.data.length === 0) {
      var teamIds2 = teamProfiles.map(function (p) { return p.id; });
      teamIds2.push(profile.id);
      if (teamIds2.length > 0) {
        result = await supabaseClient
          .from('conversations')
          .select('id, feedback, created_at, user_id')
          .in('user_id', teamIds2)
          .order('created_at', { ascending: false })
          .limit(500);
        console.log('[TL] Fallback per user_id:', result.data ? result.data.length + ' gesprekken' : 'FOUT');
      }
    }

    if (result.error || !result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Geen gesprekken gevonden.</td></tr>';
      return;
    }

    // Filter client-side op teamleden + eigen profiel
    var teamIds = teamProfiles.map(function (p) { return p.id; });
    teamIds.push(profile.id);
    var filtered = result.data.filter(function (c) {
      return teamIds.indexOf(c.user_id) !== -1;
    });
    console.log('[TL] Na team-filter:', filtered.length, 'van', result.data.length, 'gesprekken');

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Geen gesprekken van jouw team gevonden.</td></tr>';
      return;
    }

    // Groepeer per (dag, user_id) zodat leidinggevende alleen aantallen ziet
    var groups = {};
    filtered.forEach(function (c) {
      var d = new Date(c.created_at);
      var dagKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var key = dagKey + '|' + c.user_id;
      if (!groups[key]) {
        groups[key] = { datum: d, dagKey: dagKey, aantal: 0, positief: 0, negatief: 0 };
      }
      groups[key].aantal++;
      if (c.feedback === 'goed') groups[key].positief++;
      else if (c.feedback === 'niet_goed') groups[key].negatief++;
    });

    var rows = Object.keys(groups).map(function (k) { return groups[k]; });
    rows.sort(function (a, b) { return b.datum - a.datum; });

    tbody.innerHTML = rows.map(function (g) {
      var datum = g.datum.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
      var fbParts = [];
      if (g.positief > 0) fbParts.push('<span class="badge badge-goed">👍 ' + g.positief + '</span>');
      if (g.negatief > 0) fbParts.push('<span class="badge badge-niet-goed">👎 ' + g.negatief + '</span>');
      var fb = fbParts.length > 0 ? fbParts.join(' ') : '<span class="badge badge-geen">—</span>';
      return '<tr>' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td style="color:var(--text-muted);font-style:italic">Anoniem</td>' +
        '<td>' + g.aantal + '</td>' +
        '<td>' + fb + '</td>' +
        '</tr>';
    }).join('');
  }

  // =============================================
  // TRENDANALYSE
  // =============================================
  function initTrendanalyse() {
    var btn = document.getElementById('tl-trendanalyse-btn');
    if (!btn) return;
    btn.addEventListener('click', handleTrendanalyse);
  }

  function setTrendStatus(msg, isError) {
    var el = document.getElementById('tl-trendanalyse-status');
    if (!el) return;
    if (!msg) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.style.color = isError ? 'var(--danger, #c0392b)' : 'var(--text-muted)';
    el.style.display = 'block';
  }

  async function loadTrendanalyseGeschiedenis() {
    var lijst = document.getElementById('tl-trendanalyse-lijst');
    if (!lijst) return;

    var result = await supabaseClient
      .from('trendanalyse_rapporten')
      .select('id, tekst, aangemaakt_op')
      .eq('tenant_id', tenantId)
      .order('aangemaakt_op', { ascending: false });

    if (result.error) {
      console.error('[Trendanalyse] Geschiedenis ophalen mislukt:', result.error.message);
      lijst.innerHTML = '<p class="no-data">Kon geschiedenis niet laden: ' + escapeHtml(result.error.message) + '</p>';
      return;
    }

    var rapporten = result.data || [];
    var btn = document.getElementById('tl-trendanalyse-btn');
    if (btn) {
      btn.textContent = rapporten.length > 0 ? '🔄 Vernieuwen' : '📊 Trendanalyse opvragen';
    }

    if (rapporten.length === 0) {
      lijst.innerHTML = '<p class="no-data" style="font-style:italic">Nog geen rapporten. Klik op "Trendanalyse opvragen" om er één te genereren.</p>';
      return;
    }

    lijst.innerHTML = rapporten.map(function (r) {
      var ts = new Date(r.aangemaakt_op).toLocaleString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return '<div class="trend-rapport" style="margin-bottom:16px;padding:16px 20px;border:1px solid #0d9488;border-left-width:4px;border-radius:8px;background:var(--bg)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:12px">' +
        '<span style="font-size:0.78rem;color:var(--text-muted);font-style:italic">Gegenereerd op ' + escapeHtml(ts) + '</span>' +
        '<button class="btn-icon btn-icon-danger" onclick="window.deleteTrendanalyse(\'' + r.id + '\')" title="Verwijder rapport">🗑️</button>' +
        '</div>' +
        '<div style="white-space:pre-wrap;font-size:0.92rem;line-height:1.55;color:var(--text)">' + escapeHtml(r.tekst || '') + '</div>' +
        '</div>';
    }).join('');
  }

  async function handleTrendanalyse() {
    var btn = document.getElementById('tl-trendanalyse-btn');
    if (!btn) return;

    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Analyseren...';
    setTrendStatus('Vragen verzamelen en naar AI versturen...', false);

    try {
      // Haal anonieme vragen op van laatste 30 dagen
      var sinds = new Date();
      sinds.setDate(sinds.getDate() - 30);

      var convResult = await supabaseClient
        .from('conversations')
        .select('vraag, user_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', sinds.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);

      if (convResult.error) {
        console.error('[Trendanalyse] DB fout:', convResult.error.message);
        setTrendStatus('Kon gesprekken niet ophalen: ' + convResult.error.message, true);
        return;
      }

      var alleVragen = convResult.data || [];
      var vragen;

      if (tlRol === 'teamleider') {
        // Teamleider: alleen vragen van teamleden (profile.teams overlap met tlTeams — via teamProfiles)
        var teamIds = teamProfiles.map(function (p) { return p.id; });
        teamIds.push(profile.id);
        if (teamIds.length <= 1) {
          setTrendStatus('Geen medewerkers in jouw team gevonden. Voeg eerst medewerkers toe voordat je een trendanalyse kunt opvragen.', true);
          return;
        }
        vragen = alleVragen
          .filter(function (c) { return teamIds.indexOf(c.user_id) !== -1; })
          .map(function (c) { return c.vraag; })
          .filter(function (v) { return typeof v === 'string' && v.trim().length > 0; });
      } else {
        // Manager/HR: alle vragen van tenant (geen teamfilter)
        vragen = alleVragen
          .map(function (c) { return c.vraag; })
          .filter(function (v) { return typeof v === 'string' && v.trim().length > 0; });
      }

      console.log('[Trendanalyse] Stuur', vragen.length, 'anonieme vragen naar edge function');

      var session = (await supabaseClient.auth.getSession()).data.session;
      var response = await fetch(SUPABASE_URL + '/functions/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ generate_trendanalyse: true, vragen: vragen })
      });

      var data = await response.json();
      if (data.error) {
        setTrendStatus('Fout bij trendanalyse: ' + data.error, true);
        return;
      }

      if (!data.rapport) {
        setTrendStatus('Analyse ontvangen maar kon niet worden opgeslagen. Probeer het opnieuw.', true);
        return;
      }

      setTrendStatus('');
      btn.textContent = '🔄 Vernieuwen';
      await loadTrendanalyseGeschiedenis();
    } catch (err) {
      console.error('[Trendanalyse] Onverwachte fout:', err);
      setTrendStatus('Onverwachte fout: ' + (err && err.message ? err.message : err), true);
      btn.textContent = originalLabel;
    } finally {
      btn.disabled = false;
    }
  }

  window.deleteTrendanalyse = async function (id) {
    if (!confirm('Weet je zeker dat je dit rapport wilt verwijderen?')) return;
    var delResult = await supabaseClient
      .from('trendanalyse_rapporten')
      .delete()
      .eq('id', id);
    if (delResult.error) {
      alert('Verwijderen mislukt: ' + delResult.error.message);
      return;
    }
    await loadTrendanalyseGeschiedenis();
  };

  // =============================================
  // STATISTIEKEN
  // =============================================
  async function loadTeamStatistieken() {
    var result = await supabaseClient
      .from('conversations')
      .select('id, feedback, created_at, user_id')
      .eq('tenant_id', tenantId);

    if (result.error || !result.data) return;

    var data;
    if (tlRol === 'teamleider') {
      var teamIds = teamProfiles.map(function (p) { return p.id; });
      teamIds.push(profile.id);
      data = result.data.filter(function (c) {
        return teamIds.indexOf(c.user_id) !== -1;
      });
      console.log('[TL Stats] Gesprekken voor team:', data.length, 'van', result.data.length);
    } else {
      // Manager/HR: hele tenant
      data = result.data;
      console.log('[TL Stats] Gesprekken voor tenant:', data.length);
    }
    var now = new Date();
    var dayOfWeek = now.getDay();
    var mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var weekStart = new Date(now);
    weekStart.setDate(now.getDate() - mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    document.getElementById('tl-stat-totaal').textContent = data.length;
    document.getElementById('tl-stat-week').textContent = data.filter(function (c) {
      return new Date(c.created_at) >= weekStart;
    }).length;

    var metFeedback = data.filter(function (c) { return c.feedback !== null; });
    var positief = metFeedback.filter(function (c) { return c.feedback === 'goed'; });
    var pct = metFeedback.length > 0 ? Math.round((positief.length / metFeedback.length) * 100) : 0;
    document.getElementById('tl-stat-positief').textContent = pct + '%';
  }

  // =============================================
  // MIJN AANVRAGEN
  // =============================================
  async function loadMijnAanvragen() {
    var tbodyDefault = document.getElementById('tl-aanvragen-body');         // teamleider (Mijn team tab)
    var tbodyHr = document.getElementById('tl-aanvragen-body-hr');           // hr (Aanvragen tab)
    if (!tbodyDefault && !tbodyHr) return;

    var result = await supabaseClient
      .from('aanvragen')
      .select('*')
      .order('created_at', { ascending: false });

    if (result.error || !result.data || result.data.length === 0) {
      var empty = '<tr><td colspan="4" class="no-data">Geen aanvragen.</td></tr>';
      if (tbodyDefault) tbodyDefault.innerHTML = empty;
      if (tbodyHr) tbodyHr.innerHTML = empty;
      return;
    }

    function statusBadgeFor(a) {
      if (a.status === 'in_afwachting') return 'In afwachting ⏳';
      if (a.status === 'goedgekeurd') return 'Goedgekeurd ✅';
      return 'Afgekeurd ❌' + (a.afkeurreden ? ' — ' + escapeHtml(a.afkeurreden) : '');
    }

    if (tbodyDefault) {
      tbodyDefault.innerHTML = result.data.map(function (a) {
        var datum = new Date(a.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
        var typeBadge = a.type === 'nieuw'
          ? '<span class="badge badge-medewerker">Nieuw</span>'
          : '<span class="badge badge-niet-goed">Verwijder</span>';
        return '<tr>' +
          '<td>' + datum + '</td>' +
          '<td>' + typeBadge + '</td>' +
          '<td>' + escapeHtml(a.medewerker_naam || '-') + '</td>' +
          '<td>' + statusBadgeFor(a) + '</td>' +
          '</tr>';
      }).join('');
    }

    if (tbodyHr) {
      tbodyHr.innerHTML = result.data.map(function (a) {
        var datum = new Date(a.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
        return '<tr>' +
          '<td>' + datum + '</td>' +
          '<td>' + escapeHtml(a.medewerker_naam || '-') + '</td>' +
          '<td>' + escapeHtml(a.medewerker_team || '-') + '</td>' +
          '<td>' + statusBadgeFor(a) + '</td>' +
          '</tr>';
      }).join('');
    }
  }

  // =============================================
  // VERTROUWENSCHECK — alle gedeelde scores (inclusief na week 6) van
  // medewerkers met vertrouwenscheck_actief = true
  // =============================================
  async function loadTeamVertrouwen() {
    var container = document.getElementById('tl-vertrouwen-lijst');
    if (!container) return;

    // Filter teamProfiles op vertrouwenscheck_actief — geen lege rijen voor
    // medewerkers die de check zelf hebben uitgeschakeld
    var actieveProfielen = teamProfiles.filter(function (p) {
      return p.user_id && p.vertrouwenscheck_actief !== false;
    });
    if (actieveProfielen.length === 0) {
      container.innerHTML = '<p class="no-data">Geen actieve vertrouwenscheck-deelnemers in jouw team.</p>';
      return;
    }
    var teamUserIds = actieveProfielen.map(function (p) { return p.user_id; });

    // Haal ALLE gedeelde scores op (geen week 1-6 grens)
    var result = await supabaseClient
      .from('vertrouwens_scores')
      .select('user_id, week_nummer, score, created_at')
      .eq('gedeeld', true)
      .in('user_id', teamUserIds)
      .order('created_at', { ascending: true }); // chronologisch voor trendlijn

    var rows = (result.data || []);
    if (rows.length === 0) {
      container.innerHTML = '<p class="no-data">Geen gedeelde scores.</p>';
      return;
    }

    // Naam-mapping
    var naamMap = {};
    actieveProfielen.forEach(function (p) { naamMap[p.user_id] = p.naam; });

    // ==== Trendlijn (SVG) — gemiddelde score per week, datum-as ====
    var perWeek = {}; // sleutel: YYYY-WW
    rows.forEach(function (s) {
      var d = new Date(s.created_at);
      // ISO week-key: jaar + weeknummer (simpel — gebruik maandag van die week)
      var dag = d.getDay();
      var offset = dag === 0 ? -6 : 1 - dag;
      var ma = new Date(d);
      ma.setDate(d.getDate() + offset);
      ma.setHours(0, 0, 0, 0);
      var key = ma.toISOString().substring(0, 10);
      if (!perWeek[key]) perWeek[key] = { datum: ma, scores: [] };
      perWeek[key].scores.push(s.score);
    });
    var weken = Object.keys(perWeek).sort().map(function (k) {
      var w = perWeek[k];
      var som = w.scores.reduce(function (a, b) { return a + b; }, 0);
      return { datum: w.datum, gem: som / w.scores.length, aantal: w.scores.length };
    });

    var trendHtml = '';
    if (weken.length >= 2) {
      var W = 600, H = 160, padL = 36, padR = 12, padT = 14, padB = 32;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var dx = weken.length > 1 ? plotW / (weken.length - 1) : 0;
      var pts = weken.map(function (w, i) {
        var x = padL + i * dx;
        var y = padT + (1 - (w.gem - 1) / 4) * plotH; // score 1..5 → y omgekeerd
        return { x: x, y: y, w: w };
      });
      var path = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      // Y-as gridlijnen + labels (1..5)
      var yLines = '';
      for (var v = 1; v <= 5; v++) {
        var y = padT + (1 - (v - 1) / 4) * plotH;
        yLines += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e5e5e5" stroke-width="1"/>';
        yLines += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#888" font-family="sans-serif">' + v + '</text>';
      }
      // X-as labels (datum)
      var xLabels = '';
      var stap = Math.max(1, Math.ceil(weken.length / 6));
      pts.forEach(function (p, i) {
        if (i % stap !== 0 && i !== pts.length - 1) return;
        var lab = p.w.datum.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
        xLabels += '<text x="' + p.x + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#666" font-family="sans-serif">' + lab + '</text>';
      });
      var dots = pts.map(function (p) {
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" fill="#0D5C6B"/>';
      }).join('');
      trendHtml =
        '<div style="margin-bottom:16px">' +
        '<h4 style="font-size:0.9rem;margin:0 0 8px;color:#0D5C6B">Trendlijn — gemiddelde gedeelde score per week</h4>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;background:var(--bg-white);border:1px solid var(--border);border-radius:6px">' +
        yLines +
        '<path d="' + path + '" fill="none" stroke="#0D5C6B" stroke-width="2"/>' +
        dots +
        xLabels +
        '</svg>' +
        '</div>';
    }

    // ==== Tabel met details ====
    var html = trendHtml + '<div class="data-table-wrap"><table class="data-table">' +
      '<thead><tr><th>Medewerker</th><th>Week</th><th>Score</th><th>Datum</th></tr></thead><tbody>';
    // Recente eerst in de tabel
    [].concat(rows).reverse().forEach(function (s) {
      var naam = naamMap[s.user_id] || 'Onbekend';
      var sterren = '';
      for (var i = 0; i < 5; i++) sterren += i < s.score ? '⭐' : '☆';
      var datum = new Date(s.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
      html += '<tr>' +
        '<td>' + escapeHtml(naam) + '</td>' +
        '<td>Week ' + s.week_nummer + '</td>' +
        '<td>' + sterren + ' (' + s.score + '/5)</td>' +
        '<td>' + datum + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // =============================================
  // KENNISQUIZ — alleen resultaten die medewerker expliciet heeft gedeeld
  // =============================================
  async function loadTeamQuiz() {
    var container = document.getElementById('tl-quiz-lijst');
    if (!container) return;

    var teamUserIds = teamProfiles.map(function (p) { return p.user_id; }).filter(function (v) { return !!v; });
    if (teamUserIds.length === 0) {
      container.innerHTML = '<p class="no-data">Geen gedeelde resultaten.</p>';
      return;
    }

    var result = await supabaseClient
      .from('quiz_resultaten')
      .select('user_id, week_nummer, score, totaal, created_at')
      .eq('gedeeld', true)
      .in('user_id', teamUserIds)
      .order('created_at', { ascending: false });

    var rows = (result.data || []);
    if (rows.length === 0) {
      container.innerHTML = '<p class="no-data">Geen gedeelde resultaten.</p>';
      return;
    }

    var naamMap = {};
    teamProfiles.forEach(function (p) { if (p.user_id) naamMap[p.user_id] = p.naam; });

    var html = '<div class="data-table-wrap"><table class="data-table">' +
      '<thead><tr><th>Medewerker</th><th>Inwerkweek</th><th>Score</th><th>Datum</th></tr></thead><tbody>';
    rows.forEach(function (q) {
      var naam = naamMap[q.user_id] || 'Onbekend';
      var datum = new Date(q.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
      var totaal = q.totaal || 3;
      html += '<tr>' +
        '<td>' + escapeHtml(naam) + '</td>' +
        '<td>Week ' + q.week_nummer + '</td>' +
        '<td>' + q.score + ' / ' + totaal + '</td>' +
        '<td>' + datum + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // =============================================
  // MELDINGEN
  // =============================================
  async function loadTeamMeldingen() {
    var container = document.getElementById('tl-meldingen-list');

    var result = await supabaseClient
      .from('meldingen')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (result.error || !result.data || result.data.length === 0) {
      container.innerHTML = '<p class="no-data" style="text-align:center;color:var(--text-muted);padding:24px">Geen meldingen.</p>';
      return;
    }

    container.innerHTML = result.data.map(function (m) {
      var datum = new Date(m.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      return '<div class="kennisbank-item">' +
        '<div class="kennisbank-item-vraag">' + datum + '</div>' +
        '<div class="kennisbank-item-antwoord">' + escapeHtml(m.bericht) + '</div>' +
        '</div>';
    }).join('');
  }

  // =============================================
  // AANVRAAG MODAL
  // =============================================
  var allFunctiegroepen = [];

  async function loadTlaFunctiegroepen() {
    var result = await supabaseClient
      .from('functiegroepen')
      .select('id, code, naam, is_kantoor')
      .eq('tenant_id', tenantId)
      .order('naam');

    if (!result.data) return;
    allFunctiegroepen = result.data;

    var el = document.getElementById('tl-aanvraag-functiegroep');
    if (!el) return;
    el.innerHTML = '<option value="">Kies een functiegroep</option>';
    result.data.forEach(function (fg) {
      var opt = document.createElement('option');
      opt.value = fg.code;
      opt.textContent = fg.naam;
      el.appendChild(opt);
    });
  }

  function updateTlaFormFields(fgCode) {
    var zorgFields = document.querySelectorAll('.tla-zorg-field');
    var kantoorFields = document.querySelectorAll('.tla-kantoor-field');
    var sharedFields = document.querySelectorAll('.tla-shared-field');
    var hint = document.getElementById('tla-fg-hint');

    if (!fgCode) {
      zorgFields.forEach(function (el) { el.style.display = 'none'; });
      kantoorFields.forEach(function (el) { el.style.display = 'none'; });
      sharedFields.forEach(function (el) { el.style.display = 'none'; });
      if (hint) hint.style.display = '';
      return;
    }

    if (hint) hint.style.display = 'none';
    var fg = allFunctiegroepen.find(function (f) { return f.code === fgCode; });
    var isKantoor = fg && fg.is_kantoor;

    zorgFields.forEach(function (el) { el.style.display = isKantoor ? 'none' : ''; });
    kantoorFields.forEach(function (el) { el.style.display = isKantoor ? '' : 'none'; });
    sharedFields.forEach(function (el) { el.style.display = ''; });
  }

  function initAanvraagModal() {
    var modal = document.getElementById('modal-tl-aanvraag');
    var form = document.getElementById('tl-aanvraag-form');
    var btn = document.getElementById('tl-aanvraag-btn');
    var cancelBtn = document.getElementById('tl-aanvraag-cancel');
    var submitBtn = document.getElementById('tl-aanvraag-submit');
    var alertBox = document.getElementById('tl-aanvraag-alert');
    var alertMsg = document.getElementById('tl-aanvraag-alert-message');

    // Laad functiegroepen uit DB
    loadTlaFunctiegroepen();

    // Functiegroep change handler
    var fgSelect = document.getElementById('tl-aanvraag-functiegroep');
    if (fgSelect) {
      fgSelect.addEventListener('change', function () {
        updateTlaFormFields(fgSelect.value);
      });
    }

    // Account type radio toggle
    var accountRadios = document.querySelectorAll('input[name="tla-account-type"]');
    var einddatumGroup = document.getElementById('tla-einddatum-group');
    accountRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (einddatumGroup) einddatumGroup.style.display = radio.value === 'tijdelijk' ? '' : 'none';
      });
    });

    // Pre-fill teamleider dropdown met eigen naam
    var tlSelect = document.getElementById('tla-teamleider');
    if (tlSelect && profile.naam) {
      var opt = document.createElement('option');
      opt.value = profile.naam;
      opt.textContent = profile.naam;
      opt.selected = true;
      tlSelect.appendChild(opt);
    }

    // HR: vervang team-checkbox door dropdown met alle teams van tenant
    var teamsCheckboxGroup = document.getElementById('tla-teams-checkbox-group');
    var teamDropdownGroup = document.getElementById('tla-team-dropdown-group');
    var teamDropdown = document.getElementById('tla-team-dropdown');
    if (tlRol === 'hr' && teamsCheckboxGroup && teamDropdownGroup && teamDropdown) {
      teamsCheckboxGroup.style.display = 'none';
      teamDropdownGroup.style.display = '';
      // Vul dropdown met unieke teams uit alle medewerkers van tenant
      var alleTeams = {};
      teamProfiles.forEach(function (p) {
        if (p.teams && Array.isArray(p.teams)) {
          p.teams.forEach(function (t) { if (t) alleTeams[t] = true; });
        }
      });
      var teamsList = Object.keys(alleTeams).sort();
      teamDropdown.innerHTML = '<option value="">Kies een team</option>' +
        teamsList.map(function (t) { return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>'; }).join('');
    }

    btn.addEventListener('click', function () {
      form.reset();
      alertBox.className = 'alert';
      updateTlaFormFields('');
      if (einddatumGroup) einddatumGroup.style.display = 'none';
      // Teamleider: pre-select eigen teams. HR: geen pre-select (kiest zelf).
      if (tlRol === 'teamleider' && profile.teams && profile.teams.length > 0) {
        var checkboxes = document.querySelectorAll('input[name="tla-teams"]');
        checkboxes.forEach(function (cb) {
          cb.checked = profile.teams.indexOf(cb.value) !== -1;
        });
      }
      modal.classList.add('show');
    });

    cancelBtn.addEventListener('click', function () { modal.classList.remove('show'); });
    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var naam = document.getElementById('tl-aanvraag-naam').value.trim();
      var email = document.getElementById('tl-aanvraag-email').value.trim();
      var fg = document.getElementById('tl-aanvraag-functiegroep').value;
      var startdatum = document.getElementById('tl-aanvraag-startdatum') ? document.getElementById('tl-aanvraag-startdatum').value : '';
      var werkuren = document.getElementById('tl-aanvraag-werkuren').value.trim();

      // Teams ophalen: teamleider gebruikt checkboxes, HR gebruikt dropdown
      var team = '';
      if (tlRol === 'hr') {
        var dd = document.getElementById('tla-team-dropdown');
        team = dd ? dd.value : '';
      } else {
        var teamCheckboxes = document.querySelectorAll('input[name="tla-teams"]:checked');
        var teams = [];
        teamCheckboxes.forEach(function (cb) { teams.push(cb.value); });
        team = teams.join(', ');
      }

      if (!naam || !email || !fg) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Vul alle verplichte velden in.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Indienen...';

      var result = await supabaseClient.from('aanvragen').insert({
        tenant_id: tenantId,
        type: 'nieuw',
        aangevraagd_door: profile.id,
        aanvrager_naam: profile.naam,
        medewerker_naam: naam,
        medewerker_email: email,
        medewerker_functiegroep: fg,
        medewerker_team: team,
        medewerker_startdatum: startdatum || null,
        medewerker_werkuren: werkuren || null
      });

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Indienen mislukt: ' + result.error.message;
      } else {
        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Aanvraag ingediend! De admin wordt op de hoogte gesteld.';
        loadMijnAanvragen();
        setTimeout(function () { modal.classList.remove('show'); }, 2000);
      }

      submitBtn.disabled = false;
      submitBtn.textContent = 'Aanvraag indienen';
    });
  }

  // =============================================
  // DOCUMENT INDIENEN (teamleider + hr)
  // =============================================
  function initDocIndienen() {
    var form = document.getElementById('tl-doc-indienen-form');
    var fileInput = document.getElementById('tl-doc-indienen-file');
    var toelichtingEl = document.getElementById('tl-doc-indienen-toelichting');
    var submitBtn = document.getElementById('tl-doc-indienen-submit');
    var alertBox = document.getElementById('tl-doc-indienen-alert');
    var alertMsg = document.getElementById('tl-doc-indienen-alert-message');
    if (!form) return;

    function setAlert(type, msg) {
      if (!alertBox) return;
      alertBox.className = 'alert alert-' + type + ' show';
      if (alertMsg) alertMsg.textContent = msg;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var file = fileInput.files[0];
      var toelichting = (toelichtingEl.value || '').trim();

      if (!file) { setAlert('error', 'Selecteer een bestand.'); return; }
      if (!toelichting) { setAlert('error', 'Toelichting is verplicht.'); return; }

      // Controleer extensie
      var ext = file.name.split('.').pop().toLowerCase();
      if (['pdf', 'docx', 'txt'].indexOf(ext) === -1) {
        setAlert('error', 'Alleen PDF, Word (.docx) of tekst (.txt) toegestaan.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Bezig met uploaden...';

      try {
        // Stap 1: upload naar storage onder pad <tenant_id>/aanvragen/<timestamp>_<bestand>
        var veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var filePath = tenantId + '/aanvragen/' + Date.now() + '_' + veiligeNaam;

        var upload = await supabaseClient.storage
          .from('documents')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (upload.error) {
          setAlert('error', 'Upload mislukt: ' + upload.error.message);
          return;
        }

        // Stap 2: rij in document_aanvragen_beheer
        var insert = await supabaseClient
          .from('document_aanvragen_beheer')
          .insert({
            tenant_id: tenantId,
            ingediend_door: profile.id,
            bestandsnaam: file.name,
            bestandspad: filePath,
            toelichting: toelichting,
            status: 'in_afwachting'
          });
        if (insert.error) {
          // Opruimen: verwijder het bestand als de metadata-rij faalt
          await supabaseClient.storage.from('documents').remove([filePath]);
          setAlert('error', 'Indienen mislukt: ' + insert.error.message);
          return;
        }

        setAlert('success', 'Document ingediend! De beheerder ontvangt bericht.');
        form.reset();
        await loadDocIngediend();
      } catch (err) {
        console.error('[DocIndienen] fout:', err);
        setAlert('error', 'Onverwachte fout: ' + (err && err.message ? err.message : err));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Indienen ter beoordeling';
      }
    });
  }

  async function loadDocIngediend() {
    var tbody = document.getElementById('tl-doc-ingediend-body');
    if (!tbody) return;

    var result = await supabaseClient
      .from('document_aanvragen_beheer')
      .select('id, bestandsnaam, toelichting, status, aangemaakt_op')
      .order('aangemaakt_op', { ascending: false });

    if (result.error) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Kon ingediende documenten niet laden.</td></tr>';
      return;
    }
    var rows = result.data || [];
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Nog geen documenten ingediend.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (r) {
      var datum = new Date(r.aangemaakt_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
      var status = r.status === 'in_afwachting' ? '<span class="badge badge-open">In afwachting ⏳</span>'
        : r.status === 'goedgekeurd' ? '<span class="badge badge-goed">Goedgekeurd ✅</span>'
        : '<span class="badge badge-niet-goed">Afgewezen ❌</span>';
      return '<tr>' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td>' + escapeHtml(r.bestandsnaam) + '</td>' +
        '<td>' + escapeHtml(r.toelichting) + '</td>' +
        '<td>' + status + '</td>' +
        '</tr>';
    }).join('');
  }

  // =============================================
  // ONBOARDING CHECKLIST (HR)
  // =============================================
  async function loadOnboardingChecklist() {
    var listEl = document.getElementById('tl-onb-list');
    if (!listEl) return;

    var result = await supabaseClient
      .from('onboarding_checklist')
      .select('id, stap_naam, afgerond, afgerond_op, afgerond_door')
      .eq('tenant_id', tenantId)
      .order('stap_naam', { ascending: true });

    if (result.error) {
      listEl.innerHTML = '<p class="no-data">Kon checklist niet laden: ' + escapeHtml(result.error.message) + '</p>';
      return;
    }
    var rows = result.data || [];
    if (rows.length === 0) {
      listEl.innerHTML = '<p class="no-data">Nog geen checklist beschikbaar. Vraag de beheerder om deze te initialiseren.</p>';
      updateOnbProgress(0, 0);
      return;
    }

    // Haal namen op voor afgerond_door
    var byIds = rows.map(function (r) { return r.afgerond_door; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var naamMap = {};
    if (byIds.length > 0) {
      var naamRes = await supabaseClient.from('profiles').select('id, naam').in('id', byIds);
      (naamRes.data || []).forEach(function (p) { naamMap[p.id] = p.naam; });
    }

    // Originele volgorde handhaven via createdAt desc? Hier: houd de 9 vaste stappen in vaste volgorde.
    // De seed function inserteert ze in volgorde — sorteer op id creation is niet gegarandeerd, dus gebruik
    // de naam zoals gedefinieerd in de seed. Voor nu sorteren we op stap_naam alfabetisch voor consistentie.
    // (De seed maakt ze met gelijktijdige inserts, dus geen betrouwbare volgorde-kolom.)

    var afgerondAantal = rows.filter(function (r) { return r.afgerond; }).length;
    updateOnbProgress(afgerondAantal, rows.length);

    listEl.innerHTML = rows.map(function (r) {
      var afgerondInfo = '';
      if (r.afgerond && r.afgerond_op) {
        var ts = new Date(r.afgerond_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
        var naam = naamMap[r.afgerond_door] || '';
        afgerondInfo = '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Afgerond op ' + ts + (naam ? ' door ' + escapeHtml(naam) : '') + '</div>';
      }
      return '<label class="kennisbank-item" style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;cursor:pointer' + (r.afgerond ? ';background:rgba(22,163,74,0.06)' : '') + '">' +
        '<input type="checkbox" class="tl-onb-cb" data-id="' + r.id + '" ' + (r.afgerond ? 'checked' : '') + ' style="margin-top:3px;accent-color:var(--primary)">' +
        '<div style="flex:1">' +
          '<div style="font-size:0.92rem;' + (r.afgerond ? 'text-decoration:line-through;color:var(--text-muted)' : 'color:var(--text)') + '">' + escapeHtml(r.stap_naam) + '</div>' +
          afgerondInfo +
        '</div>' +
        '</label>';
    }).join('');

    listEl.querySelectorAll('.tl-onb-cb').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        var id = cb.getAttribute('data-id');
        var nieuwAfgerond = cb.checked;
        var upd = await supabaseClient
          .from('onboarding_checklist')
          .update({
            afgerond: nieuwAfgerond,
            afgerond_op: nieuwAfgerond ? new Date().toISOString() : null,
            afgerond_door: nieuwAfgerond ? profile.id : null
          })
          .eq('id', id);
        if (upd.error) {
          alert('Bijwerken mislukt: ' + upd.error.message);
          cb.checked = !nieuwAfgerond;
          return;
        }
        await loadOnboardingChecklist();
      });
    });
  }

  function updateOnbProgress(afgerond, totaal) {
    var label = document.getElementById('tl-onb-progress-label');
    var pctEl = document.getElementById('tl-onb-progress-pct');
    var bar = document.getElementById('tl-onb-progress-bar');
    var pct = totaal > 0 ? Math.round((afgerond / totaal) * 100) : 0;
    if (label) label.textContent = afgerond + '/' + totaal;
    if (pctEl) pctEl.textContent = pct + '%';
    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background = pct === 100 ? 'var(--success, #16a34a)' : 'var(--primary, #0D5C6B)';
    }
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
    // Zoek eerst in dynamische functiegroepen uit DB
    if (allFunctiegroepen && allFunctiegroepen.length > 0) {
      var found = allFunctiegroepen.find(function (f) { return f.code === fg; });
      if (found) return found.naam;
    }
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
    // Fallback: nette weergave van de code
    return map[fg] || (fg ? fg.replace(/_/g, ' ').replace(/,/g, ' / ') : '-');
  }
})();
