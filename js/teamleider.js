// =============================================
// WEGWIJZER — Teamleider dashboard logica
// =============================================

(function () {
  'use strict';

  var tenantId = null;
  var profile = null;
  var teamProfiles = [];

  document.addEventListener('wegwijzer-auth-ready', async function (e) {
    profile = e.detail.profile;
    tenantId = profile.tenant_id;
    initTabs();
    initLogout();
    loadHeaderLogo();
    await loadTlaFunctiegroepen();
    await loadTeamMedewerkers();
    loadTeamGesprekken();
    loadTeamStatistieken();
    loadMijnAanvragen();
    loadTeamMeldingen();
    initAanvraagModal();
  });

  function initTabs() {
    var buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        document.getElementById('tab-' + tab).classList.add('active');
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
      // Medewerkers ophalen via Edge Function (omzeilt RLS)
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
      console.log('[TL] Edge Function medewerkers:', data.medewerkers ? data.medewerkers.length : 0, data.error || '');

      if (data.error || !data.medewerkers) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Kon medewerkers niet laden.</td></tr>';
        return;
      }

      teamProfiles = data.medewerkers;
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

    // Probeer eerst alle tenant gesprekken (als RLS policy bestaat)
    var result = await supabaseClient
      .from('conversations')
      .select('id, vraag, feedback, created_at, user_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200);

    console.log('[TL] Tenant query:', result.data ? result.data.length + ' gesprekken' : 'FOUT: ' + (result.error ? result.error.message : 'geen data'));

    // Als tenant query geen resultaat geeft, probeer per user_id
    if (!result.data || result.data.length === 0) {
      var teamIds2 = teamProfiles.map(function (p) { return p.id; });
      teamIds2.push(profile.id);
      if (teamIds2.length > 0) {
        result = await supabaseClient
          .from('conversations')
          .select('id, vraag, feedback, created_at, user_id')
          .in('user_id', teamIds2)
          .order('created_at', { ascending: false })
          .limit(200);
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

    tbody.innerHTML = filtered.map(function (c) {
      var datum = new Date(c.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      var p = teamProfiles.find(function (pr) { return pr.id === c.user_id; });
      var naam = p ? (p.naam || p.email) : (c.user_id === profile.id ? profile.naam : 'Onbekend');
      var fb = '';
      if (c.feedback === 'goed') fb = '<span class="badge badge-goed">👍</span>';
      else if (c.feedback === 'niet_goed') fb = '<span class="badge badge-niet-goed">👎</span>';
      else fb = '<span class="badge badge-geen">—</span>';

      return '<tr>' +
        '<td style="white-space:nowrap">' + datum + '</td>' +
        '<td>' + escapeHtml(naam) + '</td>' +
        '<td><div class="answer-preview">' + escapeHtml(c.vraag) + '</div></td>' +
        '<td>' + fb + '</td>' +
        '</tr>';
    }).join('');
  }

  // =============================================
  // STATISTIEKEN
  // =============================================
  async function loadTeamStatistieken() {
    var teamIds = teamProfiles.map(function (p) { return p.id; });
    teamIds.push(profile.id);

    var result = await supabaseClient
      .from('conversations')
      .select('id, feedback, created_at, user_id')
      .eq('tenant_id', tenantId);

    if (result.error || !result.data) return;

    // Filter client-side op teamleden
    var data = result.data.filter(function (c) {
      return teamIds.indexOf(c.user_id) !== -1;
    });
    console.log('[TL Stats] Gesprekken voor team:', data.length, 'van', result.data.length);
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
    var tbody = document.getElementById('tl-aanvragen-body');

    var result = await supabaseClient
      .from('aanvragen')
      .select('*')
      .order('created_at', { ascending: false });

    if (result.error || !result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Geen aanvragen.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (a) {
      var datum = new Date(a.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short'
      });
      var typeBadge = a.type === 'nieuw'
        ? '<span class="badge badge-medewerker">Nieuw</span>'
        : '<span class="badge badge-niet-goed">Verwijder</span>';
      var statusBadge = '';
      if (a.status === 'in_afwachting') statusBadge = 'In afwachting ⏳';
      else if (a.status === 'goedgekeurd') statusBadge = 'Goedgekeurd ✅';
      else statusBadge = 'Afgekeurd ❌' + (a.afkeurreden ? ' — ' + escapeHtml(a.afkeurreden) : '');

      return '<tr>' +
        '<td>' + datum + '</td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + escapeHtml(a.medewerker_naam || '-') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '</tr>';
    }).join('');
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

    btn.addEventListener('click', function () {
      form.reset();
      alertBox.className = 'alert';
      updateTlaFormFields('');
      if (einddatumGroup) einddatumGroup.style.display = 'none';
      // Pre-select eigen teams
      if (profile.teams && profile.teams.length > 0) {
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

      // Teams ophalen uit checkboxes
      var teamCheckboxes = document.querySelectorAll('input[name="tla-teams"]:checked');
      var teams = [];
      teamCheckboxes.forEach(function (cb) { teams.push(cb.value); });
      var team = teams.join(', ');

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
