// =============================================
// WEGWIJZER — Admin paneel logica
// =============================================

(function () {
  'use strict';

  // ---- State ----
  var tenantId = null;
  var allConversations = [];
  var allProfiles = [];
  var allTeamleiders = [];
  var allDocuments = [];

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

  // ---- Wacht op auth ----
  document.addEventListener('wegwijzer-auth-ready', function (e) {
    tenantId = e.detail.profile.tenant_id;
    initTabs();
    initLogout();
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
  });

  // =============================================
  // TABS
  // =============================================
  function initTabs() {
    var buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(function (c) {
          c.classList.remove('active');
        });
        document.getElementById('tab-' + tab).classList.add('active');
      });
    });
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
  // TEKST EXTRACTIE UIT BESTANDEN
  // =============================================
  async function extractTextFromFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'txt') {
      return await file.text();
    }

    if (ext === 'pdf') {
      return await extractPdfText(file);
    }

    if (ext === 'docx') {
      return await extractDocxText(file);
    }

    if (ext === 'doc') {
      var text = await file.text();
      return text.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
    }

    return '';
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
      label.className = 'checkbox-label';
      label.style.display = 'block';
      label.style.marginBottom = '4px';

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

  function populateTeamleiderDropdown(selectId, selectedNaam) {
    var select = document.getElementById(selectId);
    if (!select) return;
    var current = selectedNaam || select.value || '';
    select.innerHTML = '<option value="">— Geen teamleider —</option>';
    allTeamleiders.forEach(function (tl) {
      var opt = document.createElement('option');
      opt.value = tl.naam;
      opt.textContent = tl.naam;
      if (tl.naam === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // =============================================
  // DOCUMENTEN
  // =============================================
  function initUpload() {
    var zone = document.getElementById('upload-zone');
    var input = document.getElementById('file-input');

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
        handleFiles(e.dataTransfer.files);
      }
    });

    input.addEventListener('change', function () {
      if (input.files.length > 0) {
        handleFiles(input.files);
        input.value = '';
      }
    });
  }

  async function handleFiles(files) {
    var progress = document.getElementById('upload-progress');
    var itemsContainer = document.getElementById('upload-items');
    progress.classList.add('show');
    itemsContainer.innerHTML = '';

    // Lees extra metadata velden
    var docTypeEl = document.getElementById('doc-type');
    var docRevisieEl = document.getElementById('doc-revisiedatum');
    var documenttype = docTypeEl ? docTypeEl.value : null;
    var revisiedatum = docRevisieEl ? docRevisieEl.value : null;

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

      if (!['pdf', 'doc', 'docx', 'txt'].includes(ext)) {
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
      statusEl.textContent = 'Tekst extraheren...';
      fillEl.style.width = '20%';

      var extractedText = '';
      try {
        extractedText = await extractTextFromFile(file);
      } catch (err) {
        console.error('Extractie fout:', err);
      }

      // Stap 2: Uploaden naar storage
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

        if (uploadResult.error) {
          statusEl.textContent = 'Upload mislukt';
          statusEl.style.color = 'var(--error)';
          fillEl.style.width = '100%';
          fillEl.style.background = 'var(--error)';
          continue;
        }

        // Stap 3: Metadata + content opslaan
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

        var insertResult = await supabaseClient
          .from('documents')
          .insert(insertData);

        if (insertResult.error) {
          statusEl.textContent = 'Metadata mislukt';
          statusEl.style.color = 'var(--error)';
          fillEl.style.width = '100%';
          fillEl.style.background = 'var(--error)';
          continue;
        }

        // Klaar
        statusEl.textContent = 'Gereed ✓';
        statusEl.style.color = 'var(--success)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--success)';

      } catch (err) {
        statusEl.textContent = 'Fout';
        statusEl.style.color = 'var(--error)';
        fillEl.style.width = '100%';
        fillEl.style.background = 'var(--error)';
      }
    }

    // Reset na 3 seconden
    setTimeout(function () {
      progress.classList.remove('show');
      itemsContainer.innerHTML = '';
    }, 3000);

    loadDocuments();
  }

  async function loadDocuments() {
    var tbody = document.getElementById('documents-body');

    var result = await supabaseClient
      .from('documents')
      .select('id, naam, created_at, bestandspad, content, documenttype, revisiedatum')
      .eq('tenant_id', tenantId)
      .is('user_id', null)
      .order('created_at', { ascending: false });

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

    tbody.innerHTML = result.data.map(function (doc) {
      var datum = new Date(doc.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      var contentStatus = doc.content
        ? '<span style="color:var(--success);font-size:0.75rem" title="Tekst geëxtraheerd">✓</span>'
        : '<span style="color:var(--error);font-size:0.75rem" title="Geen tekst">✗</span>';

      var typeLabel = formatDocumentType(doc.documenttype);
      // versienummer verwijderd

      // Revisie kolom met kleurcodering
      var revisieLabel = '-';
      if (doc.revisiedatum) {
        var color = getRevisieColor(doc.revisiedatum);
        var revisieFormatted = new Date(doc.revisiedatum).toLocaleDateString('nl-NL', {
          day: 'numeric', month: 'short', year: 'numeric'
        });
        revisieLabel = '<span style="color:' + color + ';font-weight:600">' + revisieFormatted + '</span>';
      }

      return '<tr>' +
        '<td>' + escapeHtml(doc.naam) + ' ' + contentStatus + '</td>' +
        '<td>' + typeLabel + '</td>' +
        '<td>' + revisieLabel + '</td>' +
        '<td>' + datum + '</td>' +
        '<td>' +
          '<button class="btn-icon" onclick="window.previewDocument(\'' + escapeHtml(doc.bestandspad) + '\')" title="Bekijken">👁️</button>' +
          '<button class="btn-icon" onclick="window.editDocument(\'' + doc.id + '\')" title="Bewerken">✏️</button>' +
          '<button class="btn-icon btn-icon-danger" onclick="window.deleteDocument(\'' + doc.id + '\', \'' + escapeHtml(doc.bestandspad) + '\')" title="Verwijderen">🗑️</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

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

  // ---- Document bewerken ----
  window.editDocument = function (docId) {
    var doc = allDocuments.find(function (d) { return d.id === docId; });
    if (!doc) return;

    document.getElementById('edit-doc-id').value = doc.id;
    document.getElementById('edit-doc-naam').value = doc.naam || '';
    document.getElementById('edit-doc-type').value = doc.documenttype || 'overig';
    document.getElementById('edit-doc-revisie').value = doc.revisiedatum || '';

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
      if (e.target === modal) modal.classList.remove('show');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      alertBox.className = 'alert';

      var docId = document.getElementById('edit-doc-id').value;
      var naam = document.getElementById('edit-doc-naam').value.trim();
      var documenttype = document.getElementById('edit-doc-type').value;
      // versienummer verwijderd
      var revisiedatum = document.getElementById('edit-doc-revisie').value || null;

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
          revisiedatum: revisiedatum
        })
        .eq('id', docId);

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Opslaan mislukt: ' + result.error.message;
      } else {
        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Document bijgewerkt.';
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
      .select('id, naam, email, role, functiegroep, startdatum, user_id, inwerktraject_url, werkuren, regio, account_type, einddatum, teams, teamleider_naam, inwerken_afgerond')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="9" class="no-data">Kon medewerkers niet laden.</td></tr>';
      return;
    }

    allProfiles = result.data;
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
        '<td>' + escapeHtml(p.werkuren || '-') + '</td>' +
        '<td>' + escapeHtml(p.regio || '-') + '</td>' +
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
    if (!confirm('Weet je zeker dat je deze medewerker wilt verwijderen? Dit verwijdert ook alle gesprekken.')) return;

    await supabaseClient.from('profiles').delete().eq('id', profileId);

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

      if (!['pdf', 'doc', 'docx', 'txt'].includes(ext)) continue;
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
    populateTeamleiderDropdown('invite-teamleider');

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
      modal.classList.add('show');
    });

    cancelBtn.addEventListener('click', function () {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('show');
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
      var regio = document.getElementById('invite-regio').value.trim();

      // Nieuwe velden
      var accountTypeEl = document.querySelector('input[name="invite-account-type"]:checked');
      var accountType = accountTypeEl ? accountTypeEl.value : 'vast';
      var einddatum = document.getElementById('invite-einddatum').value || null;
      var teams = getCheckedTeams('invite-teams');
      var teamleiderNaam = document.getElementById('invite-teamleider').value || null;

      if (!naam || !email || !functiegroep || !startdatum) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Vul alle verplichte velden in.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Even geduld...';

      try {
        var result = await supabaseClient.auth.admin.inviteUserByEmail(email, {
          data: {
            role: 'medewerker',
            naam: naam,
            functiegroep: functiegroep,
            tenant_id: tenantId
          },
          redirectTo: window.location.origin + appUrl('wachtwoord-instellen.html')
        });

        if (result.error) {
          var signUpResult = await supabaseClient.auth.signUp({
            email: email,
            password: generateTempPassword(),
            options: {
              data: {
                role: 'medewerker',
                naam: naam,
                functiegroep: functiegroep,
                tenant_id: tenantId
              },
              emailRedirectTo: window.location.origin + appUrl('wachtwoord-instellen.html')
            }
          });

          if (signUpResult.error) {
            alertBox.className = 'alert alert-error show';
            alertMsg.textContent = 'Uitnodigen mislukt: ' + signUpResult.error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Uitnodigen';
            return;
          }

          await new Promise(function (r) { setTimeout(r, 1500); });

          if (signUpResult.data && signUpResult.data.user) {
            var updateData = { startdatum: startdatum, account_type: accountType };
            if (inwerktrajectUrl) updateData.inwerktraject_url = inwerktrajectUrl;
            if (werkuren) updateData.werkuren = werkuren;
            if (regio) updateData.regio = regio;
            if (einddatum) updateData.einddatum = einddatum;
            if (teams.length > 0) updateData.teams = teams;
            if (teamleiderNaam) updateData.teamleider_naam = teamleiderNaam;

            await supabaseClient
              .from('profiles')
              .update(updateData)
              .eq('user_id', signUpResult.data.user.id);
          }
        } else {
          await new Promise(function (r) { setTimeout(r, 1500); });

          if (result.data && result.data.user) {
            var updateData2 = { startdatum: startdatum, account_type: accountType };
            if (inwerktrajectUrl) updateData2.inwerktraject_url = inwerktrajectUrl;
            if (werkuren) updateData2.werkuren = werkuren;
            if (regio) updateData2.regio = regio;
            if (einddatum) updateData2.einddatum = einddatum;
            if (teams.length > 0) updateData2.teams = teams;
            if (teamleiderNaam) updateData2.teamleider_naam = teamleiderNaam;

            await supabaseClient
              .from('profiles')
              .update(updateData2)
              .eq('user_id', result.data.user.id);
          }
        }

        alertBox.className = 'alert alert-success show';
        alertMsg.innerHTML = 'Uitnodiging verstuurd naar <strong>' + escapeHtml(email) + '</strong>.<br>' +
          '<span style="font-size:0.8rem;margin-top:4px;display:inline-block">' +
          '⚠️ Let op: de uitnodigingsmail kan in de spamfolder terechtkomen. ' +
          'Vraag de medewerker om ook de spam/ongewenste mail te controleren.</span>';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Uitnodigen';

        loadMedewerkers();

        setTimeout(function () {
          modal.classList.remove('show');
        }, 5000);
      } catch (err) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Er ging iets mis. Probeer het opnieuw.';
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
    document.getElementById('edit-functiegroep').value = p.functiegroep || '';
    document.getElementById('edit-werkuren').value = p.werkuren || '';
    document.getElementById('edit-regio').value = p.regio || '';
    document.getElementById('edit-startdatum').value = p.startdatum || '';
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

    // Teamleider dropdown
    populateTeamleiderDropdown('edit-teamleider', p.teamleider_naam);

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
      if (e.target === modal) modal.classList.remove('show');
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
      var regio = document.getElementById('edit-regio').value.trim();

      // Nieuwe velden
      var accountTypeEl = document.querySelector('input[name="edit-account-type"]:checked');
      var accountType = accountTypeEl ? accountTypeEl.value : 'vast';
      var einddatum = document.getElementById('edit-einddatum').value || null;
      var teams = getCheckedTeams('edit-teams');
      var teamleiderNaam = document.getElementById('edit-teamleider').value || null;

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
        await supabaseClient
          .from('functie_historie')
          .insert({
            profile_id: profileId,
            vorige_functie: huidigProfiel.functiegroep,
            nieuwe_functie: functiegroep,
            gewijzigd_op: new Date().toISOString()
          });
      }

      var updateData = {
        naam: naam,
        functiegroep: functiegroep,
        startdatum: startdatum || null,
        inwerktraject_url: inwerktrajectUrl || null,
        werkuren: werkuren || null,
        regio: regio || null,
        account_type: accountType,
        einddatum: einddatum,
        teams: teams.length > 0 ? teams : null,
        teamleider_naam: teamleiderNaam
      };

      var result = await supabaseClient
        .from('profiles')
        .update(updateData)
        .eq('id', profileId);

      if (result.error) {
        alertBox.className = 'alert alert-error show';
        alertMsg.textContent = 'Opslaan mislukt: ' + result.error.message;
      } else {
        alertBox.className = 'alert alert-success show';
        alertMsg.textContent = 'Medewerker bijgewerkt.';
        loadMedewerkers();
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
      var naam = profile ? (profile.naam || profile.email) : 'Onbekend';

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
      if (e.target === modal) modal.classList.remove('show');
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
    var tbody = document.getElementById('verbeter-body');
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
      loadKennisbankItems(kennisbankItems);
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
      var actieBtn = !isBeantwoord
        ? '<button class="btn btn-sm" onclick="window.openVerbeterModal(\'' + escapeHtml(item.vraag.replace(/'/g, "\\'")) + '\')">Beantwoord</button>'
        : '';

      return '<tr>' +
        '<td title="' + escapeHtml(item.vraag) + '">' + escapeHtml(truncated) + '</td>' +
        '<td style="text-align:center">' + item.thumbsDown + '</td>' +
        '<td style="text-align:center">' + item.totaal + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + actieBtn + '</td>' +
        '</tr>';
    }).join('');

    loadKennisbankItems(kennisbankItems);
  }

  function loadKennisbankItems(items) {
    var container = document.getElementById('kennisbank-lijst');
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = '<p class="no-data">Nog geen kennisbank items.</p>';
      return;
    }

    container.innerHTML = items.map(function (kb) {
      var datum = new Date(kb.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      return '<div class="kb-item" style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">' +
        '<div style="font-weight:600;margin-bottom:4px">' + escapeHtml(kb.vraag) + '</div>' +
        '<div style="color:var(--text-muted);font-size:0.9rem">' + escapeHtml(kb.antwoord) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">' + datum + '</div>' +
        '</div>';
    }).join('');
  }

  function initVerbeterModal() {
    var modal = document.getElementById('modal-verbeter');
    if (!modal) return;

    var form = document.getElementById('verbeter-form');
    var cancelBtn = document.getElementById('verbeter-cancel-btn');
    var submitBtn = document.getElementById('verbeter-submit-btn');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('show');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('show');
    });

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var vraag = document.getElementById('verbeter-vraag').value;
        var antwoord = document.getElementById('verbeter-antwoord').value.trim();

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
          });

        if (result.error) {
          alert('Opslaan mislukt: ' + result.error.message);
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
    var modal = document.getElementById('modal-verbeter');
    if (!modal) return;

    var vraagEl = document.getElementById('verbeter-vraag');
    var vraagDisplayEl = document.getElementById('verbeter-vraag-display');
    var antwoordEl = document.getElementById('verbeter-antwoord');

    if (vraagEl) vraagEl.value = vraag;
    if (vraagDisplayEl) vraagDisplayEl.textContent = vraag;
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
      .select('id, naam, email, telefoon, teams')
      .eq('tenant_id', tenantId)
      .order('naam', { ascending: true });

    if (result.error || !result.data) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="no-data">Kon teamleiders niet laden.</td></tr>';
      return;
    }

    allTeamleiders = result.data;

    // Update teamleider dropdowns in invite en edit modals
    populateTeamleiderDropdown('invite-teamleider');
    populateTeamleiderDropdown('edit-teamleider');

    if (!tbody) return;

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="no-data">Nog geen teamleiders.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (tl) {
      var teamsStr = '-';
      if (tl.teams && Array.isArray(tl.teams) && tl.teams.length > 0) {
        teamsStr = tl.teams.join(', ');
      }

      return '<tr>' +
        '<td>' + escapeHtml(tl.naam) + '</td>' +
        '<td>' + escapeHtml(tl.email || '-') + '</td>' +
        '<td>' + escapeHtml(tl.telefoon || '-') + '</td>' +
        '<td>' + escapeHtml(teamsStr) + '</td>' +
        '<td>' +
          '<button class="btn-icon" onclick="window.editTeamleider(\'' + tl.id + '\')" title="Bewerken">✏️</button>' +
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

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (form) form.reset();
        document.getElementById('tl-id').value = '';
        populateTeamCheckboxes('tl-teams', []);
        modal.classList.add('show');
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('show');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('show');
    });

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var tlId = document.getElementById('tl-id').value;
        var naam = document.getElementById('tl-naam').value.trim();
        var email = document.getElementById('tl-email').value.trim();
        var telefoon = document.getElementById('tl-telefoon').value.trim();
        var teams = getCheckedTeams('tl-teams');

        if (!naam) return;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Opslaan...';
        }

        var data = {
          tenant_id: tenantId,
          naam: naam,
          email: email || null,
          telefoon: telefoon || null,
          teams: teams.length > 0 ? teams : null
        };

        var result;
        if (tlId) {
          // Update
          result = await supabaseClient
            .from('teamleiders')
            .update(data)
            .eq('id', tlId);
        } else {
          // Insert
          result = await supabaseClient
            .from('teamleiders')
            .insert(data);
        }

        if (result.error) {
          alert('Opslaan mislukt: ' + result.error.message);
        } else {
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
    document.getElementById('tl-email').value = tl.email || '';
    document.getElementById('tl-telefoon').value = tl.telefoon || '';
    populateTeamCheckboxes('tl-teams', tl.teams || []);

    modal.classList.add('show');
  };

  window.deleteTeamleider = async function (id) {
    if (!confirm('Weet je zeker dat je deze teamleider wilt verwijderen?')) return;

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
    var result = await supabaseClient
      .from('meldingen')
      .select('id, type, bericht, created_at, gelezen')
      .eq('tenant_id', tenantId)
      .eq('gelezen', false)
      .order('created_at', { ascending: false });

    if (result.error || !result.data || result.data.length === 0) return;

    var meldingen = result.data;

    // Toon notificatie badge of alert
    var meldingenContainer = document.getElementById('meldingen-lijst');
    if (meldingenContainer) {
      meldingenContainer.innerHTML = meldingen.map(function (m) {
        var datum = new Date(m.created_at).toLocaleDateString('nl-NL', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        return '<div class="alert alert-warning show" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
          '<div><strong>' + escapeHtml(m.type || 'Melding') + '</strong> — ' + escapeHtml(m.bericht) +
          '<br><small style="color:var(--text-muted)">' + datum + '</small></div>' +
          '<button class="btn-icon" onclick="window.markeerGelezen(\'' + m.id + '\')" title="Markeer als gelezen">✓</button>' +
          '</div>';
      }).join('');
    }

    // Badge op relevante tabs
    var meldingenBadge = document.getElementById('meldingen-badge');
    if (meldingenBadge) {
      meldingenBadge.textContent = meldingen.length;
      meldingenBadge.style.display = 'inline-block';
    }
  }

  window.markeerGelezen = async function (id) {
    await supabaseClient
      .from('meldingen')
      .update({ gelezen: true })
      .eq('id', id);

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

    // Badge updaten
    var openstaand = result.data.filter(function (a) { return a.status === 'in_afwachting'; });
    var badge = document.getElementById('aanvragen-badge');
    if (badge) {
      if (openstaand.length > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = openstaand.length;
      } else {
        badge.style.display = 'none';
      }
    }

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
      // Maak medewerker aan via signUp
      var signUpResult = await supabaseClient.auth.signUp({
        email: a.medewerker_email,
        password: generateTempPassword(),
        options: {
          data: {
            role: 'medewerker',
            naam: a.medewerker_naam,
            functiegroep: a.medewerker_functiegroep,
            tenant_id: tenantId
          },
          emailRedirectTo: window.location.origin + appUrl('wachtwoord-instellen.html')
        }
      });

      if (signUpResult.error) {
        alert('Aanmaken mislukt: ' + signUpResult.error.message);
        return;
      }

      // Wacht op trigger
      await new Promise(function (r) { setTimeout(r, 1500); });

      if (signUpResult.data && signUpResult.data.user) {
        var updateData = {};
        if (a.medewerker_startdatum) updateData.startdatum = a.medewerker_startdatum;
        if (a.medewerker_werkuren) updateData.werkuren = a.medewerker_werkuren;
        if (a.medewerker_regio) updateData.regio = a.medewerker_regio;
        if (a.medewerker_team) updateData.teams = [a.medewerker_team];
        await supabaseClient
          .from('profiles')
          .update(updateData)
          .eq('user_id', signUpResult.data.user.id);
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

})();
