// =============================================
// WEGWIJZER — Admin paneel logica
// =============================================

(function () {
  'use strict';

  // ---- State ----
  var namenZichtbaar = false;
  var tenantId = null;
  var allConversations = [];
  var allProfiles = [];
  var allTeamleiders = [];
  var allDocuments = [];
  var allFunctiegroepen = [];

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
    loadFunctiegroepen();
    loadRapporten();
    initRapportBtn();
    loadPrivacyVerzoeken();
    initFunctiegroepFormToggle();
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
      // Situatie C: geen functiegroep gekozen
      zorgFields.forEach(function (el) { el.style.display = 'none'; });
      kantoorFields.forEach(function (el) { el.style.display = 'none'; });
      sharedFields.forEach(function (el) { el.style.display = 'none'; });
      if (hint) hint.style.display = '';
      return;
    }

    if (hint) hint.style.display = 'none';

    var fg = allFunctiegroepen.find(function (f) { return f.code === fgCode; });
    var isKantoor = fg && fg.is_kantoor;

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

        var insertResult = await supabaseClient
          .from('documents')
          .insert(insertData);

        console.log('[Upload] Insert resultaat:', insertResult.error ? 'FOUT: ' + insertResult.error.message : 'OK');

        if (insertResult.error) {
          statusEl.textContent = 'Metadata mislukt: ' + insertResult.error.message;
          statusEl.style.color = 'var(--error)';
          fillEl.style.width = '100%';
          fillEl.style.background = 'var(--error)';
          continue;
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
      .select('id, naam, created_at, bestandspad, content, documenttype, revisiedatum')
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

      return '<tr data-doc-naam="' + escapeHtml(doc.naam) + '" data-doc-id="' + doc.id + '" data-doc-pad="' + escapeHtml(doc.bestandspad) + '">' +
        '<td><input type="checkbox" class="doc-select-cb" value="' + doc.id + '" style="accent-color:var(--primary)" onchange="window.updateBulkBar()"></td>' +
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
    if (checked.length > 0) {
      bar.style.display = '';
      btn.textContent = 'Verwijder geselecteerde (' + checked.length + ')';
    } else {
      bar.style.display = 'none';
    }
    // Sync select-all checkbox
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
            if (afdeling) updateData.afdeling = afdeling;
            updateData.inwerktraject_actief = document.getElementById('invite-inwerktraject-actief').checked;
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
            if (afdeling) updateData2.afdeling = afdeling;
            updateData2.inwerktraject_actief = document.getElementById('invite-inwerktraject-actief').checked;
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
    document.getElementById('edit-afdeling').value = p.afdeling || '';
    document.getElementById('edit-startdatum').value = p.startdatum || '';
    document.getElementById('edit-inwerktraject-actief').checked = p.inwerktraject_actief !== false;
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
        afdeling: afdeling || null,
        inwerktraject_actief: document.getElementById('edit-inwerktraject-actief').checked,
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
      if (e.target !== modal) return;
      if (window.getSelection && window.getSelection().toString().length > 0) return;
      modal.classList.remove('show');
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
      .select('id, naam, email, telefoon, teams, rol, afdelingen')
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

    var rolLabels = { teamleider: 'Teamleider', manager: 'Manager', hr: 'HR Medewerker' };

    tbody.innerHTML = result.data.map(function (tl) {
      var rolLabel = rolLabels[tl.rol] || 'Teamleider';
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
        '<td>' + escapeHtml(tl.email || '-') + '</td>' +
        '<td>' + escapeHtml(tl.telefoon || '-') + '</td>' +
        '<td><span class="badge badge-admin">' + rolLabel + '</span></td>' +
        '<td>' + escapeHtml(koppelingStr) + '</td>' +
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

    var rolSelect = document.getElementById('tl-rol');
    var teamsGroup = document.getElementById('tl-teams-group');
    var afdelingenGroup = document.getElementById('tl-afdelingen-group');
    var modalTitle = document.getElementById('teamleider-modal-title');

    var rolTitels = { teamleider: 'Teamleider toevoegen', manager: 'Manager toevoegen', hr: 'HR Medewerker toevoegen' };
    var rolTitelsEdit = { teamleider: 'Teamleider bewerken', manager: 'Manager bewerken', hr: 'HR Medewerker bewerken' };

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
                  invite_role: 'teamleider',
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
                var rolNaam = { teamleider: 'Teamleider', manager: 'Manager', hr: 'HR Medewerker' };
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
    var rolTitelsEdit = { teamleider: 'Teamleider bewerken', manager: 'Manager bewerken', hr: 'HR Medewerker bewerken' };
    var rol = tl.rol || 'teamleider';
    if (teamsGroup) teamsGroup.style.display = (rol === 'teamleider') ? '' : 'none';
    if (afdelingenGroup) afdelingenGroup.style.display = (rol === 'manager') ? '' : 'none';
    if (modalTitle) modalTitle.textContent = rolTitelsEdit[rol] || 'Bewerken';

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

  function initRapportBtn() {
    var btn = document.getElementById('generate-rapport-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Genereren...';

      var now = new Date();
      var maand = now.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

      // Gather data
      var convResult = await supabaseClient.from('conversations').select('*').eq('tenant_id', tenantId);
      var profResult = await supabaseClient.from('profiles').select('*').eq('tenant_id', tenantId);
      var convs = convResult.data || [];
      var profs = profResult.data || [];

      var medewerkers = profs.filter(function(p) { return p.role === 'medewerker'; });
      var actief = medewerkers.filter(function(p) {
        return convs.some(function(c) { return c.user_id === p.id; });
      });
      var inactief = medewerkers.filter(function(p) {
        return !convs.some(function(c) { return c.user_id === p.id; });
      });

      var metFeedback = convs.filter(function(c) { return c.feedback !== null; });
      var positief = metFeedback.filter(function(c) { return c.feedback === 'goed'; });
      var pct = metFeedback.length > 0 ? Math.round((positief.length / metFeedback.length) * 100) : 0;

      var rapport = {
        gebruik: { actief: actief.length, inactief: inactief.length, totaal_vragen: convs.length },
        kwaliteit: { positief_percentage: pct, totaal_met_feedback: metFeedback.length },
        tijdwinst: { vragen: convs.length, geschatte_minuten: convs.length * 10 },
        aanbevelingen: []
      };

      if (pct < 70 && metFeedback.length > 10) rapport.aanbevelingen.push('Positief percentage is onder 70% — overweeg de kennisbank aan te vullen.');
      if (inactief.length > actief.length) rapport.aanbevelingen.push('Meer inactieve dan actieve accounts — controleer of alle medewerkers op de hoogte zijn.');
      if (convs.length > 500) rapport.aanbevelingen.push('Hoog gebruik — overweeg extra documenten toe te voegen voor veelgestelde onderwerpen.');

      await supabaseClient.from('rapporten').insert({
        tenant_id: tenantId, maand: maand, inhoud: rapport
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
    // Simple: find and display
    var container = document.getElementById('rapporten-list');
    supabaseClient.from('rapporten').select('*').eq('id', id).single().then(function (result) {
      if (!result.data) return;
      var r = result.data.inhoud;
      var html = '<div style="background:var(--bg-white);padding:24px;border-radius:var(--radius);margin-top:16px">' +
        '<h3>Rapport ' + escapeHtml(result.data.maand) + '</h3>' +
        '<h4 style="margin-top:16px;color:var(--primary)">Gebruik</h4>' +
        '<p>Actieve medewerkers: ' + r.gebruik.actief + ' | Inactief: ' + r.gebruik.inactief + ' | Totaal vragen: ' + r.gebruik.totaal_vragen + '</p>' +
        '<h4 style="margin-top:12px;color:var(--primary)">Kwaliteit</h4>' +
        '<p>Positief: ' + r.kwaliteit.positief_percentage + '% (van ' + r.kwaliteit.totaal_met_feedback + ' met feedback)</p>' +
        '<h4 style="margin-top:12px;color:var(--primary)">Tijdwinst (schatting)</h4>' +
        '<p>' + r.tijdwinst.vragen + ' vragen × 10 min = ' + r.tijdwinst.geschatte_minuten + ' minuten bespaard</p>' +
        '<p style="font-size:0.75rem;color:var(--text-muted);font-style:italic">Disclaimer: dit is een schatting</p>';

      if (r.aanbevelingen && r.aanbevelingen.length > 0) {
        html += '<h4 style="margin-top:12px;color:var(--primary)">Aanbevelingen</h4><ul>';
        r.aanbevelingen.forEach(function (a) { html += '<li>' + escapeHtml(a) + '</li>'; });
        html += '</ul>';
      }
      html += '</div>';
      container.innerHTML += html;
    });
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
    // Open medewerker profiel via zoeken
    var profiel = allProfiles.find(function (p) { return p.email === email; });
    if (profiel) {
      window.editMedewerker(profiel.id);
    } else {
      alert('Profiel niet gevonden.');
    }
  };

})();
