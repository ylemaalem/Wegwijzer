// =============================================
// WEGWIJZER — Teamleider dashboard logica
// =============================================

(function () {
  'use strict';

  var tenantId = null;
  var profile = null;
  var teamProfiles = [];

  document.addEventListener('wegwijzer-auth-ready', function (e) {
    profile = e.detail.profile;
    tenantId = profile.tenant_id;
    initTabs();
    initLogout();
    loadHeaderLogo();
    loadTeamMedewerkers();
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
    var myTeams = profile.teams || [];

    var result = await supabaseClient
      .from('profiles')
      .select('id, naam, email, functiegroep, startdatum, user_id, teams')
      .eq('tenant_id', tenantId)
      .eq('role', 'medewerker');

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Kon medewerkers niet laden.</td></tr>';
      return;
    }

    // Client-side filteren op overlappende teams
    teamProfiles = result.data.filter(function (p) {
      if (myTeams.length === 0) return true;
      if (!p.teams || p.teams.length === 0) return false;
      return p.teams.some(function (t) { return myTeams.indexOf(t) !== -1; });
    });

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

    var result = await supabaseClient
      .from('conversations')
      .select('id, vraag, feedback, created_at, user_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (result.error || !result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="no-data">Geen gesprekken gevonden.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (c) {
      var datum = new Date(c.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      var p = teamProfiles.find(function (pr) { return pr.id === c.user_id; });
      var naam = p ? (p.naam || p.email) : 'Onbekend';
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
    var result = await supabaseClient
      .from('conversations')
      .select('id, feedback, created_at')
      .eq('tenant_id', tenantId);

    if (result.error || !result.data) return;

    var data = result.data;
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
  function initAanvraagModal() {
    var modal = document.getElementById('modal-tl-aanvraag');
    var form = document.getElementById('tl-aanvraag-form');
    var btn = document.getElementById('tl-aanvraag-btn');
    var cancelBtn = document.getElementById('tl-aanvraag-cancel');
    var submitBtn = document.getElementById('tl-aanvraag-submit');
    var alertBox = document.getElementById('tl-aanvraag-alert');
    var alertMsg = document.getElementById('tl-aanvraag-alert-message');

    btn.addEventListener('click', function () {
      form.reset();
      alertBox.className = 'alert';
      // Vul team voor als teamleider maar 1 team heeft
      if (profile.teams && profile.teams.length === 1) {
        document.getElementById('tl-aanvraag-team').value = profile.teams[0];
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
      var team = document.getElementById('tl-aanvraag-team').value.trim();
      var startdatum = document.getElementById('tl-aanvraag-startdatum').value;
      var werkuren = document.getElementById('tl-aanvraag-werkuren').value.trim();
      var regio = document.getElementById('tl-aanvraag-regio').value.trim();

      if (!naam || !email || !fg || !startdatum) {
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
        medewerker_werkuren: werkuren || null,
        medewerker_regio: regio || null
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
})();
