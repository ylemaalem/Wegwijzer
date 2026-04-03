// =============================================
// WEGWIJZER — Admin paneel logica
// =============================================

(function () {
  'use strict';

  // ---- State ----
  var tenantId = null;
  var allConversations = [];
  var allProfiles = [];

  // PDF.js worker instellen
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

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
    initUpload();
    initInviteModal();
    initGesprekDetail();
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
      // DOC is binair — probeer als tekst te lezen (beperkte ondersteuning)
      var text = await file.text();
      // Filter binaire rommel, houd leesbare tekst over
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

        var insertResult = await supabaseClient
          .from('documents')
          .insert({
            tenant_id: tenantId,
            naam: file.name,
            bestandspad: filePath,
            geupload_door: profileId,
            content: extractedText || null
          });

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
      .select('id, naam, created_at, bestandspad, content')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="3" class="no-data">Kon documenten niet laden.</td></tr>';
      return;
    }

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="no-data">Nog geen documenten geüpload.</td></tr>';
      document.getElementById('reprocess-banner').style.display = 'none';
      return;
    }

    // Check of er documenten zonder content zijn
    var zonderContent = result.data.filter(function (doc) { return !doc.content; });
    var banner = document.getElementById('reprocess-banner');
    if (zonderContent.length > 0) {
      banner.style.display = 'block';
      document.getElementById('reprocess-message').textContent =
        zonderContent.length + ' document(en) zonder geëxtraheerde tekst. Klik hier om ze te verwerken.';
      banner.onclick = function () { reprocessDocuments(zonderContent); };
    } else {
      banner.style.display = 'none';
    }

    tbody.innerHTML = result.data.map(function (doc) {
      var datum = new Date(doc.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      var contentStatus = doc.content
        ? '<span style="color:var(--success);font-size:0.75rem" title="Tekst geëxtraheerd">✓</span>'
        : '<span style="color:var(--error);font-size:0.75rem" title="Geen tekst">✗</span>';
      return '<tr>' +
        '<td>' + escapeHtml(doc.naam) + ' ' + contentStatus + '</td>' +
        '<td>' + datum + '</td>' +
        '<td><button class="btn-icon btn-icon-danger" onclick="window.deleteDocument(\'' + doc.id + '\', \'' + escapeHtml(doc.bestandspad) + '\')" title="Verwijderen">🗑️</button></td>' +
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
        // Download bestand uit storage
        var downloadResult = await supabaseClient.storage
          .from('documents')
          .download(doc.bestandspad);

        if (downloadResult.error || !downloadResult.data) {
          done++;
          continue;
        }

        // Extraheer tekst
        var text = await extractTextFromBlob(downloadResult.data, doc.naam);

        if (text && text.trim().length > 0) {
          // Update content kolom
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

  window.deleteDocument = async function (id, bestandspad) {
    if (!confirm('Weet je zeker dat je dit document wilt verwijderen?')) return;

    await supabaseClient.storage.from('documents').remove([bestandspad]);
    await supabaseClient.from('documents').delete().eq('id', id);

    loadDocuments();
  };

  // =============================================
  // MEDEWERKERS
  // =============================================
  async function loadMedewerkers() {
    var tbody = document.getElementById('medewerkers-body');

    var result = await supabaseClient
      .from('profiles')
      .select('id, naam, email, role, functiegroep, startdatum, user_id, inwerktraject_url, werkuren, regio')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (result.error || !result.data) {
      tbody.innerHTML = '<tr><td colspan="7" class="no-data">Kon medewerkers niet laden.</td></tr>';
      return;
    }

    allProfiles = result.data;
    updateMedewerkerFilter();

    if (result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="no-data">Nog geen medewerkers.</td></tr>';
      return;
    }

    tbody.innerHTML = result.data.map(function (p) {
      var fg = formatFunctiegroep(p.functiegroep);
      var sd = p.startdatum ? new Date(p.startdatum).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric'
      }) : '-';
      var badge = p.role === 'admin'
        ? '<span class="badge badge-admin">Admin</span>'
        : '<span class="badge badge-medewerker">Medewerker</span>';
      var editBtn = p.role !== 'admin'
        ? '<button class="btn-icon" onclick="window.editMedewerker(\'' + p.id + '\')" title="Bewerken">✏️</button>'
        : '';
      var deleteBtn = p.role !== 'admin'
        ? '<button class="btn-icon btn-icon-danger" onclick="window.deleteMedewerker(\'' + p.id + '\', \'' + p.user_id + '\')" title="Verwijderen">🗑️</button>'
        : '';

      return '<tr>' +
        '<td>' + escapeHtml(p.naam || '-') + ' ' + badge + '</td>' +
        '<td>' + escapeHtml(p.email) + '</td>' +
        '<td class="functiegroep-label">' + fg + '</td>' +
        '<td>' + escapeHtml(p.werkuren || '-') + '</td>' +
        '<td>' + escapeHtml(p.regio || '-') + '</td>' +
        '<td>' + sd + '</td>' +
        '<td>' + editBtn + deleteBtn + '</td>' +
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

  window.deleteMedewerker = async function (profileId, userId) {
    if (!confirm('Weet je zeker dat je deze medewerker wilt verwijderen? Dit verwijdert ook alle gesprekken.')) return;

    await supabaseClient.from('profiles').delete().eq('id', profileId);

    loadMedewerkers();
    loadGesprekken();
    loadStatistieken();
  };

  // ---- Invite Modal ----
  function initInviteModal() {
    var modal = document.getElementById('modal-medewerker');
    var form = document.getElementById('invite-form');
    var cancelBtn = document.getElementById('modal-cancel-btn');
    var addBtn = document.getElementById('add-medewerker-btn');
    var submitBtn = document.getElementById('modal-submit-btn');
    var alertBox = document.getElementById('modal-alert');
    var alertMsg = document.getElementById('modal-alert-message');

    addBtn.addEventListener('click', function () {
      form.reset();
      alertBox.className = 'alert';
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
            var updateData = { startdatum: startdatum };
            if (inwerktrajectUrl) updateData.inwerktraject_url = inwerktrajectUrl;
            if (werkuren) updateData.werkuren = werkuren;
            if (regio) updateData.regio = regio;
            await supabaseClient
              .from('profiles')
              .update(updateData)
              .eq('user_id', signUpResult.data.user.id);
          }
        } else {
          await new Promise(function (r) { setTimeout(r, 1500); });

          if (result.data && result.data.user) {
            var updateData2 = { startdatum: startdatum };
            if (inwerktrajectUrl) updateData2.inwerktraject_url = inwerktrajectUrl;
            if (werkuren) updateData2.werkuren = werkuren;
            if (regio) updateData2.regio = regio;
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

  // ---- Edit Modal ----
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
        regio: regio || null
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

  function generateTempPassword() {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    var pw = '';
    for (var i = 0; i < 24; i++) {
      pw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pw;
  }

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
  // INSTELLINGEN
  // =============================================
  var settingsFields = [
    { sleutel: 'organisatienaam', elementId: 'setting-organisatienaam', fallback: '' },
    { sleutel: 'primaire_kleur', elementId: 'setting-kleur', fallback: '#E8720C' },
    { sleutel: 'website_url', elementId: 'setting-website', fallback: '' },
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
      'persoonlijk_woonbegeleider': 'Pers. Woonbegeleider'
    };
    return map[fg] || fg || '-';
  }
})();
