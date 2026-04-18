// =============================================
// WEGWIJZER — Superadmin overzicht
// =============================================

(function () {
  'use strict';

  document.addEventListener('wegwijzer-auth-ready', async function (e) {
    initLogout();

    // Check: is_superadmin() via RPC — tegelijk dubbele check
    // op basis van profile naam (route-guard heeft role='admin' al gevalideerd)
    var profile = e.detail.profile;
    var isSuperadmin = profile && profile.naam === 'Wegwijzer Beheer' && profile.role === 'admin';

    if (!isSuperadmin) {
      // Dubbele check via DB: RPC
      try {
        var rpc = await supabaseClient.rpc('is_superadmin');
        if (rpc && rpc.data === true) isSuperadmin = true;
      } catch (err) {
        console.warn('[Superadmin] RPC is_superadmin faalde:', err);
      }
    }

    if (!isSuperadmin) {
      window.location.href = appUrl('admin.html');
      return;
    }

    await loadOverzicht();
  });

  function initLogout() {
    var btn = document.getElementById('logout-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      window.location.href = appUrl('index.html');
    });
  }

  async function loadOverzicht() {
    var listEl = document.getElementById('sa-org-list');

    // Tenants ophalen
    var tenantsRes = await supabaseClient.from('tenants').select('id, naam').order('naam');
    if (tenantsRes.error || !tenantsRes.data) {
      listEl.innerHTML = '<p class="no-data">Kon tenants niet laden: ' + escapeHtml(tenantsRes.error ? tenantsRes.error.message : 'onbekend') + '</p>';
      return;
    }
    var tenants = tenantsRes.data;

    // Alle benodigde data parallel
    var results = await Promise.all([
      supabaseClient.from('profiles').select('id, tenant_id, role'),
      supabaseClient.from('document_aanvragen_beheer').select('id, tenant_id, status'),
      supabaseClient.from('aanvragen').select('id, tenant_id, status'),
      supabaseClient.from('conversations').select('tenant_id, created_at').order('created_at', { ascending: false }).limit(5000),
      supabaseClient.from('onboarding_checklist').select('tenant_id, afgerond'),
      supabaseClient.from('settings').select('tenant_id, sleutel, waarde').in('sleutel', ['primaire_kleur', 'organisatienaam'])
    ]);

    var profiles = results[0].data || [];
    var docAanvragen = results[1].data || [];
    var mwAanvragen = results[2].data || [];
    var conversations = results[3].data || [];
    var checklist = results[4].data || [];
    var settings = results[5].data || [];

    // Aggregeer per tenant
    var perTenant = {};
    tenants.forEach(function (t) {
      perTenant[t.id] = {
        id: t.id,
        naam: t.naam,
        kleur: '#0D5C6B',
        medewerkers: 0,
        docAanvragenOpen: 0,
        mwAanvragenOpen: 0,
        laatsteActiviteit: null,
        checklistTotaal: 0,
        checklistAfgerond: 0
      };
    });

    profiles.forEach(function (p) {
      if (!perTenant[p.tenant_id]) return;
      // Actieve medewerkers = role 'medewerker' + 'teamleider' (exclusief superadmin 'admin')
      if (p.role === 'medewerker' || p.role === 'teamleider') {
        perTenant[p.tenant_id].medewerkers++;
      }
    });

    docAanvragen.forEach(function (d) {
      if (perTenant[d.tenant_id] && d.status === 'in_afwachting') {
        perTenant[d.tenant_id].docAanvragenOpen++;
      }
    });

    mwAanvragen.forEach(function (a) {
      if (perTenant[a.tenant_id] && a.status === 'in_afwachting') {
        perTenant[a.tenant_id].mwAanvragenOpen++;
      }
    });

    conversations.forEach(function (c) {
      var t = perTenant[c.tenant_id];
      if (!t) return;
      if (!t.laatsteActiviteit || new Date(c.created_at) > t.laatsteActiviteit) {
        t.laatsteActiviteit = new Date(c.created_at);
      }
    });

    checklist.forEach(function (cl) {
      if (!perTenant[cl.tenant_id]) return;
      perTenant[cl.tenant_id].checklistTotaal++;
      if (cl.afgerond) perTenant[cl.tenant_id].checklistAfgerond++;
    });

    settings.forEach(function (s) {
      if (!perTenant[s.tenant_id]) return;
      if (s.sleutel === 'primaire_kleur' && s.waarde) perTenant[s.tenant_id].kleur = s.waarde;
      if (s.sleutel === 'organisatienaam' && s.waarde) perTenant[s.tenant_id].naam = s.waarde;
    });

    // Totaaloverzicht
    var totMedewerkers = 0;
    var totDocAanvragen = 0;
    var totMwAanvragen = 0;
    Object.keys(perTenant).forEach(function (k) {
      totMedewerkers += perTenant[k].medewerkers;
      totDocAanvragen += perTenant[k].docAanvragenOpen;
      totMwAanvragen += perTenant[k].mwAanvragenOpen;
    });

    document.getElementById('sa-stat-orgs').textContent = tenants.length;
    document.getElementById('sa-stat-medewerkers').textContent = totMedewerkers;
    document.getElementById('sa-stat-doc-aanvragen').textContent = totDocAanvragen;
    document.getElementById('sa-stat-mw-aanvragen').textContent = totMwAanvragen;

    // Sorteer: openstaande aanvragen bovenaan, daarna alfabetisch
    var orgs = Object.keys(perTenant).map(function (k) { return perTenant[k]; });
    orgs.sort(function (a, b) {
      var aOpen = a.docAanvragenOpen + a.mwAanvragenOpen;
      var bOpen = b.docAanvragenOpen + b.mwAanvragenOpen;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return a.naam.localeCompare(b.naam);
    });

    if (orgs.length === 0) {
      listEl.innerHTML = '<p class="no-data">Geen organisaties gevonden.</p>';
      return;
    }

    listEl.innerHTML = orgs.map(function (o) {
      var laatste = o.laatsteActiviteit
        ? o.laatsteActiviteit.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
      var badges = '';
      if (o.docAanvragenOpen > 0) {
        badges += '<span class="badge badge-open" style="background:#E8720C;color:#fff">📥 ' + o.docAanvragenOpen + ' doc</span> ';
      }
      if (o.mwAanvragenOpen > 0) {
        badges += '<span class="badge badge-open" style="background:#E8720C;color:#fff">👥 ' + o.mwAanvragenOpen + ' medewerker</span>';
      }
      if (!badges) badges = '<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic">Geen openstaande aanvragen</span>';

      var checklistPct = o.checklistTotaal > 0
        ? Math.round((o.checklistAfgerond / o.checklistTotaal) * 100)
        : 0;

      return '<div class="kennisbank-item" style="border-left:4px solid ' + escapeHtml(o.kleur) + ';padding:16px 18px;display:flex;flex-direction:column;gap:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<div style="font-weight:600;font-size:1.05rem;color:var(--text)">' + escapeHtml(o.naam) + '</div>' +
          '<div style="width:12px;height:12px;border-radius:50%;background:' + escapeHtml(o.kleur) + ';flex-shrink:0;margin-top:6px" title="Huisstijlkleur"></div>' +
        '</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted)">👤 ' + o.medewerkers + ' actieve medewerkers</div>' +
        '<div style="font-size:0.85rem">' + badges + '</div>' +
        '<div style="font-size:0.8rem;color:var(--text-muted)">Laatste activiteit: ' + laatste + '</div>' +
        '<div style="font-size:0.8rem">Onboarding: <strong>' + o.checklistAfgerond + '/' + o.checklistTotaal + '</strong> stappen' +
          '<div style="background:var(--border);height:6px;border-radius:3px;overflow:hidden;margin-top:4px">' +
            '<div style="background:' + (checklistPct === 100 ? 'var(--success, #16a34a)' : escapeHtml(o.kleur)) + ';height:100%;width:' + checklistPct + '%;transition:width 0.3s"></div>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary" data-tenant-id="' + escapeHtml(o.id) + '" style="margin-top:6px">Beheer →</button>' +
        '</div>';
    }).join('');

    // Knoppen: tenant override + redirect
    listEl.querySelectorAll('button[data-tenant-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tId = btn.getAttribute('data-tenant-id');
        localStorage.setItem('wegwijzer_active_tenant_id', tId);
        window.location.href = appUrl('admin.html');
      });
    });
  }

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
