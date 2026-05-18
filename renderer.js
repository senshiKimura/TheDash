// ══ STATE ══════════════════════════════════════════════════════════════
let projects = [], resources = [], notes = [], groups = [];
let resCats = [], currentResCat = 'all', selectedResCatColor = '#2563eb';
let renameTarget = null;
let currentProjectId = null;
let currentFilter = 'all';
let editingProjectId = null;
let editingTaskId = null;
let editingNoteId = null;
let editingGroupId = null;
let confirmCallback = null;
let selectedProjColor = '#2563eb';
let selectedNoteColor = '#fef9c3';
let selectedGroupColor = '#2563eb';
let selectedGroupFilter = 'all';
let ctxMenuTarget = null;
let pendingCoverPath = null;
let pendingImportPaths = [];
let pendingImportCallback = null;
let pendingTaskColId = 'col-todo';
let selectedColColor = '#2563eb';
let selectedJournalTag = '';
let journalView = 'list'; // 'list' | 'schema'
let appSettings = {};

// Pomodoro state
let pomState = { phase: 'work', running: false, sessionCount: 0, intervalId: null };
const POM_DURATIONS = { work: 25 * 60, break: 5 * 60, longBreak: 15 * 60 };
let pomSecondsLeft = POM_DURATIONS.work;

const DEFAULT_TASK_COLS = [
  { id: 'col-todo',   name: 'À faire',  color: '#f59e0b' },
  { id: 'col-inprog', name: 'En cours', color: '#2563eb' },
  { id: 'col-done',   name: 'Terminé',  color: '#10b981' },
];

const JOURNAL_TAGS = {
  '':          { label: 'Note',       icon: '📝', color: '#64748b' },
  'info':      { label: 'Info',       icon: '💡', color: '#2563eb' },
  'action':    { label: 'Action',     icon: '⚡', color: '#f59e0b' },
  'progress':  { label: 'Avancement', icon: '🎯', color: '#10b981' },
  'decision':  { label: 'Décision',   icon: '◆',  color: '#d97706' },
  'cr':        { label: 'CR',         icon: '📋', color: '#059669' },
  'idea':      { label: 'Idée',       icon: '💭', color: '#7c3aed' },
};

function getTaskCols(p) {
  return p.taskColumns?.length ? p.taskColumns : DEFAULT_TASK_COLS;
}

// ══ INIT ══════════════════════════════════════════════════════════════
async function init() {
  [projects, resources, notes, groups, resCats] = await Promise.all([
    window.api.getProjects(), window.api.getResources(), window.api.getNotes(), window.api.getGroups(), window.api.getResCats()
  ]);
  appSettings = await window.api.getAppSettings();

  // Apply saved dark mode
  if (appSettings.darkMode) applyDarkMode(true);

  startClock();
  updateGreeting();

  // Init rich text toolbars
  bindRichToolbars();

  // Init Pomodoro display
  pomUpdateUI();

  renderHomeV2();
  renderProjects();
  renderResCats();
  renderResources();
  renderNotes();

  // Start auto-sync if server is configured
  startAutoSync();

  // Titlebar
  on('btn-min', 'click', () => window.api.windowMinimize());
  on('btn-max', 'click', () => window.api.windowMaximize());
  on('btn-close', 'click', () => window.api.windowClose());

  // Navigation — exclude settings button
  qAll('.nav-btn:not(#btn-open-settings):not(#btn-toggle-dark)').forEach(btn => btn.addEventListener('click', () => {
    qAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showPage(btn.dataset.page);
  }));

  // Home stat cards → filter
  qAll('.stat-card').forEach(card => {
    if (!card.dataset.status) return;
    card.addEventListener('click', () => {
      setFilter(card.dataset.status);
      navTo('projects');
    });
  });
  on('btn-home-new-project', 'click', () => openProjectModal());
  on('btn-home-note', 'click', () => openNoteModal());
  on('v2-btn-add-note', 'click', () => openNoteModal());

  // Projects
  on('btn-new-project', 'click', () => openProjectModal());
  qAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => setFilter(btn.dataset.filter)));

  // Task columns modal
  on('btn-manage-cols', 'click', openColsModal);
  on('modal-task-cols-close', 'click', () => closeModal('modal-task-cols'));
  on('btn-cancel-task-cols', 'click', () => closeModal('modal-task-cols'));
  on('btn-save-task-col', 'click', saveTaskCol);
  setupColorPicker('new-col-color-picker', (c) => selectedColColor = c);
  q('new-col-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveTaskCol(); });

  // Import file modal
  qAll('.import-action-btn').forEach(btn => btn.addEventListener('click', () => doImportFiles(btn.dataset.action)));
  on('btn-cancel-import', 'click', () => { pendingImportPaths = []; pendingImportCallback = null; closeModal('modal-import-file'); });
  on('modal-import-close', 'click', () => { pendingImportPaths = []; pendingImportCallback = null; closeModal('modal-import-file'); });

  // Journal tag buttons
  qAll('.journal-tag-btn').forEach(btn => btn.addEventListener('click', () => {
    selectedJournalTag = btn.dataset.tag;
    qAll('.journal-tag-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }));

  // Journal view toggle
  on('btn-journal-list', 'click', () => {
    journalView = 'list';
    q('btn-journal-list').classList.add('active');
    q('btn-journal-schema').classList.remove('active');
    const p = proj(); if (p) renderComments(p);
  });
  on('btn-journal-schema', 'click', () => {
    journalView = 'schema';
    q('btn-journal-schema').classList.add('active');
    q('btn-journal-list').classList.remove('active');
    const p = proj(); if (p) renderComments(p);
  });

  // Pomodoro
  on('btn-pomodoro', 'click', togglePomodoro);
  on('pom-close', 'click', () => q('pomodoro-widget').classList.add('hidden'));
  on('pom-start', 'click', pomToggleRunning);
  on('pom-reset', 'click', pomReset);
  on('pom-skip', 'click', pomSkip);
  qAll('.pom-phase-btn').forEach(btn => btn.addEventListener('click', () => {
    pomSetPhase(btn.dataset.phase);
  }));

  // Detail
  on('btn-back', 'click', () => navTo('projects'));
  on('btn-edit-project', 'click', () => { const p = proj(); if (p) openProjectModal(p); });
  on('btn-delete-project', 'click', () => confirmAction('Supprimer ce projet définitivement ?', async () => {
    const p = projects.find(pr => pr.id === currentProjectId);
    if (p) await archiveOnServer('project', p);
    projects = await window.api.deleteProject(currentProjectId);
    scheduleSync();
    renderHome(); renderProjects(); navTo('projects');
  }));
  on('btn-add-task', 'click', () => openTaskModal());
  on('btn-add-file', 'click', addFilesToProject);
  on('btn-add-doc', 'click', () => openModal('modal-doc'));
  on('btn-add-comment', 'click', addComment);
  on('btn-add-reminder', 'click', () => openReminderModal());

  // Project modal
  on('modal-project-close', 'click', () => closeModal('modal-project'));
  on('btn-cancel-project', 'click', () => closeModal('modal-project'));
  on('btn-save-project', 'click', saveProject);
  setupColorPicker('proj-color-picker', (c) => selectedProjColor = c);

  // Task modal
  on('modal-task-close', 'click', () => closeModal('modal-task'));
  on('btn-cancel-task', 'click', () => closeModal('modal-task'));
  on('btn-save-task', 'click', saveTask);

  // Reminder modal
  on('modal-reminder-close', 'click', () => closeModal('modal-reminder'));
  on('btn-cancel-reminder', 'click', () => closeModal('modal-reminder'));
  on('btn-save-reminder', 'click', saveReminder);
  on('rem-type', 'change', updateReminderFields);

  // Doc modal
  on('modal-doc-close', 'click', () => closeModal('modal-doc'));
  on('btn-cancel-doc', 'click', () => closeModal('modal-doc'));
  on('btn-save-doc', 'click', addDoc);

  // Resources
  on('btn-pick-files', 'click', addFilesToResources);
  on('btn-add-url-res', 'click', () => {
    const sel = q('res-category');
    sel.innerHTML = '<option value="">Aucune</option>' + resCats.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    if (currentResCat !== 'all') sel.value = currentResCat;
    openModal('modal-url-res');
  });
  on('modal-url-res-close', 'click', () => closeModal('modal-url-res'));
  on('btn-cancel-url-res', 'click', () => closeModal('modal-url-res'));
  on('btn-save-url-res', 'click', saveUrlResource);
  on('res-search', 'input', (e) => renderResources(e.target.value));

  // Resource categories
  on('btn-add-res-cat', 'click', () => {
    q('res-cat-name').value = '';
    selectedResCatColor = '#2563eb';
    qAll('#res-cat-color-picker .color-opt').forEach(o => o.classList.toggle('selected', o.dataset.color === selectedResCatColor));
    openModal('modal-res-cat');
  });
  on('modal-res-cat-close', 'click', () => closeModal('modal-res-cat'));
  on('btn-cancel-res-cat', 'click', () => closeModal('modal-res-cat'));
  on('btn-save-res-cat', 'click', saveResCat);
  setupColorPicker('res-cat-color-picker', (c) => selectedResCatColor = c);

  // Assign category ctx-menu
  on('ctx-assign-cat', 'click', () => {
    if (ctxMenuTarget?.type !== 'resource') return;
    hideCtxMenu();
    openAssignCatModal();
  });
  on('modal-assign-cat-close', 'click', () => closeModal('modal-assign-cat'));

  // Dark mode toggle
  on('btn-toggle-dark', 'click', () => {
    const isDark = document.body.classList.toggle('dark');
    applyDarkMode(isDark);
    appSettings.darkMode = isDark;
    window.api.saveAppSettings(appSettings);
  });

  // Settings
  on('btn-open-settings', 'click', openSettings);
  on('modal-settings-close', 'click', () => closeModal('modal-settings'));
  on('btn-pick-avatar', 'click', pickAvatar);
  on('btn-clear-avatar', 'click', clearAvatar);
  on('v2-proj-filter', 'change', renderHomeV2);
  on('btn-gcal-save', 'click', saveGcalCreds);
  on('btn-gcal-disconnect', 'click', disconnectGcal);
  window.api.onGoogleAuthSuccess(() => refreshGcalStatus());
  // Settings tabs
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.stab));
  });
  // Server
  on('btn-server-check', 'click', checkServerConnection);
  on('btn-server-register', 'click', registerServerClient);
  on('btn-server-sync', 'click', syncToServer);
  const dz = q('res-drop-zone');
  dz.addEventListener('click', addFilesToResources);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).map(f => f.path);
    if (files.length) await saveFileResources(files);
  });

  // Notes
  on('btn-new-note', 'click', () => openNoteModal());
  on('modal-note-close', 'click', () => closeModal('modal-note'));
  on('btn-cancel-note', 'click', () => closeModal('modal-note'));
  on('btn-save-note', 'click', saveNote);
  setupColorPicker('note-color-picker', (c) => selectedNoteColor = c);

  // Confirm modal
  on('btn-cancel-delete', 'click', () => closeModal('modal-confirm'));
  on('btn-confirm-delete', 'click', () => { closeModal('modal-confirm'); if (confirmCallback) confirmCallback(); });

  // Close overlays on backdrop click
  qAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

  // Context menu
  document.addEventListener('click', (e) => { if (!e.target.closest('#ctx-menu')) hideCtxMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCtxMenu(); } });
  on('ctx-open-folder', 'click', () => {
    if (ctxMenuTarget?.type === 'resource' && ctxMenuTarget.data.value) window.api.showItemInFolder(ctxMenuTarget.data.value);
    hideCtxMenu();
  });
  on('ctx-rename', 'click', () => {
    if (ctxMenuTarget?.type === 'resource') {
      renameTarget = ctxMenuTarget.data;
      q('rename-input').value = renameTarget.name || '';
      openModal('modal-rename');
    }
    hideCtxMenu();
  });
  on('ctx-delete-res', 'click', async () => {
    if (ctxMenuTarget?.type === 'resource') {
      await archiveOnServer('resource', ctxMenuTarget.data);
      resources = await window.api.deleteResource(ctxMenuTarget.data.id);
      scheduleSync();
      renderResources(q('res-search').value);
    }
    hideCtxMenu();
  });
  on('ctx-edit-group', 'click', () => {
    if (ctxMenuTarget?.type === 'group') openGroupModal(ctxMenuTarget.data);
    hideCtxMenu();
  });
  on('ctx-delete-group', 'click', () => {
    if (ctxMenuTarget?.type === 'group') {
      const gid = ctxMenuTarget.data.id;
      const grp = ctxMenuTarget.data;
      confirmAction(`Supprimer le groupe "${ctxMenuTarget.data.name}" ?`, async () => {
        await archiveOnServer('group', grp);
        groups = await window.api.deleteGroup(gid);
        for (const p of projects.filter(pr => pr.groupId === gid)) { p.groupId = null; projects = await window.api.saveProject(p); }
        if (selectedGroupFilter === gid) selectedGroupFilter = 'all';
        scheduleSync();
        renderProjects();
      });
    }
    hideCtxMenu();
  });
  on('ctx-edit-proj', 'click', () => {
    if (ctxMenuTarget?.type === 'project') {
      const p = projects.find(pr => pr.id === ctxMenuTarget.data.id);
      if (p) openProjectModal(p);
    }
    hideCtxMenu();
  });
  on('ctx-delete-proj', 'click', () => {
    if (ctxMenuTarget?.type === 'project') {
      const id = ctxMenuTarget.data.id;
      const p = projects.find(pr => pr.id === id);
      if (p) {
        confirmAction(`Supprimer le projet "${p.title}" ?`, async () => {
          await archiveOnServer('project', p);
          projects = await window.api.deleteProject(id);
          scheduleSync();
          renderProjects();
        });
      }
    }
    hideCtxMenu();
  });

  // Rename modal
  on('modal-rename-close', 'click', () => closeModal('modal-rename'));
  on('btn-cancel-rename', 'click', () => closeModal('modal-rename'));
  on('btn-save-rename', 'click', doRename);
  q('rename-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });

  // Group modal
  on('modal-group-close', 'click', () => closeModal('modal-group'));
  on('btn-cancel-group', 'click', () => closeModal('modal-group'));
  on('btn-save-group', 'click', saveGroup);
  setupColorPicker('group-color-picker', (c) => selectedGroupColor = c);

  // Cover image
  on('btn-pick-cover', 'click', pickCoverImage);
  on('btn-clear-cover', 'click', clearCoverImage);

  // Groups back button
  on('btn-back-groups', 'click', () => { selectedGroupFilter = 'all'; renderProjects(); });

  // Detail tabs
  qAll('.dtab').forEach(btn => btn.addEventListener('click', () => switchDetailTab(btn.dataset.tab)));

  // Post-it modal
  on('btn-add-postit', 'click', () => { q('postit-text').value = ''; selectedPostitColor = '#fef3c7'; qAll('#postit-color-picker .color-opt').forEach(o => o.classList.toggle('selected', o.dataset.color === selectedPostitColor)); openModal('modal-postit'); });
  on('modal-postit-close', 'click', () => closeModal('modal-postit'));
  on('btn-cancel-postit', 'click', () => closeModal('modal-postit'));
  on('btn-save-postit', 'click', addPostit);
  setupColorPicker('postit-color-picker', (c) => selectedPostitColor = c);

  // Whiteboard
  qAll('.wb-tool').forEach(btn => btn.addEventListener('click', () => {
    qAll('.wb-tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wbTool = btn.dataset.tool;
  }));
  on('wb-color', 'input', (e) => { wbColor = e.target.value; });
  on('wb-size', 'input', (e) => { wbSize = parseInt(e.target.value); const lbl = q('wb-size-val'); if (lbl) lbl.textContent = wbSize + 'px'; });
  on('wb-undo', 'click', wbUndo);
  on('wb-clear', 'click', wbClear);
  on('wb-save', 'click', wbSave);

  // Whiteboard text overlay
  on('wb-text-ok', 'click', wbCommitText);
  on('wb-text-cancel', 'click', wbHideTextOverlay);
  document.addEventListener('keydown', (e) => {
    const overlay = q('wb-text-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    if (e.key === 'Enter') { e.preventDefault(); wbCommitText(); }
    if (e.key === 'Escape') { e.preventDefault(); wbHideTextOverlay(); }
  });

  // Whiteboard image tool
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-tool="image"]')) wbOpenImage();
  });

  // Paste image (Ctrl+V) onto whiteboard when tableau tab is active
  document.addEventListener('paste', (e) => {
    if (!wbCtx) return;
    const pane = q('dtab-tableau');
    if (!pane || !pane.classList.contains('active')) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = (ev) => wbDrawImageSrc(ev.target.result, 20, 20);
        reader.readAsDataURL(blob);
        break;
      }
    }
  });

  // Refresh when reminders are checked
  window.api.onRemindersChecked(() => { projects = window.api.getProjects().then(p => { projects = p; renderHome(); }); });
}

// ══ CLOCK & GREETING ══
function applyDarkMode(isDark) {
  document.body.classList.toggle('dark', isDark);
  const icon = document.getElementById('dark-mode-icon');
  const label = document.getElementById('dark-mode-label');
  if (isDark) {
    // Sun icon when dark mode is on
    if (icon) icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    if (label) label.textContent = 'Mode clair';
  } else {
    // Moon icon when light mode is on
    if (icon) icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>';
    if (label) label.textContent = 'Mode sombre';
  }
}

function startClock() {
  function tick() {
    const now = new Date();
    document.getElementById('titlebar-clock').textContent =
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  tick(); setInterval(tick, 1000);
}

function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const ge = document.getElementById('home-greeting');
  const de = document.getElementById('home-date');
  if (ge) ge.textContent = g + ' 👋';
  if (de) de.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ══ NAVIGATION ══
function showPage(name) {
  qAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${name}`);
  if (pageEl) pageEl.classList.add('active');
  if (name === 'home-v2') renderHomeV2();
}

function navTo(page) {
  qAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-page="${page}"]`);
  if (btn) btn.classList.add('active');
  showPage(page);
}

// ══ HOME (V1 supprimé — stub pour compatibilité appels internes) ═══════════
function renderHome() { renderHomeV2(); }

// ══ HOME V2 ══════════════════════════════════════════════════════════
function renderHomeV2() {
  // Date + greeting
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const h = now.getHours();
  const greet = h < 12 ? 'Bonjour' : h < 18 ? 'Bonne après-midi' : 'Bonsoir';
  const el = q('v2-user-name'); if (el) el.textContent = greet + ' !';
  const de = q('v2-today-date'); if (de) de.textContent = dateStr;
  // Custom avatar
  const avatarImg = q('v2-avatar-img');
  const avatarFbk = q('v2-avatar-fallback');
  if (avatarImg) {
    if (appSettings.avatarPath) {
      avatarImg.src = pathToFileUrl(appSettings.avatarPath);
      avatarImg.style.display = 'block';
      if (avatarFbk) avatarFbk.style.display = 'none';
    } else {
      avatarImg.src = 'assets/figurine.png';
      avatarImg.style.display = 'block';
    }
  }

  // Agenda / alerts panel
  const agendaEl = q('v2-agenda-list');
  if (agendaEl) {
    const items = [];
    // Upcoming project deadlines
    projects.filter(p => p.deadline && p.status !== 'termine')
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 3).forEach(p => {
        const d = daysUntil(p.deadline);
        const cls = d < 0 ? 'danger' : d <= 3 ? 'warn' : 'ok';
        items.push({ cls, text: escHtml(p.title), sub: d < 0 ? `En retard de ${-d}j` : d === 0 ? "Aujourd'hui !" : `Dans ${d} jour${d > 1 ? 's' : ''}`, pid: p.id });
      });
    // Urgent tasks
    for (const p of projects) {
      for (const t of (p.tasks || [])) {
        if (t.status !== 'done' && t.priority === 'high' && !t.deadline) {
          items.push({ cls: 'warn', text: escHtml(t.title), sub: `Haute priorité · ${escHtml(p.title)}`, pid: p.id });
        }
      }
    }
    if (!items.length) {
      agendaEl.innerHTML = '<div class="v2-info-empty">Aucun événement pour le moment</div>';
    } else {
      agendaEl.innerHTML = items.map(it => `
        <div class="v2-agenda-item v2-agenda-${it.cls}"${it.pid ? ` data-pid="${it.pid}"` : ''}>
          <div class="v2-agenda-dot"></div>
          <div><div class="v2-agenda-text">${it.text}</div><div class="v2-agenda-sub">${it.sub}</div></div>
        </div>`).join('');
      agendaEl.querySelectorAll('[data-pid]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => openProjectDetail(el.dataset.pid));
      });
    }
  }

  // Notes grid
  const notesEl = q('v2-notes-grid');
  if (notesEl) {
    if (!notes.length) {
      notesEl.innerHTML = '<div class="v2-notes-empty">Aucune note rapide</div>';
    } else {
      notesEl.innerHTML = notes.slice(0, 6).map(n => `
        <div class="v2-note-chip" style="background:${n.color || '#fef9c3'}">
          <div class="v2-note-title">${escHtml(n.title || 'Note')}</div>
          <div class="v2-note-body">${escHtml((n.content || '').slice(0, 80))}${(n.content?.length || 0) > 80 ? '…' : ''}</div>
        </div>`).join('');
    }
  }

  // All-projects kanban — with project filter
  const filterSel = q('v2-proj-filter');
  const filterPid = filterSel ? filterSel.value : '';
  // Populate selector (preserve current selection)
  if (filterSel) {
    const prev = filterSel.value;
    filterSel.innerHTML = '<option value="">Tous les projets</option>' +
      projects.map(p => `<option value="${p.id}"${p.id === prev ? ' selected' : ''}>${escHtml(p.title)}</option>`).join('');
  }
  const allTasks = [];
  for (const p of projects) {
    if (filterPid && p.id !== filterPid) continue;
    for (const t of (p.tasks || [])) {
      allTasks.push({ task: t, project: p });
    }
  }
  const total = allTasks.length;
  const totalEl = q('v2-tasks-total');
  if (totalEl) totalEl.textContent = total ? `${total} tâche${total > 1 ? 's' : ''}` : '';

  const todoTasks   = allTasks.filter(({ task: t }) => t.status === 'a-traiter' || (!t.status && !t.colId) || t.colId === 'col-todo');
  const inprogTasks = allTasks.filter(({ task: t }) => t.status === 'en-cours'  || t.colId === 'col-inprog');
  const urgentTasks = allTasks.filter(({ task: t }) => t.status !== 'done' && (t.priority === 'high' || (t.deadline && daysUntil(t.deadline) <= 2)));
  const doneTasks   = allTasks.filter(({ task: t }) => t.status === 'done'      || t.colId === 'col-done');

  function v2TaskCard({ task: t, project: p }) {
    const dlChip = t.deadline ? `<span class="v2-task-dl ${deadlineClass(t.deadline)}">${formatDeadlineShort(t.deadline)}</span>` : '';
    return `<div class="v2-task-card" data-pid="${p.id}" style="cursor:pointer" title="${escHtml(p.title)}">
      <div class="v2-task-title">${escHtml(t.title)}</div>
      <div class="v2-task-meta"><span class="v2-task-proj">${escHtml(p.title)}</span>${dlChip}</div>
    </div>`;
  }

  [
    { id: 'v2-body-todo',   cnt: 'v2-cnt-todo',   list: todoTasks },
    { id: 'v2-body-inprog', cnt: 'v2-cnt-inprog',  list: inprogTasks },
    { id: 'v2-body-urgent', cnt: 'v2-cnt-urgent',  list: urgentTasks },
    { id: 'v2-body-done',   cnt: 'v2-cnt-done',    list: doneTasks },
  ].forEach(({ id, cnt, list }) => {
    const el = q(id); if (el) el.innerHTML = list.length ? list.map(v2TaskCard).join('') : '<div class="v2-kcol-empty">—</div>';
    const ce = q(cnt); if (ce) ce.textContent = list.length;
  });
  // Click on task card → open project detail
  const kanbanRow = q('v2-kanban-row');
  if (kanbanRow) {
    kanbanRow.querySelectorAll('.v2-task-card[data-pid]').forEach(el => {
      el.addEventListener('click', () => openProjectDetail(el.dataset.pid));
    });
  }

  // Sidebar upcoming deadlines
  const sidebarDl = document.getElementById('sidebar-deadlines');
  if (sidebarDl) {
    const upcoming = projects.filter(p => p.deadline && p.status !== 'termine' && daysUntil(p.deadline) <= 3)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    if (upcoming.length) {
      sidebarDl.innerHTML = '<div class="sidebar-label">⚠️ Échéances proches</div>' +
        upcoming.map(p => `<div class="sidebar-deadlines-item" data-id="${p.id}" style="cursor:pointer">🔔 ${escHtml(p.title.slice(0, 18))} · ${formatDeadlineShort(p.deadline)}</div>`).join('');
      sidebarDl.querySelectorAll('[data-id]').forEach(el => {
        el.addEventListener('click', () => openProjectDetail(el.dataset.id));
      });
    } else sidebarDl.innerHTML = '';
  }
}

function renderHomeList(id, list) {
  const el = q(id);
  if (!list.length) { el.innerHTML = '<p class="empty-state">Aucun projet</p>'; return; }
  el.innerHTML = list.map(p => {
    const dl = p.deadline ? `<div class="deadline-chip">📅 ${formatDeadlineShort(p.deadline)}</div>` : '';
    return `<div class="proj-card-sm" data-id="${p.id}">
      <h3>${colorDot(p.color)}${escHtml(p.title)}</h3>
      <p>${stripHtml(p.description) || 'Aucune description'}</p>${dl}
    </div>`;
  }).join('');
  el.querySelectorAll('.proj-card-sm').forEach(c => c.addEventListener('click', () => openProjectDetail(c.dataset.id)));
}

// ══ PROJECTS ══════════════════════════════════════════════════════════
function projectCardHtml(p) {
  const tasks = p.tasks || [];
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const pct = tasks.length ? Math.round(doneTasks / tasks.length * 100) : null;
  const dlChip = p.deadline && p.status !== 'termine' ? deadlineChip(p.deadline) : '';
  const tags = (p.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
  const cover = p.coverImage
    ? `<div class="proj-card-cover"><img src="${pathToFileUrl(p.coverImage)}" loading="lazy"/></div>`
    : `<div class="proj-card-accent" style="background:${p.color || 'var(--accent)'}"></div>`;
  return `<div class="proj-card" data-id="${p.id}" data-status="${p.status}">
    ${cover}
    <h3>${escHtml(p.title)}</h3>
    ${tags ? `<div class="proj-card-tags">${tags}</div>` : ''}
    <p>${stripHtml(p.description) || 'Aucune description'}</p>
    <div class="proj-card-footer">
      <span class="status-badge ${p.status}">${statusLabel(p.status)}</span>
      ${dlChip}
    </div>
    ${pct !== null ? `<div style="display:flex;align-items:center;gap:8px;margin-top:10px">
      <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      <span class="proj-task-progress">${doneTasks}/${tasks.length}</span>
    </div>` : ''}
  </div>`;
}

function folderSVG(color) {
  return `<svg width="64" height="56" viewBox="0 0 64 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="14" width="26" height="10" rx="4" fill="${color}" opacity="0.55"/>
    <rect x="2" y="20" width="60" height="34" rx="6" fill="${color}" opacity="0.18"/>
    <rect x="2" y="20" width="60" height="34" rx="6" fill="${color}" opacity="0.85"/>
    <rect x="2" y="20" width="60" height="10" rx="0" fill="${color}"/>
    <rect x="2" y="20" width="60" height="10" rx="6" fill="${color}"/>
  </svg>`;
}

function renderProjects() {
  const grid = q('projects-grid');
  const filterBar = q('projects-filter-bar');
  const groupHeader = q('group-view-header');

  if (selectedGroupFilter === 'all') {
    // ── Root view: folder cards + ungrouped projects ──
    if (filterBar) filterBar.style.display = 'none';
    if (groupHeader) groupHeader.style.display = 'none';

    let html = '';

    groups.forEach(g => {
      const count = projects.filter(p => p.groupId === g.id).length;
      html += `<div class="group-folder-card" data-gid="${g.id}" style="--gcolor:${g.color || '#2563eb'}">
        ${folderSVG(g.color || '#2563eb')}
        <div class="folder-name">${escHtml(g.name)}</div>
        <div class="folder-count">${count} projet${count !== 1 ? 's' : ''}</div>
      </div>`;
    });

    html += `<div class="group-folder-add" id="btn-new-group-card">
      <div class="folder-add-icon">+</div>
      <div class="folder-name">Nouveau groupe</div>
    </div>`;

    let ungrouped = projects.filter(p => !p.groupId);
    if (currentFilter !== 'all') {
      ungrouped = currentFilter === 'urgent'
        ? ungrouped.filter(p => p.deadline && p.status !== 'termine' && daysUntil(p.deadline) <= 7)
        : ungrouped.filter(p => p.status === currentFilter);
    }

    if (ungrouped.length > 0) {
      html += `<div class="section-sep">Sans groupe</div>`;
      html += ungrouped.map(projectCardHtml).join('');
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.group-folder-card').forEach(card => {
      card.addEventListener('click', () => { selectedGroupFilter = card.dataset.gid; renderProjects(); });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const g = groups.find(x => x.id === card.dataset.gid);
        if (g) showCtxMenu(e, 'group', g);
      });
    });
    q('btn-new-group-card')?.addEventListener('click', () => openGroupModal());

  } else {
    // ── Group view: back header + projects in group ──
    const g = groups.find(x => x.id === selectedGroupFilter);
    if (filterBar) filterBar.style.display = '';
    if (groupHeader) { groupHeader.style.display = 'flex'; q('group-view-title').textContent = g?.name || ''; }

    let filtered = projects.filter(p => p.groupId === selectedGroupFilter);
    if (currentFilter !== 'all') {
      filtered = currentFilter === 'urgent'
        ? filtered.filter(p => p.deadline && p.status !== 'termine' && daysUntil(p.deadline) <= 7)
        : filtered.filter(p => p.status === currentFilter);
    }

    grid.innerHTML = filtered.length
      ? filtered.map(projectCardHtml).join('')
      : '<p class="empty-state" style="grid-column:1/-1;padding:40px">Aucun projet dans ce groupe</p>';
  }

  grid.querySelectorAll('.proj-card').forEach(c => {
    c.addEventListener('click', () => openProjectDetail(c.dataset.id));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtxMenu(e, 'project', { id: c.dataset.id }); });
  });
}

function setFilter(filter) {
  currentFilter = filter;
  qAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderProjects();
}

// ══ DETAIL ═══════════════════════════════════════════════════════════
function switchDetailTab(tab) {
  qAll('.dtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  qAll('.dtab-pane').forEach(p => p.classList.toggle('active', p.id === `dtab-${tab}`));
  if (tab === 'tableau') requestAnimationFrame(initWhiteboard);
}

function openProjectDetail(idOrObj) {
  const id = typeof idOrObj === 'object' ? idOrObj.id : idOrObj;
  currentProjectId = id;
  const p = projects.find(p => p.id === id);
  if (!p) return;

  // Cover image
  const coverEl = q('detail-cover-img');
  if (p.coverImage) { coverEl.src = pathToFileUrl(p.coverImage); coverEl.style.display = 'block'; }
  else { coverEl.style.display = 'none'; coverEl.src = ''; }

  // Title / status / desc / url
  q('detail-title').textContent = p.title;
  q('detail-desc').innerHTML = p.description || '<em style="color:var(--text3)">Aucune description</em>';
  const badge = q('detail-status');
  badge.className = `status-badge ${p.status}`;
  badge.textContent = statusLabel(p.status);
  const urlEl = q('detail-url');
  if (p.url) { urlEl.style.display = 'inline-flex'; urlEl.onclick = (e) => { e.preventDefault(); window.api.openUrl(p.url); }; }
  else { urlEl.style.display = 'none'; }

  // Deadline stat box
  const dlEl = q('detail-deadline-info');
  if (p.deadline) {
    const d = daysUntil(p.deadline);
    const color = d < 0 ? 'var(--danger)' : d <= 7 ? '#f59e0b' : 'var(--text3)';
    const diffText = d < 0 ? `${Math.abs(d)}j de retard` : d === 0 ? "Aujourd'hui !" : `Dans ${d}j`;
    dlEl.innerHTML = `<strong>${formatDate2(p.deadline)}</strong><br><small style="color:${color}">${diffText}</small>`;
  } else { dlEl.textContent = '—'; }

  // Next reminder stat box
  const remEl = q('detail-next-reminder');
  const rems = (p.reminders || []).filter(r => r.type === 'date' && r.date).sort((a, b) => a.date.localeCompare(b.date));
  const nextRem = rems.find(r => r.date >= new Date().toISOString().slice(0, 10));
  remEl.textContent = nextRem ? formatDate2(nextRem.date) : '—';

  // Task count stat boxes
  const tasks = p.tasks || [];
  q('detail-tasks-todo').textContent = tasks.filter(t => t.status === 'todo').length;
  q('detail-tasks-inprog').textContent = tasks.filter(t => t.status === 'in-progress').length;

  renderTasks(p);
  renderDocs(p);
  renderComments(p);
  renderReminders(p);
  renderPostits(p);

  switchDetailTab('resume');
  qAll('.nav-btn').forEach(b => b.classList.remove('active'));
  showPage('detail');
}

let selectedPostitColor = '#fef3c7';

function renderPostits(p) {
  const notes = p.postits || [];
  const html = notes.length
    ? notes.map(n => `<div class="postit" style="background:${n.color || '#fef3c7'}" data-pid="${n.id}">
        <button class="postit-del" data-pid="${n.id}" title="Supprimer">✕</button>
        <p>${escHtml(n.text)}</p>
      </div>`).join('')
    : '<p class="postit-empty">Aucune note. Cliquez sur "+ Note" pour en créer une.</p>';
  const board = q('postit-board');
  if (!board) return;
  board.innerHTML = html;
  board.querySelectorAll('.postit-del').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePostit(btn.dataset.pid);
  }));
}

async function addPostit() {
  const text = q('postit-text').value.trim();
  if (!text) { q('postit-text').focus(); return; }
  const p = projects.find(pr => pr.id === currentProjectId);
  if (!p) return;
  if (!p.postits) p.postits = [];
  p.postits.push({ id: uid(), text, color: selectedPostitColor });
  projects = await window.api.saveProject(p);
  renderPostits(projects.find(pr => pr.id === currentProjectId));
  closeModal('modal-postit');
}

async function deletePostit(pid) {
  const p = projects.find(pr => pr.id === currentProjectId);
  if (!p) return;
  p.postits = (p.postits || []).filter(n => n.id !== pid);
  projects = await window.api.saveProject(p);
  renderPostits(projects.find(pr => pr.id === currentProjectId));
}

function renderTasks(p) {
  const board = q('kanban-board');
  if (!board) return;
  const cols = getTaskCols(p);
  const tasks = p.tasks || [];

  board.innerHTML = cols.map(col => {
    const colTasks = tasks.map((t, i) => ({ t, i })).filter(({ t }) => (t.colId || 'col-todo') === col.id);
    return `<div class="kanban-col" data-col="${col.id}">
      <div class="kanban-col-header" style="border-top-color:${col.color}">
        <span class="kanban-col-dot" style="background:${col.color}"></span>
        <span class="kanban-col-name">${escHtml(col.name)}</span>
        <span class="kanban-col-count">${colTasks.length}</span>
        <button class="kanban-col-add" data-col="${col.id}" title="Ajouter dans cette colonne">+</button>
      </div>
      <div class="kanban-col-body" data-col="${col.id}">
        ${colTasks.map(({ t, i }) => kanbanTaskCard(t, i, col)).join('')}
        <div class="kanban-drop-hint">Déposer ici</div>
      </div>
    </div>`;
  }).join('');

  board.querySelectorAll('.kanban-col-add').forEach(btn => {
    btn.addEventListener('click', () => openTaskModal(null, btn.dataset.col));
  });
  board.querySelectorAll('.task-check').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); toggleTask(parseInt(el.dataset.idx));
  }));
  board.querySelectorAll('.task-edit-btn').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); openTaskModal(parseInt(el.dataset.idx));
  }));
  board.querySelectorAll('.task-del').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); removeTask(parseInt(el.dataset.idx));
  }));

  // Drag & drop
  board.querySelectorAll('.kanban-task-card').forEach(card => {
    card.setAttribute('draggable', true);
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.idx);
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  board.querySelectorAll('.kanban-col-body').forEach(body => {
    body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drag-over'); });
    body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over'); });
    body.addEventListener('drop', (e) => {
      e.preventDefault(); body.classList.remove('drag-over');
      const idx = parseInt(e.dataTransfer.getData('text/plain'));
      if (!isNaN(idx)) moveTaskToCol(idx, body.dataset.col);
    });
  });
}

function kanbanTaskCard(t, idx, col) {
  const isDone = t.status === 'done' || col.id === 'col-done';
  const dlChip = t.deadline ? `<span class="task-deadline-chip ${deadlineClass(t.deadline)}">${formatDeadlineShort(t.deadline)}</span>` : '';
  return `<div class="kanban-task-card ${isDone ? 'done-task' : ''}" data-idx="${idx}" data-id="${t.id}">
    <div class="kanban-task-top">
      <div class="task-check ${isDone ? 'checked' : ''}" data-idx="${idx}" title="Marquer">${isDone ? '✓' : ''}</div>
      <div class="kanban-task-info">
        <strong class="${isDone ? 'done-text' : ''}">${escHtml(t.title)}</strong>
        ${t.description ? `<span class="kanban-task-desc">${escHtml(stripHtml(t.description))}</span>` : ''}
      </div>
    </div>
    <div class="kanban-task-footer">
      <span class="task-badge ${t.priority || 'low'}">${priorityLabel(t.priority)}</span>
      ${dlChip}
      <div style="margin-left:auto;display:flex;gap:2px">
        <button class="task-edit-btn" data-idx="${idx}" title="Modifier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="task-del" data-idx="${idx}" title="Supprimer">✕</button>
      </div>
    </div>
  </div>`;
}

async function moveTaskToCol(taskIdx, colId) {
  const p = proj(); if (!p) return;
  if (!p.tasks[taskIdx]) return;
  p.tasks[taskIdx].colId = colId;
  if (colId === 'col-todo') p.tasks[taskIdx].status = 'todo';
  else if (colId === 'col-inprog') p.tasks[taskIdx].status = 'in-progress';
  else if (colId === 'col-done') p.tasks[taskIdx].status = 'done';
  projects = await window.api.saveProject(p);
  renderTasks(p); renderHome(); renderProjects();
}

function renderDocs(p) {
  const list = q('docs-list');
  const docs = p.docs || [];
  if (!docs.length) { list.innerHTML = '<p class="empty-state">Aucun document attaché</p>'; return; }
  list.innerHTML = docs.map((d, i) => `
    <div class="doc-item" data-idx="${i}">
      <span class="doc-icon">${docIcon(d.type)}</span>
      <div class="doc-info"><strong>${escHtml(d.title)}</strong><span>${escHtml(d.content || d.path || '')}</span></div>
      <button class="doc-del" data-idx="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.doc-item').forEach((el, i) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('doc-del')) return;
      const doc = docs[i];
      if (doc.path) window.api.openPath(doc.path);
      else if (doc.content?.startsWith('http')) window.api.openUrl(doc.content);
    });
  });
  list.querySelectorAll('.doc-del').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); removeDoc(parseInt(el.dataset.idx)); }));
}

function renderComments(p) {
  const list = q('comments-list');
  const todayEl = q('journal-today');
  if (todayEl) todayEl.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const comments = (p.comments || []);
  if (!comments.length) {
    list.innerHTML = `<div class="journal-empty">
      <div class="journal-empty-icon">📋</div>
      <p>Aucune entrée dans le journal.<br>Commencez par noter l'avancement du projet.</p>
    </div>`;
    return;
  }
  if (journalView === 'schema') {
    renderJournalSchema(p, comments, list);
    return;
  }
  list.innerHTML = [...comments].reverse().map((c, i) => {
    const realIdx = comments.length - 1 - i;
    const tag = JOURNAL_TAGS[c.tag] || JOURNAL_TAGS[''];
    const d = new Date(c.date);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="journal-entry">
      <div class="journal-entry-line"></div>
      <div class="journal-entry-dot" style="background:${tag.color}"></div>
      <div class="journal-entry-card">
        <div class="journal-entry-header">
          <span class="journal-entry-tag" style="background:${tag.color}22;color:${tag.color}">${tag.icon} ${tag.label}</span>
          <span class="journal-entry-time">${dateStr} · ${timeStr}</span>
          <button class="comment-del" data-idx="${realIdx}" title="Supprimer">✕</button>
        </div>
        <div class="journal-entry-text">${c.text}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.comment-del').forEach(el => el.addEventListener('click', () => removeComment(parseInt(el.dataset.idx))));
  bindRichToolbars();
}

function renderJournalSchema(p, comments, list) {
  // Chronological order (oldest left → newest right)
  const sorted = [...comments].sort((a, b) => new Date(a.date) - new Date(b.date));
  const CIRC = 326.73; // 2πr where r=52
  list.innerHTML = `<div class="journal-schema-wrap">
    <div class="journal-schema-track">
      <div class="journal-schema-axis"></div>
      ${sorted.map((c, i) => {
        const tag = JOURNAL_TAGS[c.tag] || JOURNAL_TAGS[''];
        const pos = i % 2 === 0 ? 'schema-node-above' : 'schema-node-below';
        const d = new Date(c.date);
        const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
        const typeClass = c.tag ? `type-${c.tag}` : '';
        return `<div class="schema-node ${pos}">
          <div class="schema-card ${typeClass}" data-idx="${comments.indexOf(c)}" title="${escHtml(c.text)}">
            <div class="schema-card-tag" style="background:${tag.color}22;color:${tag.color}">${tag.icon} ${tag.label}</div>
            <div class="schema-card-text">${escHtml(c.text)}</div>
            <div class="schema-card-date">${dateStr}</div>
          </div>
          <div class="schema-stem"></div>
          <div class="schema-dot" style="background:${tag.color}"></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
  list.querySelectorAll('.schema-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const idx = parseInt(card.dataset.idx);
      confirmAction('Supprimer cette entrée ?', () => removeComment(idx));
    });
  });
  // Drag-to-pan on schema wrap
  const wrap = list.querySelector('.journal-schema-wrap');
  if (wrap) {
    let isDown = false, startX, scrollLeft;
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDown = true;
      wrap.style.cursor = 'grabbing';
      startX = e.pageX - wrap.offsetLeft;
      scrollLeft = wrap.scrollLeft;
      e.preventDefault();
    });
    wrap.addEventListener('mouseleave', () => { isDown = false; wrap.style.cursor = 'grab'; });
    wrap.addEventListener('mouseup', () => { isDown = false; wrap.style.cursor = 'grab'; });
    wrap.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - wrap.offsetLeft;
      wrap.scrollLeft = scrollLeft - (x - startX);
    });
  }
}

function renderReminders(p) {
  const list = q('reminders-list');
  const reminders = p.reminders || [];
  if (!reminders.length) { list.innerHTML = '<p class="empty-state">Aucune relance configurée</p>'; return; }
  list.innerHTML = reminders.map((r, i) => `
    <div class="reminder-item">
      <span class="rem-icon">${r.type === 'daily' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' : r.type === 'once' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'}}</span>
      <div class="rem-info">
        <strong>${reminderTypeLabel(r)}</strong>
        <span>${escHtml(r.message || 'Rappel automatique')}</span>
      </div>
      <button class="rem-toggle ${r.enabled ? 'on' : ''}" data-idx="${i}" title="${r.enabled ? 'Désactiver' : 'Activer'}">${r.enabled ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="1" y1="1" x2="23" y2="23"/><path d="M17.73 17.73A10 10 0 0 1 11 20H7l-4 4V8a10 10 0 0 1 .27-2.27"/><path d="M21 15.17A6 6 0 0 0 6 8c0 1.5-.37 3.14-1 4.73"/></svg>'}</button>
      <button class="rem-del" data-idx="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.rem-toggle').forEach(el => el.addEventListener('click', () => toggleReminder(parseInt(el.dataset.idx))));
  list.querySelectorAll('.rem-del').forEach(el => el.addEventListener('click', () => removeReminder(parseInt(el.dataset.idx))));
}

// ══ PROJECT MODAL ═════════════════════════════════════════════════════
function openProjectModal(p = null) {
  editingProjectId = p?.id || null;
  q('modal-proj-title').textContent = p ? 'Modifier le projet' : 'Nouveau projet';
  q('proj-title').value = p?.title || '';
  setEditorHtml('proj-desc', p?.description || '');
  q('proj-url').value = p?.url || '';
  q('proj-status').value = p?.status || 'a-traiter';
  q('proj-deadline').value = p?.deadline || '';
  q('proj-tags').value = (p?.tags || []).join(', ');
  selectedProjColor = p?.color || '#2563eb';
  qAll('#proj-color-picker .color-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === selectedProjColor);
  });
  // Populate group select
  const gSel = q('proj-group');
  gSel.innerHTML = '<option value="">— Sans groupe —</option>' +
    groups.map(g => `<option value="${g.id}" ${p?.groupId === g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('');
  if (!p?.groupId) gSel.value = '';
  // Cover image
  pendingCoverPath = p?.coverImage || null;
  if (pendingCoverPath) {
    q('proj-cover-preview').src = pathToFileUrl(pendingCoverPath);
    q('proj-cover-preview').style.display = 'block';
    q('btn-clear-cover').style.display = 'inline-flex';
  } else {
    q('proj-cover-preview').style.display = 'none';
    q('btn-clear-cover').style.display = 'none';
  }
  openModal('modal-project');
}

async function saveProject() {
  const title = q('proj-title').value.trim();
  if (!title) { q('proj-title').focus(); return; }
  const existing = editingProjectId ? projects.find(p => p.id === editingProjectId) : null;
  const project = {
    id: editingProjectId || uid(),
    title,
    description: getEditorHtml('proj-desc'),
    url: q('proj-url').value.trim(),
    status: q('proj-status').value,
    deadline: q('proj-deadline').value || null,
    tags: q('proj-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    color: selectedProjColor,
    groupId: q('proj-group').value || null,
    coverImage: pendingCoverPath || existing?.coverImage || null,
    docs: existing?.docs || [],
    comments: existing?.comments || [],
    tasks: existing?.tasks || [],
    reminders: existing?.reminders || [],
    links: existing?.links || [],
    postits: existing?.postits || [],
    taskColumns: existing?.taskColumns,
    whiteboard: existing?.whiteboard,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects = await window.api.saveProject(project);
  scheduleSync();
  closeModal('modal-project');
  renderHome(); renderProjects();
  if (editingProjectId === currentProjectId) openProjectDetail(currentProjectId);
}

// ══ TASKS ═════════════════════════════════════════════════════════════
function openTaskModal(idx = null, colId = null) {
  editingTaskId = idx;
  if (colId) pendingTaskColId = colId;
  const p = proj();
  const task = idx !== null ? (p?.tasks || [])[idx] : null;
  if (task?.colId) pendingTaskColId = task.colId;
  else if (!colId) pendingTaskColId = 'col-todo';
  q('modal-task-title').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  q('task-title').value = task?.title || '';
  setEditorHtml('task-desc', task?.description || '');
  q('task-status').value = task?.status || 'todo';
  q('task-priority').value = task?.priority || 'medium';
  q('task-deadline').value = task?.deadline || '';
  openModal('modal-task');
}

async function saveTask() {
  const title = q('task-title').value.trim();
  if (!title) { q('task-title').focus(); return; }
  const p = proj();
  if (!p) return;
  p.tasks = p.tasks || [];
  const existingTask = editingTaskId !== null ? p.tasks[editingTaskId] : null;
  const task = {
    id: existingTask?.id || uid(),
    title,
    description: getEditorHtml('task-desc'),
    status: q('task-status').value,
    priority: q('task-priority').value,
    deadline: q('task-deadline').value || null,
    colId: existingTask?.colId || pendingTaskColId || 'col-todo',
    createdAt: existingTask?.createdAt || new Date().toISOString(),
  };
  if (editingTaskId !== null) p.tasks[editingTaskId] = task; else p.tasks.push(task);
  p.updatedAt = new Date().toISOString();
  projects = await window.api.saveProject(p);
  scheduleSync();
  if (task.deadline) await syncToGcal(`Tâche : ${task.title}`, task.description || '', task.deadline);
  closeModal('modal-task');
  renderTasks(p); renderHome(); renderProjects();
}

async function toggleTask(idx) {
  const p = proj(); if (!p) return;
  const t = p.tasks[idx];
  t.status = t.status === 'done' ? 'todo' : 'done';
  projects = await window.api.saveProject(p);
  renderTasks(p); renderHome(); renderProjects();
}

async function removeTask(idx) {
  const p = proj(); if (!p) return;
  p.tasks.splice(idx, 1);
  projects = await window.api.saveProject(p);
  renderTasks(p); renderHome(); renderProjects();
}

// ══ TASK COLUMNS ══════════════════════════════════════════════════════
function openColsModal() {
  selectedColColor = '#2563eb';
  qAll('#new-col-color-picker .color-opt').forEach(o => o.classList.toggle('selected', o.dataset.color === selectedColColor));
  q('new-col-name').value = '';
  renderColsModal();
  openModal('modal-task-cols');
}

function renderColsModal() {
  const p = proj(); if (!p) return;
  const cols = getTaskCols(p);
  const list = q('task-cols-list');
  if (!list) return;
  const defaultIds = new Set(['col-todo', 'col-inprog', 'col-done']);
  list.innerHTML = cols.map(col => {
    const count = (p.tasks || []).filter(t => (t.colId || 'col-todo') === col.id).length;
    const isDefault = defaultIds.has(col.id);
    return `<div class="col-manage-item">
      <span class="col-manage-dot" style="background:${col.color}"></span>
      <span class="col-manage-name">${escHtml(col.name)}</span>
      <span class="col-manage-count">${count} tâche${count !== 1 ? 's' : ''}</span>
      <button class="col-manage-del" data-col="${col.id}" title="${isDefault ? 'Colonne par défaut' : 'Supprimer'}" ${isDefault ? 'disabled' : ''}>✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.col-manage-del:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => deleteTaskCol(btn.dataset.col));
  });
}

async function saveTaskCol() {
  const name = q('new-col-name').value.trim();
  if (!name) { q('new-col-name').focus(); return; }
  const p = proj(); if (!p) return;
  if (!p.taskColumns?.length) p.taskColumns = [...DEFAULT_TASK_COLS];
  p.taskColumns.push({ id: uid(), name, color: selectedColColor });
  projects = await window.api.saveProject(p);
  q('new-col-name').value = '';
  renderColsModal();
  renderTasks(projects.find(pr => pr.id === currentProjectId));
}

async function deleteTaskCol(colId) {
  const p = proj(); if (!p) return;
  const cols = p.taskColumns?.length ? p.taskColumns : [...DEFAULT_TASK_COLS];
  const fallback = cols.find(c => c.id !== colId)?.id || 'col-todo';
  (p.tasks || []).forEach(t => { if ((t.colId || 'col-todo') === colId) t.colId = fallback; });
  p.taskColumns = cols.filter(c => c.id !== colId);
  projects = await window.api.saveProject(p);
  renderColsModal();
  renderTasks(projects.find(pr => pr.id === currentProjectId));
}

// ══ DOCS ══════════════════════════════════════════════════════════════
async function addFilesToProject() {
  const paths = await window.api.openFileDialog();
  const p = proj(); if (!p || !paths.length) return;
  await saveFileResources(paths, async (files, action) => {
    p.docs = p.docs || [];
    for (const fp of files) {
      let finalPath = fp;
      if (action !== 'link') {
        const result = await window.api.importFile(fp, action);
        if (result.ok) finalPath = result.path;
      }
      const name = fp.replace(/\\/g, '/').split('/').pop();
      p.docs.push({ title: name, type: 'fichier', path: finalPath, addedAt: new Date().toISOString() });
    }
    projects = await window.api.saveProject(p);
    renderDocs(p);
  });
}

async function addDoc() {
  const title = q('doc-title').value.trim();
  if (!title) { q('doc-title').focus(); return; }
  const p = proj(); if (!p) return;
  p.docs = p.docs || [];
  p.docs.push({ title, type: q('doc-type').value, content: q('doc-content').value.trim(), addedAt: new Date().toISOString() });
  q('doc-title').value = ''; q('doc-content').value = '';
  projects = await window.api.saveProject(p);
  closeModal('modal-doc'); renderDocs(p);
}

async function removeDoc(idx) {
  const p = proj(); if (!p) return;
  p.docs.splice(idx, 1);
  projects = await window.api.saveProject(p);
  renderDocs(p);
}

// ══ COMMENTS ═════════════════════════════════════════════════════════
async function addComment() {
  const text = getEditorHtml('comment-input');
  if (!stripHtml(text).trim()) { q('comment-input').focus(); return; }
  const p = proj(); if (!p) return;
  p.comments = p.comments || [];
  p.comments.push({ text, tag: selectedJournalTag, date: new Date().toISOString() });
  setEditorHtml('comment-input', '');
  projects = await window.api.saveProject(p);
  renderComments(p);
}

async function removeComment(idx) {
  const p = proj(); if (!p) return;
  p.comments.splice(idx, 1);
  projects = await window.api.saveProject(p);
  renderComments(p);
}

// ══ REMINDERS ════════════════════════════════════════════════════════
function openReminderModal() {
  q('rem-type').value = 'before';
  q('rem-days-before').value = '3';
  q('rem-date').value = '';
  q('rem-message').value = '';
  updateReminderFields();
  openModal('modal-reminder');
}

function updateReminderFields() {
  const type = q('rem-type').value;
  document.getElementById('rem-before-group').style.display = type === 'before' ? 'block' : 'none';
  document.getElementById('rem-date-group').style.display = type !== 'before' ? 'block' : 'none';
}

async function saveReminder() {
  const type = q('rem-type').value;
  const p = proj(); if (!p) return;
  const r = {
    id: uid(), type, enabled: true,
    message: q('rem-message').value.trim(),
    notifiedDates: [],
  };
  if (type === 'before') r.daysBefore = parseInt(q('rem-days-before').value) || 3;
  else r[type === 'once' ? 'date' : 'startDate'] = q('rem-date').value;
  p.reminders = p.reminders || [];
  p.reminders.push(r);
  projects = await window.api.saveProject(p);
  if (r.type === 'once' && r.date) await syncToGcal(`Relance : ${r.message || p.title || ''}`, p.title || '', r.date);
  if (r.type === 'weekly' && r.startDate) await syncToGcal(`Relance hebdo : ${r.message || p.title || ''}`, p.title || '', r.startDate);
  closeModal('modal-reminder');
  renderReminders(p);
}

async function toggleReminder(idx) {
  const p = proj(); if (!p) return;
  p.reminders[idx].enabled = !p.reminders[idx].enabled;
  projects = await window.api.saveProject(p);
  renderReminders(p);
}

async function removeReminder(idx) {
  const p = proj(); if (!p) return;
  p.reminders.splice(idx, 1);
  projects = await window.api.saveProject(p);
  renderReminders(p);
}

// ══ RESOURCES ════════════════════════════════════════════════════════
function renderResCats() {
  const list = q('res-cats-list');
  if (!list) return;
  const allCount = resources.length;
  const allCountEl = q('res-cat-count-all');
  if (allCountEl) allCountEl.textContent = allCount || '';
  list.innerHTML = resCats.map(cat => {
    const count = resources.filter(r => r.categoryId === cat.id).length;
    return `<button class="res-cat-item${currentResCat === cat.id ? ' active' : ''}" data-cat="${cat.id}">
      <span class="res-cat-dot" style="background:${cat.color || '#999'}"></span>
      <span>${escHtml(cat.name)}</span>
      <span class="res-cat-count">${count || ''}</span>
      <button class="res-cat-del" data-del="${cat.id}" title="Supprimer">×</button>
    </button>`;
  }).join('');
  // Update "Toutes" active state
  const allBtn = document.querySelector('.res-cat-item[data-cat="all"]');
  if (allBtn) allBtn.classList.toggle('active', currentResCat === 'all');
  // Bindings
  list.querySelectorAll('.res-cat-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.res-cat-del')) return;
      currentResCat = btn.dataset.cat;
      renderResCats();
      renderResources(q('res-search')?.value || '');
    });
  });
  list.querySelectorAll('.res-cat-del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteResCat(btn.dataset.del); });
  });
  const allBtnEl = document.querySelector('.res-cat-item[data-cat="all"]');
  if (allBtnEl) allBtnEl.onclick = () => { currentResCat = 'all'; renderResCats(); renderResources(q('res-search')?.value || ''); };
}

async function saveResCat() {
  const name = q('res-cat-name').value.trim();
  if (!name) { q('res-cat-name').focus(); return; }
  const cat = { id: uid(), name, color: selectedResCatColor, updatedAt: new Date().toISOString() };
  resCats = await window.api.saveResCat(cat);
  scheduleSync();
  closeModal('modal-res-cat');
  renderResCats();
}

async function deleteResCat(catId) {
  const cat = resCats.find(c => c.id === catId);
  if (cat) await archiveOnServer('rescat', cat);
  resCats = await window.api.deleteResCat(catId);
  scheduleSync();
  if (currentResCat === catId) currentResCat = 'all';
  renderResCats();
  renderResources(q('res-search')?.value || '');
}

async function assignResourceCat(catId) {
  if (!ctxMenuTarget || ctxMenuTarget.type !== 'resource') return;
  const r = { ...ctxMenuTarget.data, categoryId: catId || null };
  resources = await window.api.saveResource(r);
  closeModal('modal-assign-cat');
  renderResCats();
  renderResources(q('res-search')?.value || '');
}

function openAssignCatModal() {
  const list = q('assign-cat-list');
  list.innerHTML = `<button class="res-cat-item" data-cat="" style="border:1px solid var(--border);border-radius:var(--rsm)">
    <span class="res-cat-dot" style="background:var(--text3)"></span><span>Aucune</span>
  </button>` + resCats.map(cat => `
    <button class="res-cat-item" data-cat="${cat.id}" style="border:1px solid var(--border);border-radius:var(--rsm)">
      <span class="res-cat-dot" style="background:${cat.color}"></span><span>${escHtml(cat.name)}</span>
    </button>
  `).join('');
  list.querySelectorAll('.res-cat-item').forEach(btn => btn.addEventListener('click', () => assignResourceCat(btn.dataset.cat)));
  openModal('modal-assign-cat');
}

function renderResources(search = '') {
  const grid = q('resources-grid');
  let list = resources;
  if (currentResCat !== 'all') list = list.filter(r => r.categoryId === currentResCat);
  if (search) list = list.filter(r => (r.name || r.title || '').toLowerCase().includes(search.toLowerCase()) || (r.value || '').toLowerCase().includes(search.toLowerCase()));
  if (!list.length) { grid.innerHTML = '<p class="empty-state" style="grid-column:1/-1;padding:40px">Aucune ressource</p>'; return; }
  const catMap = Object.fromEntries(resCats.map(c => [c.id, c]));
  grid.innerHTML = list.map(r => {
    const cat = catMap[r.categoryId];
    return `<div class="resource-card" data-id="${r.id}">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="resource-icon ${r.type}">${r.type === 'url' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>' : fileEmoji(r.name || '')}</div>
        <div class="resource-info" style="min-width:0;flex:1">
          <strong title="${escHtml(r.name || r.title)}">${escHtml(r.name || r.title)}</strong>
          <span title="${escHtml(r.value || '')}">${escHtml(r.value || '')}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
        ${cat ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text3)"><span style="width:6px;height:6px;border-radius:50%;background:${cat.color};display:inline-block"></span>${escHtml(cat.name)}</span>` : ''}
        <span class="resource-tag ${r.type}" style="margin-left:auto">${r.type === 'url' ? 'URL' : 'Fichier'}</span>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.resource-card').forEach(card => {
    const r = resources.find(x => x.id === card.dataset.id);
    if (!r) return;
    card.addEventListener('click', () => {
      if (r.type === 'url') window.api.openUrl(r.value);
      else window.api.openPath(r.value);
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtxMenu(e, 'resource', r); });
  });
}

async function addFilesToResources() {
  const paths = await window.api.openFileDialog();
  if (paths.length) await saveFileResources(paths);
}

async function saveFileResources(paths, callback = null) {
  pendingImportPaths = paths;
  pendingImportCallback = callback;
  const names = paths.map(fp => fp.replace(/\\/g, '/').split('/').pop());
  const label = names.length === 1 ? `"${names[0]}"` : `${names.length} fichiers`;
  q('import-file-count').textContent = label;
  openModal('modal-import-file');
}

async function doImportFiles(action) {
  closeModal('modal-import-file');
  const files = [...pendingImportPaths];
  const cb = pendingImportCallback;
  pendingImportPaths = [];
  pendingImportCallback = null;
  if (cb) {
    await cb(files, action);
    return;
  }
  // Default: save to global resources
  for (const fp of files) {
    let finalPath = fp;
    if (action !== 'link') {
      const result = await window.api.importFile(fp, action);
      if (result.ok) finalPath = result.path;
    }
    const name = fp.replace(/\\/g, '/').split('/').pop();
    const res = { id: uid(), type: 'file', name, value: finalPath, addedAt: new Date().toISOString() };
    if (currentResCat !== 'all') res.categoryId = currentResCat;
    resources = await window.api.saveResource(res);
  }
  renderResCats();
  renderResources();
}

async function saveUrlResource() {
  const title = q('res-url-title').value.trim();
  const value = q('res-url-value').value.trim();
  if (!title || !value) return;
  const catId = q('res-category').value || (currentResCat !== 'all' ? currentResCat : null);
  resources = await window.api.saveResource({ id: uid(), type: 'url', name: title, value, categoryId: catId || null, addedAt: new Date().toISOString() });
  q('res-url-title').value = ''; q('res-url-value').value = '';
  closeModal('modal-url-res');
  renderResCats();
  renderResources();
}

// ══ NOTES ════════════════════════════════════════════════════════════
function renderNotes() {
  const grid = q('notes-grid');
  if (!notes.length) { grid.innerHTML = '<p class="empty-state" style="grid-column:1/-1;padding:40px">Aucune note. Créez-en une !</p>'; return; }
  grid.innerHTML = notes.map(n => `
    <div class="note-card" style="background:${n.color || '#fef9c3'}" data-id="${n.id}">
      ${n.title ? `<h3>${escHtml(n.title)}</h3>` : ''}
      <div class="note-body">${n.content || ''}</div>
      <div class="note-date">${formatDate(n.updatedAt || n.createdAt)}</div>
      <button class="note-del" data-id="${n.id}">✕</button>
    </div>
  `).join('');
  grid.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('note-del')) return;
      const n = notes.find(n => n.id === card.dataset.id);
      if (n) openNoteModal(n);
    });
  });
  grid.querySelectorAll('.note-del').forEach(el => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const note = notes.find(n => n.id === el.dataset.id);
    if (note) await archiveOnServer('note', note);
    notes = await window.api.deleteNote(el.dataset.id);
    scheduleSync();
    renderNotes(); renderHome();
  }));
}

function openNoteModal(note = null) {
  editingNoteId = note?.id || null;
  q('modal-note-title').textContent = note ? 'Modifier la note' : 'Nouvelle note';
  q('note-title').value = note?.title || '';
  setEditorHtml('note-content', note?.content || '');
  selectedNoteColor = note?.color || '#fef9c3';
  qAll('#note-color-picker .color-opt').forEach(el => el.classList.toggle('selected', el.dataset.color === selectedNoteColor));
  openModal('modal-note');
}

async function saveNote() {
  const content = getEditorHtml('note-content');
  if (!stripHtml(content)) { q('note-content').focus(); return; }
  const existing = editingNoteId ? notes.find(n => n.id === editingNoteId) : null;
  const note = {
    id: editingNoteId || uid(),
    title: q('note-title').value.trim(),
    content,
    color: selectedNoteColor,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  notes = await window.api.saveNote(note);
  scheduleSync();
  closeModal('modal-note');
  renderNotes(); renderHome();
}

// ══ POMODORO ═════════════════════════════════════════════════════════
function togglePomodoro() {
  q('pomodoro-widget').classList.toggle('hidden');
}

function pomFmt(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function pomUpdateUI() {
  const totalSecs = pomState.phase === 'work' ? POM_DURATIONS.work
    : (pomState.sessionCount > 0 && pomState.sessionCount % 4 === 0 ? POM_DURATIONS.longBreak : POM_DURATIONS.break);
  const CIRC = 326.73;
  const progress = pomSecondsLeft / totalSecs;
  q('pom-time').textContent = pomFmt(pomSecondsLeft);
  q('pom-ring-prog').style.strokeDashoffset = CIRC * (1 - progress);
  q('pom-ring-prog').classList.toggle('break-mode', pomState.phase !== 'work');
  q('pom-phase-label').textContent = pomState.phase === 'work' ? 'Travail' : 'Pause';
  q('pom-sessions').textContent = `🍅 × ${pomState.sessionCount}`;
  q('pom-start').textContent = pomState.running ? '⏸ Pause' : '▶ Démarrer';
  q('pom-start').classList.toggle('running', pomState.running);
  qAll('.pom-phase-btn').forEach(b => b.classList.toggle('active', b.dataset.phase === pomState.phase));
}

function pomToggleRunning() {
  if (pomState.running) {
    clearInterval(pomState.intervalId);
    pomState.running = false;
  } else {
    pomState.running = true;
    pomState.intervalId = setInterval(() => {
      pomSecondsLeft--;
      if (pomSecondsLeft <= 0) pomAdvancePhase();
      pomUpdateUI();
    }, 1000);
  }
  pomUpdateUI();
}

function pomAdvancePhase() {
  clearInterval(pomState.intervalId);
  pomState.running = false;
  if (pomState.phase === 'work') {
    pomState.sessionCount++;
    pomSetPhase('break');
    new Notification('🍅 Session terminée !', { body: `Pause méritée. Sessions : ${pomState.sessionCount}` });
  } else {
    pomSetPhase('work');
    new Notification('⏰ Pause terminée !', { body: 'Prêt pour une nouvelle session ?' });
  }
}

function pomSetPhase(phase) {
  clearInterval(pomState.intervalId);
  pomState.running = false;
  pomState.phase = phase;
  const isLongBreak = phase === 'break' && pomState.sessionCount > 0 && pomState.sessionCount % 4 === 0;
  pomSecondsLeft = phase === 'work' ? POM_DURATIONS.work : (isLongBreak ? POM_DURATIONS.longBreak : POM_DURATIONS.break);
  pomUpdateUI();
}

function pomReset() {
  clearInterval(pomState.intervalId);
  pomState.running = false;
  pomSecondsLeft = pomState.phase === 'work' ? POM_DURATIONS.work : POM_DURATIONS.break;
  pomUpdateUI();
}

function pomSkip() {
  clearInterval(pomState.intervalId);
  pomState.running = false;
  pomSecondsLeft = 0;
  pomAdvancePhase();
}

// ══ HELPERS ══════════════════════════════════════════════════════════
const q = (id) => document.getElementById(id);
const qAll = (sel) => document.querySelectorAll(sel);
const on = (id, ev, fn) => { const el = q(id); if (el) el.addEventListener(ev, fn); };
const proj = () => projects.find(p => p.id === currentProjectId);
const uid = () => crypto.randomUUID();

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function confirmAction(text, cb) {
  q('confirm-text').textContent = text;
  confirmCallback = cb;
  openModal('modal-confirm');
}

function setupColorPicker(id, onChange) {
  qAll(`#${id} .color-opt`).forEach(el => {
    el.addEventListener('click', () => {
      qAll(`#${id} .color-opt`).forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      onChange(el.dataset.color);
    });
  });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.ceil((d - now) / 86400000);
}

function deadlineClass(dateStr) {
  const d = daysUntil(dateStr);
  return d < 0 ? 'overdue' : d <= 3 ? 'soon' : 'ok';
}

function deadlineChip(dateStr) {
  const d = daysUntil(dateStr);
  const cls = d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'ok';
  return `<span class="proj-deadline-chip ${cls}">${formatDeadlineShort(dateStr)}</span>`;
}

function formatDeadlineShort(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return `<span style="color:var(--danger)">↑ ${Math.abs(d)}j retard</span>`;
  if (d === 0) return `<span style="color:var(--warn)">Aujourd'hui</span>`;
  if (d === 1) return `<span style="color:var(--warn)">Demain</span>`;
  if (d <= 7) return `<span style="color:var(--warn)">J-${d}</span>`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatDate2(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s) {
  const map = { 'a-traiter': 'À traiter', 'en-cours': 'En cours', 'termine': 'Terminé' };
  return map[s] || s;
}

function priorityLabel(p) {
  const map = { high: ['#ef4444','Haute'], medium: ['#f59e0b','Moy.'], low: ['#10b981','Basse'] };
  const [color, label] = map[p] || ['#94a3b8','—'];
  return `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block"></span>${label}</span>`;
}

function reminderTypeLabel(r) {
  if (r.type === 'before') return `${r.daysBefore} jour(s) avant l'échéance`;
  if (r.type === 'daily') return `Quotidien depuis ${r.startDate || '?'}`;
  return `Le ${r.date || '?'}`;
}

function docIcon(type) {
  const svgs = {
    lien: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>',
    fichier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  };
  return svgs[type] || svgs.fichier;
}

function fileEmoji(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isImg = ['png','jpg','jpeg','gif','webp','svg'].includes(ext);
  const isCode = ['js','ts','py','html','css','json'].includes(ext);
  if (isImg) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  if (isCode) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
  if (ext === 'pdf') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
}

function colorDot(color) {
  if (!color) return '';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;flex-shrink:0"></span>`;
}

function pathToFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

// ══ CONTEXT MENU ═════════════════════════════════════════════════════
function showCtxMenu(e, type, data) {
  ctxMenuTarget = { type, data };
  const menu = q('ctx-menu');
  const isResource = type === 'resource';
  const isGroup = type === 'group';
  const isProject = type === 'project';
  qAll('.ctx-resource-item').forEach(el => el.style.display = isResource ? '' : 'none');
  qAll('.ctx-group-item').forEach(el => el.style.display = isGroup ? '' : 'none');
  qAll('.ctx-proj-item').forEach(el => el.style.display = isProject ? '' : 'none');
  if (isResource) {
    q('ctx-open-folder').style.display = data.type === 'file' ? '' : 'none';
    q('ctx-rename').style.display = '';
  } else {
    q('ctx-open-folder').style.display = 'none';
    q('ctx-rename').style.display = 'none';
  }
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('open');
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) menu.style.left = (e.clientX - rect.width) + 'px';
    if (rect.bottom > window.innerHeight - 8) menu.style.top = (e.clientY - rect.height) + 'px';
  });
}

function hideCtxMenu() {
  q('ctx-menu').classList.remove('open');
  ctxMenuTarget = null;
}

async function doRename() {
  const newName = q('rename-input').value.trim();
  if (!newName || !renameTarget) return;
  resources = await window.api.renameResource(renameTarget.id, newName);
  renameTarget = null;
  closeModal('modal-rename');
  renderResources(q('res-search').value);
}

// ══ COVER IMAGE ═══════════════════════════════════════════════════════
async function pickCoverImage() {
  const p = await window.api.openImageDialog();
  if (!p) return;
  // Copy to ressources folder so the path remains valid
  const result = await window.api.importFile(p, 'copy');
  const finalPath = result.ok ? result.path : p;
  pendingCoverPath = finalPath;
  q('proj-cover-preview').src = pathToFileUrl(finalPath);
  q('proj-cover-preview').style.display = 'block';
  q('btn-clear-cover').style.display = 'inline-flex';
}

function clearCoverImage() {
  pendingCoverPath = null;
  q('proj-cover-preview').style.display = 'none';
  q('proj-cover-preview').src = '';
  q('btn-clear-cover').style.display = 'none';
}

// ══ GROUPS ════════════════════════════════════════════════════════════
// ══ WHITEBOARD ════════════════════════════════════════════════════════
let wbCanvas = null, wbCtx = null;
let wbTool = 'pen', wbColor = '#1e40af', wbSize = 3;
let wbIsDrawing = false, wbStartX = 0, wbStartY = 0, wbLastX = 0, wbLastY = 0;
let wbHistory = [], wbSnapshot = null;
let wbMemory = {}; // in-memory canvas data per project

function wbPos(e) {
  const r = wbCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function initWhiteboard() {
  wbCanvas = q('whiteboard-canvas');
  if (!wbCanvas) return;
  const wrap = q('whiteboard-wrap');
  const toolbar = q('whiteboard-toolbar');
  const w = wrap.clientWidth || 800;
  const h = Math.max((wrap.clientHeight || 500) - (toolbar?.offsetHeight || 48), 300);

  const prevId = wbCanvas.dataset.projectId;
  if (prevId === currentProjectId && wbCanvas.width === w) return; // already inited for this project

  wbCanvas.dataset.projectId = currentProjectId;
  wbCanvas.width = w;
  wbCanvas.height = h;
  wbCtx = wbCanvas.getContext('2d');
  wbCtx.fillStyle = '#fafafa';
  wbCtx.fillRect(0, 0, w, h);
  wbHistory = [];

  // Load from memory or saved data
  const src = wbMemory[currentProjectId] || projects.find(pr => pr.id === currentProjectId)?.whiteboardData;
  if (src) { const img = new Image(); img.onload = () => wbCtx.drawImage(img, 0, 0); img.src = src; }

  wbCanvas.onmousedown = (e) => {
    wbIsDrawing = true;
    const {x, y} = wbPos(e);
    wbStartX = x; wbStartY = y;
    wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
    if (wbHistory.length > 20) wbHistory.shift();
    wbSnapshot = wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height);
    if (wbTool === 'pen' || wbTool === 'eraser') { wbCtx.beginPath(); wbCtx.moveTo(x, y); }
    else if (wbTool === 'text') {
      wbIsDrawing = false;
      wbHistory.pop();
      wbLastX = x; wbLastY = y;
      wbShowTextOverlay(x, y);
    }
  };

  wbCanvas.onmousemove = (e) => {
    if (!wbIsDrawing) return;
    const {x, y} = wbPos(e);
    wbCtx.lineCap = 'round'; wbCtx.lineJoin = 'round';
    if (wbTool === 'pen') {
      wbCtx.strokeStyle = wbColor; wbCtx.lineWidth = wbSize;
      wbCtx.lineTo(x, y); wbCtx.stroke();
    } else if (wbTool === 'eraser') {
      wbCtx.strokeStyle = '#fafafa'; wbCtx.lineWidth = wbSize * 5;
      wbCtx.lineTo(x, y); wbCtx.stroke();
    } else if (wbSnapshot) {
      wbCtx.putImageData(wbSnapshot, 0, 0);
      wbCtx.beginPath(); wbCtx.strokeStyle = wbColor; wbCtx.lineWidth = wbSize;
      if (wbTool === 'line') { wbCtx.moveTo(wbStartX, wbStartY); wbCtx.lineTo(x, y); wbCtx.stroke(); }
      else if (wbTool === 'rect') { wbCtx.strokeRect(wbStartX, wbStartY, x - wbStartX, y - wbStartY); }
      else if (wbTool === 'ellipse') {
        const rx = Math.abs(x - wbStartX) / 2, ry = Math.abs(y - wbStartY) / 2;
        wbCtx.ellipse(wbStartX + (x - wbStartX) / 2, wbStartY + (y - wbStartY) / 2, rx || 1, ry || 1, 0, 0, Math.PI * 2);
        wbCtx.stroke();
      }
    }
  };

  wbCanvas.onmouseup = () => { wbIsDrawing = false; wbMemory[currentProjectId] = wbCanvas.toDataURL(); };
  wbCanvas.onmouseleave = () => { if (wbIsDrawing) { wbIsDrawing = false; wbMemory[currentProjectId] = wbCanvas.toDataURL(); } };

  // Drag & drop image onto canvas
  wbCanvas.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  wbCanvas.ondrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const {x, y} = wbPos(e);
      wbDrawImageSrc(ev.target.result, x, y);
    };
    reader.readAsDataURL(file);
  };
}

function wbShowTextOverlay(x, y) {
  const overlay = q('wb-text-overlay');
  const input = q('wb-text-input');
  if (!overlay || !input) return;
  // Position relative to the whiteboard-wrap; canvas is below toolbar
  const toolbar = q('whiteboard-toolbar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 48;
  overlay.style.left = Math.min(x, (wbCanvas.width - 260)) + 'px';
  overlay.style.top = (toolbarH + y - 18) + 'px';
  overlay.style.display = 'flex';
  input.value = '';
  input.focus();
}

function wbHideTextOverlay() {
  const overlay = q('wb-text-overlay');
  if (overlay) overlay.style.display = 'none';
}

function wbCommitText() {
  const input = q('wb-text-input');
  const txt = input ? input.value.trim() : '';
  wbHideTextOverlay();
  if (!txt || !wbCtx) return;
  wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
  wbCtx.font = `${Math.max(14, wbSize * 5)}px Inter, sans-serif`;
  wbCtx.fillStyle = wbColor;
  wbCtx.fillText(txt, wbLastX, wbLastY);
  wbMemory[currentProjectId] = wbCanvas.toDataURL();
}

function wbDrawImageSrc(src, x, y) {
  const img = new Image();
  img.onload = () => {
    wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
    if (wbHistory.length > 20) wbHistory.shift();
    // Scale image to max 400px width if too large
    let w = img.naturalWidth, h = img.naturalHeight;
    const maxW = Math.min(400, wbCanvas.width - x);
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    wbCtx.drawImage(img, x, y, w, h);
    wbMemory[currentProjectId] = wbCanvas.toDataURL();
  };
  img.src = src;
}

async function wbOpenImage() {
  const filePath = await window.api.openImageDialog();
  if (!filePath) return;
  const src = 'file:///' + filePath.replace(/\\/g, '/');
  wbDrawImageSrc(src, 20, 20);
}

function wbUndo() {
  if (!wbCtx || !wbHistory.length) return;
  wbCtx.putImageData(wbHistory.pop(), 0, 0);
  wbMemory[currentProjectId] = wbCanvas.toDataURL();
}

function wbClear() {
  if (!wbCtx) return;
  wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
  wbCtx.fillStyle = '#fafafa'; wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
  wbMemory[currentProjectId] = wbCanvas.toDataURL();
}

async function wbSave() {
  if (!wbCtx) return;
  const p = projects.find(pr => pr.id === currentProjectId);
  if (!p) return;
  p.whiteboardData = wbCanvas.toDataURL('image/png');
  projects = await window.api.saveProject(p);
  const btn = q('wb-save');
  if (btn) { btn.textContent = '✅ Sauvegardé'; setTimeout(() => { btn.textContent = '💾 Sauvegarder'; }, 1800); }
}

function renderGroupsBar() { /* no-op — groups are rendered as folders in renderProjects() */ }

function openGroupModal(g = null) {
  editingGroupId = g?.id || null;
  q('modal-group-title').textContent = g ? 'Modifier le groupe' : 'Nouveau groupe';
  q('group-name').value = g?.name || '';
  selectedGroupColor = g?.color || '#2563eb';
  qAll('#group-color-picker .color-opt').forEach(el => el.classList.toggle('selected', el.dataset.color === selectedGroupColor));
  openModal('modal-group');
}

async function saveGroup() {
  const name = q('group-name').value.trim();
  if (!name) { q('group-name').focus(); return; }
  const group = { id: editingGroupId || uid(), name, color: selectedGroupColor, updatedAt: new Date().toISOString() };
  groups = await window.api.saveGroup(group);
  scheduleSync();
  closeModal('modal-group');
  renderProjects();
}

// ══ GOOGLE CALENDAR ═══════════════════════════════════════════════════
async function syncToGcal(summary, description, dateStr) {
  try {
    const status = await window.api.googleStatus();
    if (!status.connected) return;
    const startDate = dateStr; // YYYY-MM-DD
    await window.api.googleCreateEvent({
      summary,
      description: description || '',
      start: { date: startDate },
      end: { date: startDate },
    });
  } catch (e) { /* silently ignore if calendar sync fails */ }
}

async function refreshGcalStatus() {
  const status = await window.api.googleStatus();
  const dot = q('gcal-status-dot');
  const text = q('gcal-status-text');
  const disconnectBtn = q('btn-gcal-disconnect');
  const saveBtn = q('btn-gcal-save');
  const credsForm = q('gcal-creds-form');
  if (!dot) return;
  if (status.connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'Connecté à Google Calendar';
    if (disconnectBtn) disconnectBtn.style.display = '';
    if (saveBtn) saveBtn.style.display = 'none';
    if (credsForm) credsForm.style.display = 'none';
  } else {
    dot.className = 'status-dot disconnected';
    text.textContent = status.hasCredentials ? 'Identifiants enregistrés — cliquez Connecter' : 'Non connecté';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = '';
    if (credsForm) credsForm.style.display = '';
    if (status.hasCredentials) saveBtn.textContent = 'Connecter';
    else saveBtn.textContent = 'Enregistrer & Connecter';
  }
}

async function saveGcalCreds() {
  const clientId = q('gcal-client-id').value.trim();
  const clientSecret = q('gcal-client-secret').value.trim();
  if (clientId && clientSecret) await window.api.googleSetCreds(clientId, clientSecret);
  const btn = q('btn-gcal-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion en cours...'; }
  const result = await window.api.googleConnect();
  if (btn) { btn.disabled = false; btn.textContent = 'Connecter'; }
  if (result?.ok) await refreshGcalStatus();
  else if (result?.error) { q('gcal-status-text').textContent = 'Erreur : ' + result.error; }
}

async function disconnectGcal() {
  await window.api.googleDisconnect();
  await refreshGcalStatus();
}

function openSettings() {
  // Load avatar preview
  const prev = q('settings-avatar-preview');
  const fbk  = q('settings-avatar-fallback');
  const clearBtn = q('btn-clear-avatar');
  if (prev) {
    if (appSettings.avatarPath) {
      prev.src = pathToFileUrl(appSettings.avatarPath);
      prev.style.display = 'block';
      if (fbk) fbk.style.display = 'none';
      if (clearBtn) clearBtn.style.display = '';
    } else {
      prev.style.display = 'none';
      prev.src = '';
      if (fbk) fbk.style.display = '';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
  // Load server settings
  const urlInput  = q('server-url');
  const nameInput = q('server-client-name');
  const keyInput  = q('server-api-key');
  if (urlInput)  urlInput.value  = appSettings.serverUrl  || '';
  if (nameInput) nameInput.value = appSettings.serverClientName || '';
  if (keyInput)  keyInput.value  = appSettings.serverApiKey || '';

  // Sync mode toggle
  const modeVal = appSettings.syncMode || (appSettings.serverApiKey ? 'sync' : 'standalone');
  const radios = document.querySelectorAll('input[name="sync-mode"]');
  radios.forEach(r => { r.checked = r.value === modeVal; });
  updateSyncModeUI(modeVal);
  if (!document.querySelector('input[name="sync-mode"]')._modeWired) {
    radios.forEach(r => {
      r._modeWired = true;
      r.addEventListener('change', async () => {
        appSettings.syncMode = r.value;
        await window.api.saveAppSettings(appSettings);
        updateSyncModeUI(r.value);
        if (r.value === 'sync') startAutoSync();
      });
    });
  }

  // Auto-save server fields on blur
  if (urlInput && !urlInput._serverBlur) {
    urlInput._serverBlur = true;
    urlInput.addEventListener('blur', async () => {
      appSettings.serverUrl = urlInput.value.trim().replace(/\/$/, '');
      await window.api.saveAppSettings(appSettings);
    });
  }
  if (nameInput && !nameInput._serverBlur) {
    nameInput._serverBlur = true;
    nameInput.addEventListener('blur', async () => {
      appSettings.serverClientName = nameInput.value.trim();
      await window.api.saveAppSettings(appSettings);
    });
  }
  if (appSettings.serverApiKey) {
    setServerStatus('disconnected', 'Non vérifié — cliquez Tester');
  } else {
    setServerStatus('disconnected', 'Non configuré');
  }
  setServerSyncStatus('');
  // Reset to first tab
  switchSettingsTab('general');
  refreshGcalStatus();
  openModal('modal-settings');
}

async function pickAvatar() {
  const p = await window.api.openImageDialog();
  if (!p) return;
  const result = await window.api.importFile(p, 'copy');
  const finalPath = result.ok ? result.path : p;
  appSettings.avatarPath = finalPath;
  await window.api.saveAppSettings(appSettings);
  // Update settings modal preview
  const prev = q('settings-avatar-preview');
  const fbk  = q('settings-avatar-fallback');
  if (prev) { prev.src = pathToFileUrl(finalPath); prev.style.display = 'block'; }
  if (fbk)  fbk.style.display = 'none';
  const clearBtn = q('btn-clear-avatar');
  if (clearBtn) clearBtn.style.display = '';
  // Refresh home avatar
  renderHomeV2();
}

async function clearAvatar() {
  appSettings.avatarPath = null;
  await window.api.saveAppSettings(appSettings);
  const prev = q('settings-avatar-preview');
  const fbk  = q('settings-avatar-fallback');
  if (prev) { prev.src = ''; prev.style.display = 'none'; }
  if (fbk)  fbk.style.display = '';
  const clearBtn = q('btn-clear-avatar');
  if (clearBtn) clearBtn.style.display = 'none';
  renderHomeV2();
}

// ══ SETTINGS TABS ══════════════════════════════════════════════════
function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.toggle('active', p.id === `stab-${tab}`));
}

// ══ SERVER SYNC ════════════════════════════════════════════════════
function setServerStatus(state, text) {
  const dot  = q('server-status-dot');
  const span = q('server-status-text');
  if (!dot || !span) return;
  dot.className = `status-dot ${state}`;
  span.textContent = text;
}

function setServerSyncStatus(text) {
  const el = q('server-sync-status');
  if (el) el.textContent = text;
}

function getServerBase() {
  return (appSettings.serverUrl || '').replace(/\/$/, '');
}

async function checkServerConnection() {
  const base = getServerBase();
  const apiKey = appSettings.serverApiKey || '';
  if (!base) { setServerStatus('disconnected', 'Entrez une URL de serveur'); return; }
  if (!apiKey) { setServerStatus('disconnected', 'Clé API manquante'); return; }
  setServerStatus('checking', 'Vérification…');
  const res = await window.api.serverRequest({
    url: `${base}/api/client/heartbeat`,
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
  });
  if (res.ok) {
    setServerStatus('connected', 'Connecté ✓');
  } else {
    setServerStatus('disconnected', `Échec — ${res.error || res.status || 'erreur inconnue'}`);
  }
}

async function registerServerClient() {
  const base = (q('server-url')?.value || '').trim().replace(/\/$/, '');
  const name = (q('server-client-name')?.value || '').trim() || 'TheDash PC';
  if (!base) { setServerSyncStatus('⚠ Entrez l\'URL du serveur d\'abord.'); return; }
  const btn = q('btn-server-register');
  if (btn) btn.disabled = true;
  setServerStatus('checking', 'Enregistrement…');
  setServerSyncStatus('');
  const res = await window.api.serverRequest({
    url: `${base}/api/client/register`,
    method: 'POST',
    body: { name, platform: `Windows / TheDash` },
  });
  if (btn) btn.disabled = false;
  if (res.ok && res.body?.apiKey) {
    appSettings.serverUrl = base;
    appSettings.serverApiKey = res.body.apiKey;
    appSettings.serverClientId = res.body.clientId;
    appSettings.serverClientName = name;
    await window.api.saveAppSettings(appSettings);
    const keyInput = q('server-api-key');
    if (keyInput) keyInput.value = res.body.apiKey;
    setServerStatus('connected', 'Client enregistré ✓');
    setServerSyncStatus(`Client ID : ${res.body.clientId}`);
  } else {
    setServerStatus('disconnected', 'Échec de l\'enregistrement');
    setServerSyncStatus(`Erreur : ${res.error || JSON.stringify(res.body) || res.status}`);
  }
}

// ══ SYNC SERVEUR ══════════════════════════════════════════════════════════════

let _syncTimer   = null;
let _isPulling   = false;
let _deletedIds  = new Set();

function isSyncEnabled() {
  if (appSettings.syncMode === 'standalone') return false;
  if (appSettings.syncMode === 'sync') return true;
  // legacy: if apiKey present, consider sync enabled
  return !!appSettings.serverApiKey;
}

function updateSyncModeUI(mode) {
  const lblStandalone = q('label-standalone');
  const lblSync       = q('label-sync');
  const fields        = q('server-fields');
  if (lblStandalone) lblStandalone.classList.toggle('active', mode === 'standalone');
  if (lblSync)       lblSync.classList.toggle('active',       mode === 'sync');
  if (fields)        fields.classList.toggle('disabled',      mode === 'standalone');
}

// ── Rich text editor helpers ──────────────────────────────────────────────────
function bindRichToolbars() {
  document.querySelectorAll('.rich-toolbar').forEach(toolbar => {
    if (toolbar._bound) return;
    toolbar._bound = true;
    toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        document.execCommand(btn.dataset.cmd, false, btn.dataset.val || null);
      });
    });
  });
}

function getEditorHtml(id) {
  const el = q(id);
  if (!el) return '';
  const html = el.innerHTML.trim();
  // If only contains empty div/br artifacts, return empty
  if (html === '<br>' || html === '<div><br></div>' || html === '') return '';
  return html;
}

function setEditorHtml(id, html) {
  const el = q(id);
  if (!el) return;
  el.innerHTML = html || '';
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || tmp.innerText || '').trim();
}

function _getDeletedIds() { return _deletedIds; }

function _persistDeletedIds() {
  appSettings.deletedItemIds = [..._deletedIds];
  window.api.saveAppSettings(appSettings);
}

async function archiveOnServer(type, item) {
  if (!isSyncEnabled()) return;
  const base   = getServerBase();
  const apiKey = appSettings.serverApiKey || '';
  if (!base || !apiKey || !item) return;
  _deletedIds.add(item.id);
  _persistDeletedIds();
  try {
    await window.api.serverRequest({
      url: `${base}/api/client/archive`,
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: { type, itemKey: item.id, data: JSON.stringify(item) },
    });
  } catch { /* fire-and-forget — deletion must not be blocked */ }
}

function scheduleSync() {
  if (!isSyncEnabled()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => syncToServer(true), 5000);
}

async function syncToServer(silent = false) {
  if (!isSyncEnabled()) return;
  const base   = getServerBase();
  const apiKey = appSettings.serverApiKey || '';
  if (!base || !apiKey) {
    if (!silent) setServerSyncStatus('⚠ Configurez et testez la connexion d\'abord.');
    return;
  }
  if (!silent) {
    const btn = q('btn-server-sync');
    if (btn) btn.disabled = true;
    setServerSyncStatus('Synchronisation en cours…');
  }

  // Build items — skip locally deleted items
  const items = [];
  projects.forEach(p  => { if (!_deletedIds.has(p.id))  items.push({ type: 'project',  key: p.id,  data: JSON.stringify(p)  }); });
  notes.forEach(n    => { if (!_deletedIds.has(n.id))  items.push({ type: 'note',     key: n.id,  data: JSON.stringify(n)  }); });
  resources.forEach(r => { if (!_deletedIds.has(r.id))  items.push({ type: 'resource', key: r.id,  data: JSON.stringify(r)  }); });
  groups.forEach(g   => { if (!_deletedIds.has(g.id))  items.push({ type: 'group',    key: g.id,  data: JSON.stringify(g)  }); });
  resCats.forEach(c  => { if (!_deletedIds.has(c.id))  items.push({ type: 'rescat',   key: c.id,  data: JSON.stringify(c)  }); });

  const res = await window.api.serverRequest({
    url: `${base}/api/client/sync`,
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: { items },
  });

  if (!silent) {
    const btn = q('btn-server-sync');
    if (btn) btn.disabled = false;
    if (res.ok) {
      const now = new Date().toLocaleTimeString('fr-FR');
      setServerSyncStatus(`✓ ${items.length} éléments synchronisés à ${now}`);
      setServerStatus('connected', 'Connecté ✓');
    } else {
      setServerSyncStatus(`✗ Erreur sync : ${res.error || res.status}`);
      setServerStatus('disconnected', 'Erreur de synchronisation');
    }
  }
}

async function pullFromServer() {
  if (_isPulling || !isSyncEnabled()) return;
  const base   = getServerBase();
  const apiKey = appSettings.serverApiKey || '';
  if (!base || !apiKey) return;
  _isPulling = true;
  try {
    const res = await window.api.serverRequest({
      url: `${base}/api/client/sync`,
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    });
    if (!res.ok || !Array.isArray(res.body?.items)) return;

    let changed = false;
    const updProjects = [...projects];
    const updNotes    = [...notes];
    const updResources = [...resources];
    const updGroups   = [...groups];
    const updResCats  = [...resCats];

    for (const item of res.body.items) {
      if (_deletedIds.has(item.item_key)) continue; // deleted locally — skip
      let data;
      try { data = JSON.parse(item.data); } catch { continue; }
      const serverTs = new Date(item.updated_at).getTime();

      switch (item.type) {
        case 'project': {
          const idx = updProjects.findIndex(p => p.id === item.item_key);
          const localTs = idx >= 0 ? new Date(updProjects[idx].updatedAt || updProjects[idx].createdAt || 0).getTime() : 0;
          if (idx < 0 || serverTs > localTs) { if (idx < 0) updProjects.push(data); else updProjects[idx] = data; changed = true; }
          break;
        }
        case 'note': {
          const idx = updNotes.findIndex(n => n.id === item.item_key);
          const localTs = idx >= 0 ? new Date(updNotes[idx].updatedAt || updNotes[idx].createdAt || 0).getTime() : 0;
          if (idx < 0 || serverTs > localTs) { if (idx < 0) updNotes.push(data); else updNotes[idx] = data; changed = true; }
          break;
        }
        case 'resource': {
          const idx = updResources.findIndex(r => r.id === item.item_key);
          const localTs = idx >= 0 ? new Date(updResources[idx].updatedAt || updResources[idx].addedAt || 0).getTime() : 0;
          if (idx < 0 || serverTs > localTs) { if (idx < 0) updResources.push(data); else updResources[idx] = data; changed = true; }
          break;
        }
        case 'group': {
          const idx = updGroups.findIndex(g => g.id === item.item_key);
          const localTs = idx >= 0 ? new Date(updGroups[idx].updatedAt || 0).getTime() : 0;
          if (idx < 0 || serverTs > localTs) { if (idx < 0) updGroups.push(data); else updGroups[idx] = data; changed = true; }
          break;
        }
        case 'rescat': {
          const idx = updResCats.findIndex(c => c.id === item.item_key);
          const localTs = idx >= 0 ? new Date(updResCats[idx].updatedAt || 0).getTime() : 0;
          if (idx < 0 || serverTs > localTs) { if (idx < 0) updResCats.push(data); else updResCats[idx] = data; changed = true; }
          break;
        }
      }
    }

    if (changed) {
      await window.api.bulkSaveAll({
        projects: updProjects, notes: updNotes, resources: updResources,
        groups: updGroups, resCats: updResCats,
      });
      projects   = updProjects;
      notes      = updNotes;
      resources  = updResources;
      groups     = updGroups;
      resCats    = updResCats;
      renderHome(); renderProjects(); renderNotes();
      renderResCats(); renderResources(q('res-search')?.value || '');
    }
  } finally {
    _isPulling = false;
  }
}

function startAutoSync() {
  if (!isSyncEnabled()) return;
  // Restore deleted IDs from persisted settings
  _deletedIds = new Set(appSettings.deletedItemIds || []);
  // Pull immediately on start then every 30s
  pullFromServer();
  setInterval(pullFromServer, 30000);
}

init();


