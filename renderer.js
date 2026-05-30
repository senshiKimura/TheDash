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
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSubscriptions = [];
let calIcsEvents = []; // { date, label, color, subId }

// ── Tab system ──────────────────────────────────────────────────────────
let openTabs = [{ id: 'main', type: 'main', label: 'Accueil' }];
let activeTabId = 'main';
let _lastMainPage = 'home-v2';

// ── Focus mode ───────────────────────────────────────────────────────────
let focusDuration = 25; // minutes, customizable
let focusData = { projectId: null, taskIdx: null, secs: focusDuration * 60, running: false, timerId: null };

// ── Weekly review ────────────────────────────────────────────────────────
let weeklyReviews = [], currentWeeklyReview = null, weeklyRating = 3;

// Pomodoro state
let pomState = { phase: 'work', running: false, sessionCount: 0, intervalId: null };
let POM_DURATIONS = { work: 25 * 60, break: 5 * 60, longBreak: 15 * 60 };
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

// ══ TAB SYSTEM ════════════════════════════════════════════════════════
function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const tab of openTabs) {
    const el = document.createElement('div');
    el.className = 'app-tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;
    el.innerHTML = `<span class="app-tab-label">${tab.label}</span>` +
      (tab.id !== 'main' ? `<span class="app-tab-close" data-tab-id="${tab.id}">✕</span>` : '');
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('app-tab-close')) {
        closeTab(e.target.dataset.tabId);
      } else {
        switchTab(tab.id);
      }
    });
    bar.appendChild(el);
  }
}

function openProjectInTab(projectId) {
  const existing = openTabs.find(t => t.type === 'project' && t.projectId === projectId);
  if (existing) { switchTab(existing.id); return; }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const tabId = 'proj-' + projectId;
  openTabs.push({ id: tabId, type: 'project', projectId, label: p.title });
  activeTabId = tabId;
  renderTabBar();
  openProjectDetail(p.id);
}

function switchTab(tabId) {
  activeTabId = tabId;
  renderTabBar();
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab) return;
  if (tab.type === 'main') {
    showPage(_lastMainPage);
  } else if (tab.type === 'project') {
    openProjectDetail(tab.projectId);
  }
}

function closeTab(tabId) {
  const idx = openTabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  openTabs.splice(idx, 1);
  if (activeTabId === tabId) {
    activeTabId = openTabs[Math.max(0, idx - 1)]?.id || 'main';
    const next = openTabs.find(t => t.id === activeTabId);
    if (next?.type === 'main') showPage(_lastMainPage);
    else if (next?.type === 'project') openProjectDetail(next.projectId);
  }
  renderTabBar();
}

// ══ INIT ════════════════════════════════════════════════════════════
async function init() {
  [projects, resources, notes, groups, resCats] = await Promise.all([
    window.api.getProjects(), window.api.getResources(), window.api.getNotes(), window.api.getGroups(), window.api.getResCats()
  ]);
  appSettings = await window.api.getAppSettings();

  // Apply saved theme (with backward compat for old darkMode bool)
  applyTheme(appSettings.themeMode || (appSettings.darkMode ? 'dark' : 'light'), appSettings.customTheme);

  // Apply saved timer durations
  if (appSettings.pomWork)      POM_DURATIONS.work      = appSettings.pomWork * 60;
  if (appSettings.pomBreak)     POM_DURATIONS.break     = appSettings.pomBreak * 60;
  if (appSettings.pomLongBreak) POM_DURATIONS.longBreak = appSettings.pomLongBreak * 60;
  pomSecondsLeft = POM_DURATIONS.work;
  if (appSettings.focusDuration) focusDuration = appSettings.focusDuration;
  if (q('focus-dur-val')) q('focus-dur-val').textContent = focusDuration;
  if (q('pom-set-work'))      q('pom-set-work').value      = appSettings.pomWork      || 25;
  if (q('pom-set-break'))     q('pom-set-break').value     = appSettings.pomBreak     || 5;
  if (q('pom-set-longbreak')) q('pom-set-longbreak').value = appSettings.pomLongBreak || 15;

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
  initVeille();

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

  // Calendrier nav
  on('cal-prev', 'click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
  on('cal-next', 'click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
  on('btn-cal-subs', 'click', openCalSubsModal);
  on('modal-cal-subs-close', 'click', closeCalSubsModal);
  on('modal-cal-subs-cancel', 'click', closeCalSubsModal);
  document.getElementById('modal-cal-subs')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeCalSubsModal(); });
  on('btn-cal-sub-add', 'click', addCalSubscription);

  // Onglet projet
  on('ctx-window-proj', 'click', () => {
    if (ctxMenuTarget?.type === 'project') openProjectInTab(ctxMenuTarget.data.id);
    hideCtxMenu();
  });

  // Mode Focus
  on('focus-esc', 'click', closeFocusMode);
  on('focus-pom-toggle', 'click', focusPomToggle);
  on('focus-pom-reset', 'click', focusPomReset);
  on('focus-done-btn', 'click', focusDone);
  on('focus-dur-minus', 'click', () => {
    if (focusData.running) return;
    focusDuration = Math.max(1, focusDuration - 5);
    focusData.secs = focusDuration * 60;
    if (q('focus-dur-val')) q('focus-dur-val').textContent = focusDuration;
    _focusUpdateTimer();
    appSettings.focusDuration = focusDuration;
    window.api.saveAppSettings(appSettings);
  });
  on('focus-dur-plus', 'click', () => {
    if (focusData.running) return;
    focusDuration = Math.min(120, focusDuration + 5);
    focusData.secs = focusDuration * 60;
    if (q('focus-dur-val')) q('focus-dur-val').textContent = focusDuration;
    _focusUpdateTimer();
    appSettings.focusDuration = focusDuration;
    window.api.saveAppSettings(appSettings);
  });

  // Revue hebdo
  on('btn-save-weekly', 'click', doSaveWeeklyReview);

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
  on('pom-settings-btn', 'click', () => {
    q('pom-settings-panel')?.classList.toggle('hidden');
  });
  on('pom-set-save', 'click', savePomSettings);

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
    const curMode = appSettings.themeMode || (appSettings.darkMode ? 'dark' : 'light');
    const newMode = curMode === 'dark' ? 'light' : 'dark';
    appSettings.themeMode = newMode;
    appSettings.darkMode = (newMode === 'dark');
    applyTheme(newMode);
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
  // Theme preset buttons
  qAll('.theme-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.theme;
      if (mode === 'custom') {
        const sec = q('custom-theme-section');
        if (sec) sec.style.display = '';
        qAll('.theme-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === 'custom'));
        return;
      }
      appSettings.themeMode = mode;
      appSettings.darkMode = (mode === 'dark');
      applyTheme(mode, appSettings.customTheme);
      window.api.saveAppSettings(appSettings);
      renderThemePresets();
    });
  });
  on('btn-apply-custom-theme', 'click', () => {
    const bg = q('theme-color-bg')?.value || '#f5f7ff';
    const text = q('theme-color-text')?.value || '#0f172a';
    const accent = q('theme-color-accent')?.value || '#2563eb';
    appSettings.customTheme = { bg, text, accent };
    appSettings.themeMode = 'custom';
    appSettings.darkMode = false;
    applyTheme('custom', { bg, text, accent });
    window.api.saveAppSettings(appSettings);
    renderThemePresets();
  });
  // Live hex label update for color pickers
  ['theme-color-bg','theme-color-text','theme-color-accent'].forEach(id => {
    const el = q(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const val = q(id + '-val');
      if (val) val.textContent = el.value;
      const preview = q('theme-mini-custom-preview');
      if (preview && id === 'theme-color-bg') preview.style.background = el.value;
    });
  });
  // Server
  on('btn-server-check', 'click', checkServerConnection);
  on('btn-server-register', 'click', registerServerClient);
  on('btn-server-sync', 'click', syncToServer);
  // Updater
  on('btn-check-updates', 'click', checkForUpdates);
  on('btn-apply-update', 'click', applyUpdate);
  if (window.api.onUpdateProgress) {
    window.api.onUpdateProgress((msg) => {
      const log = q('update-progress-log');
      if (log) { log.textContent += msg; log.scrollTop = log.scrollHeight; }
    });
  }
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCtxMenu(); closeFocusMode(); } });
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

  renderTabBar();
}

// ══ CLOCK & GREETING ══
const THEME_BG = { light: '#f5f7ff', dark: '#080e1c', hacker: '#020c14' };
const _CUSTOM_VARS = ['--bg','--bg2','--bg3','--bg4','--card','--border','--border2','--accent','--accent2','--accent-bg','--accent-glow','--text','--text2','--text3'];

function _clearCustomVars() { _CUSTOM_VARS.forEach(v => document.body.style.removeProperty(v)); }

function _hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function _hexAlpha(hex, a) { const [r,g,b] = _hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function _hexToHsl(hex) {
  let [r,g,b] = _hexToRgb(hex).map(x => x/255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b); let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; } else {
    const d = max-min; s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) { case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; case b: h=(r-g)/d+4; break; }
    h /= 6;
  }
  return [h*360, s*100, l*100];
}
function _hslToHex(h, s, l) {
  h/=360; s/=100; l/=100;
  const hue2rgb = (p,q,t) => { if(t<0)t++; if(t>1)t--; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
  let r,g,b;
  if (s === 0) { r=g=b=l; } else { const q2=l<0.5?l*(1+s):l+s-l*s,p=2*l-q2; r=hue2rgb(p,q2,h+1/3); g=hue2rgb(p,q2,h); b=hue2rgb(p,q2,h-1/3); }
  return '#'+[r,g,b].map(x=>Math.round(Math.max(0,Math.min(255,x*255))).toString(16).padStart(2,'0')).join('');
}
function _applyCustomThemeVars({ bg='#f5f7ff', text='#0f172a', accent='#2563eb' }={}) {
  const [bH,bS,bL]=_hexToHsl(bg); const dark=bL<50;
  const bg2=_hslToHex(bH,bS,dark?Math.min(bL+4,100):Math.min(bL+6,100));
  const bg3=_hslToHex(bH,bS,dark?Math.min(bL+8,100):Math.max(bL-4,0));
  const bg4=_hslToHex(bH,bS,dark?Math.min(bL+13,100):Math.max(bL-8,0));
  const [tH,tS,tL]=_hexToHsl(text);
  const text2=_hslToHex(tH,tS,dark?Math.max(tL-25,0):Math.min(tL+30,100));
  const text3=_hslToHex(tH,tS,dark?Math.max(tL-45,0):Math.min(tL+50,100));
  const [aH,aS,aL]=_hexToHsl(accent); const accent2=_hslToHex(aH,aS,Math.min(aL+12,100));
  const vars={'--bg':bg,'--bg2':bg2,'--bg3':bg3,'--bg4':bg4,'--card':bg2,'--border':_hexAlpha(accent,.18),'--border2':_hexAlpha(accent,.30),'--accent':accent,'--accent2':accent2,'--accent-bg':_hexAlpha(accent,.10),'--accent-glow':_hexAlpha(accent,.22),'--text':text,'--text2':text2,'--text3':text3};
  Object.entries(vars).forEach(([k,v]) => document.body.style.setProperty(k,v));
}

function applyTheme(mode, customColors) {
  document.body.classList.remove('dark','hacker');
  _clearCustomVars();
  if (mode === 'dark')   document.body.classList.add('dark');
  else if (mode === 'hacker') document.body.classList.add('hacker');
  else if (mode === 'custom' && customColors) _applyCustomThemeVars(customColors);
  // Update sidebar icon/label
  const isDark = mode === 'dark' || mode === 'hacker';
  const icon = document.getElementById('dark-mode-icon');
  const label = document.getElementById('dark-mode-label');
  if (isDark) {
    if (icon) icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    if (label) label.textContent = 'Mode clair';
  } else {
    if (icon) icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>';
    if (label) label.textContent = 'Mode sombre';
  }
  // Update window background for faster next startup
  const bgColor = mode === 'custom' ? (customColors?.bg || '#f5f7ff') : (THEME_BG[mode] || '#f5f7ff');
  if (window.api.setWindowBackground) window.api.setWindowBackground(bgColor);
}

function applyDarkMode(isDark) { applyTheme(isDark ? 'dark' : 'light'); }

function renderThemePresets() {
  const mode = appSettings.themeMode || (appSettings.darkMode ? 'dark' : 'light');
  qAll('.theme-preset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === mode));
  const sec = q('custom-theme-section');
  if (sec) sec.style.display = mode === 'custom' ? '' : 'none';
  const ct = appSettings.customTheme || {};
  const bgEl = q('theme-color-bg'), textEl = q('theme-color-text'), accentEl = q('theme-color-accent');
  if (bgEl) { bgEl.value = ct.bg || '#f5f7ff'; const v=q('theme-color-bg-val'); if(v) v.textContent = bgEl.value; }
  if (textEl) { textEl.value = ct.text || '#0f172a'; const v=q('theme-color-text-val'); if(v) v.textContent = textEl.value; }
  if (accentEl) { accentEl.value = ct.accent || '#2563eb'; const v=q('theme-color-accent-val'); if(v) v.textContent = accentEl.value; }
  const preview = q('theme-mini-custom-preview');
  if (preview) preview.style.background = ct.bg || 'var(--bg3)';
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
  if (name === 'calendar') { loadCalIcsEvents().then(renderCalendar); }
  if (name === 'weekly-review') renderWeeklyReview();
}

function navTo(page) {
  _lastMainPage = page;
  activeTabId = 'main';
  qAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-page="${page}"]`);
  if (btn) btn.classList.add('active');
  showPage(page);
  renderTabBar();
}

// ══ HOME (V1 supprimé — stub pour compatibilité appels internes) ═══════════
function renderHome() { renderHomeV2(); }

// ══ CALENDRIER ════════════════════════════════════════════════════════
function getCalendarEvents(year, month) {
  const events = [];
  for (const p of projects) {
    if (p.deadline) {
      const d = new Date(p.deadline + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === month) {
        events.push({ date: p.deadline, type: 'deadline', label: p.title, color: p.color || '#ef4444', projectId: p.id });
      }
    }
    for (const r of (p.reminders || [])) {
      if (r.type === 'once' && r.date && r.enabled) {
        const d = new Date(r.date + 'T00:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ date: r.date, type: 'reminder', label: r.message || p.title, color: '#f59e0b', projectId: p.id });
        }
      }
    }
    for (const task of (p.tasks || [])) {
      if (task.deadline && task.status !== 'done') {
        const d = new Date(task.deadline + 'T00:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ date: task.deadline, type: 'task', label: task.title, color: '#8b5cf6', projectId: p.id });
        }
      }
    }
  }
  // iCal subscription events
  for (const ev of calIcsEvents) {
    const d = new Date(ev.date + 'T00:00:00');
    if (d.getFullYear() === year && d.getMonth() === month) {
      events.push({ date: ev.date, type: 'ical', label: ev.label, color: ev.color });
    }
  }
  return events;
}

// ── iCal subscriptions UI ─────────────────────────────────────────────────

function openCalSubsModal() {
  renderCalSubsList();
  document.getElementById('modal-cal-subs').classList.add('open');
}

function closeCalSubsModal() {
  document.getElementById('modal-cal-subs').classList.remove('open');
}

function renderCalSubsList() {
  const el = document.getElementById('cal-subs-list');
  if (!el) return;
  if (!calSubscriptions.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text3);margin:0">Aucun abonnement — ajoutez votre premier calendrier ci-dessous.</p>';
    return;
  }
  el.innerHTML = calSubscriptions.map(sub => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg3);margin-bottom:8px">
      <span style="width:12px;height:12px;border-radius:50%;background:${sub.color};flex-shrink:0"></span>
      <span style="flex:1;font-size:13px;font-weight:600;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(sub.name)}</span>
      <span style="font-size:11px;color:var(--text3);white-space:nowrap" id="cal-sub-status-${sub.id}"></span>
      <button class="btn-icon-round" data-del-sub="${sub.id}" title="Supprimer" style="width:26px;height:26px;font-size:14px;color:#ef4444;border-color:#ef444440">✕</button>
    </div>`).join('');
  el.querySelectorAll('[data-del-sub]').forEach(btn => {
    btn.addEventListener('click', async () => {
      calSubscriptions = calSubscriptions.filter(s => s.id !== btn.dataset.delSub);
      await window.api.calSaveSubscriptions(calSubscriptions);
      await loadCalIcsEvents();
      renderCalendar();
      renderCalSubsList();
    });
  });
}

async function addCalSubscription() {
  const name = document.getElementById('cal-sub-name').value.trim();
  const url  = document.getElementById('cal-sub-url').value.trim();
  const secret = document.getElementById('cal-sub-secret').value;
  const color = document.getElementById('cal-sub-color').value;
  const errEl = document.getElementById('cal-sub-error');
  const btn = document.getElementById('btn-cal-sub-add');

  errEl.style.display = 'none';
  if (!url) { errEl.textContent = 'L\'URL est obligatoire.'; errEl.style.display = ''; return; }
  if (!name) { errEl.textContent = 'Le nom est obligatoire.'; errEl.style.display = ''; return; }

  btn.disabled = true;
  btn.textContent = 'Vérification…';

  const res = await window.api.calFetchIcs({ url, secret });
  btn.disabled = false;
  btn.textContent = 'Ajouter';

  if (!res.ok) {
    errEl.textContent = `Impossible de charger le calendrier : ${res.error}`;
    errEl.style.display = '';
    return;
  }

  const sub = { id: Date.now().toString(), name, url, secret, color };
  calSubscriptions.push(sub);
  await window.api.calSaveSubscriptions(calSubscriptions);

  // Append events to cache
  for (const ev of res.events) {
    calIcsEvents.push({ date: ev.date, label: ev.label, color, subId: sub.id });
  }

  // Reset form
  document.getElementById('cal-sub-name').value = '';
  document.getElementById('cal-sub-url').value = '';
  document.getElementById('cal-sub-secret').value = '';
  document.getElementById('cal-sub-color').value = '#2563eb';

  // Update legend
  const legendEl = document.getElementById('cal-ics-legend');
  if (legendEl) {
    legendEl.innerHTML = calSubscriptions.map(s =>
      `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${s.color}"></span>${escHtml(s.name)}</span>`
    ).join('');
  }

  renderCalSubsList();
  renderCalendar();
}

async function loadCalIcsEvents() {
  calSubscriptions = await window.api.calGetSubscriptions();
  calIcsEvents = [];
  await Promise.all(calSubscriptions.map(async sub => {
    const res = await window.api.calFetchIcs({ url: sub.url, secret: sub.secret || '' });
    if (res.ok) {
      for (const ev of res.events) {
        calIcsEvents.push({ date: ev.date, label: ev.label, color: sub.color || '#2563eb', subId: sub.id });
      }
    }
  }));
  // Update legend dots for subscriptions
  const legendEl = document.getElementById('cal-ics-legend');
  if (legendEl) {
    legendEl.innerHTML = calSubscriptions.map(s =>
      `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${s.color}"></span>${escHtml(s.name)}</span>`
    ).join('');
  }
}

function renderCalendar() {
  const grid = q('cal-grid');
  const label = q('cal-month-label');
  if (!grid) return;
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const startPad = (firstDay.getDay() + 6) % 7; // Monday-first
  if (label) label.textContent = firstDay.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const events = getCalendarEvents(calYear, calMonth);
  const byDate = {};
  for (const e of events) { byDate[e.date] = byDate[e.date] || []; byDate[e.date].push(e); }

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  let html = dayNames.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  for (let i = 0; i < startPad; i++) html += '<div class="cal-cell cal-cell-other"></div>';
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === today;
    const dayEvents = byDate[dateStr] || [];
    html += `<div class="cal-cell${isToday ? ' cal-today' : ''}">
      <div class="cal-day-num${isToday ? ' cal-today-num' : ''}">${d}</div>
      ${dayEvents.slice(0, 3).map(e =>
        `<div class="cal-event" style="background:${e.color}22;border-left:3px solid ${e.color}" data-pid="${escHtml(e.projectId)}" title="${escHtml(e.label)}">${escHtml(e.label.slice(0, 22))}</div>`
      ).join('')}
      ${dayEvents.length > 3 ? `<div class="cal-event-more">+${dayEvents.length - 3} autre${dayEvents.length - 3 > 1 ? 's' : ''}</div>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.cal-event[data-pid]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); openProjectDetail(el.dataset.pid); });
  });
}

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

  // Recent veille articles
  const agendaEl = q('v2-agenda-list');
  if (agendaEl) {
    if (!veilleArticles.length) {
      agendaEl.innerHTML = '<div class="v2-info-empty">Aucun article — configurez des flux RSS dans Veille</div>';
    } else {
      const recent = [...veilleArticles]
        .filter(a => !a.read)
        .sort((a, b) => new Date(b.pubDate || b.fetchedAt || 0) - new Date(a.pubDate || a.fetchedAt || 0))
        .slice(0, 6);
      agendaEl.innerHTML = recent.map(art => {
        const cat = veilleCategories.find(c => c.id === art.categoryId);
        const dotStyle = cat ? `background:${cat.color}` : 'background:var(--text3)';
        return `<div class="v2-agenda-item v2-veille-recent${art.read ? ' v2-veille-read' : ''}"
                  data-art-catid="${art.categoryId || 'all'}" title="${escHtml(art.feedName || '')}">
          <div class="v2-agenda-dot" style="${dotStyle}"></div>
          <div class="v2-agenda-text v2-veille-title">${escHtml(art.title)}</div>
        </div>`;
      }).join('');
      agendaEl.querySelectorAll('[data-art-catid]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          veilleActiveCat = el.dataset.artCatid;
          veillePage = 0;
          navTo('veille');
          renderVeilleCatsBar();
          renderVeilleFeed();
        });
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
        <div class="v2-note-chip" data-note-id="${n.id}" style="background:${n.color || '#fef9c3'};cursor:pointer" title="Cliquer pour modifier">
          <div class="v2-note-title">${escHtml(n.title || 'Note')}</div>
          <div class="v2-note-body">${escHtml((n.content || '').replace(/<[^>]*>/g, '').slice(0, 80))}${((n.content || '').replace(/<[^>]*>/g, '').length) > 80 ? '…' : ''}</div>
        </div>`).join('');
      notesEl.querySelectorAll('[data-note-id]').forEach(chip => {
        chip.addEventListener('click', () => {
          const note = notes.find(n => n.id === chip.dataset.noteId);
          if (note) openNoteModal(note);
        });
      });
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
  board.querySelectorAll('.task-focus-btn').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); openFocusMode(currentProjectId, parseInt(el.dataset.idx));
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
        <button class="task-focus-btn" data-idx="${idx}" title="Mode focus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></button>
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

// ══ MODE FOCUS ════════════════════════════════════════════════════════
function openFocusMode(projectId, taskIdx) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const task = (p.tasks || [])[taskIdx];
  if (!task) return;
  if (focusData.timerId) clearInterval(focusData.timerId);
  focusData = { projectId, taskIdx, secs: focusDuration * 60, running: false, timerId: null };
  q('focus-proj-name').textContent = p.title;
  q('focus-task-title').textContent = task.title;
  q('focus-task-desc').textContent = task.description ? stripHtml(task.description) : '';
  const tasks = p.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  q('focus-progress-info').textContent = `${done} / ${tasks.length} tâches terminées dans ce projet`;
  q('focus-pom-toggle').textContent = '▶ Démarrer';
  _focusUpdateTimer();
  q('focus-overlay').classList.remove('hidden');
}

function closeFocusMode() {
  if (focusData.timerId) clearInterval(focusData.timerId);
  focusData = { projectId: null, taskIdx: null, secs: focusDuration * 60, running: false, timerId: null };
  q('focus-overlay').classList.add('hidden');
  // Unlock duration picker
  q('focus-dur-row')?.classList.remove('locked');
}

function _focusUpdateTimer() {
  const m = String(Math.floor(focusData.secs / 60)).padStart(2, '0');
  const s = String(focusData.secs % 60).padStart(2, '0');
  const el = q('focus-timer-display');
  if (el) el.textContent = `${m}:${s}`;
}

function focusPomToggle() {
  const btn = q('focus-pom-toggle');
  if (focusData.running) {
    clearInterval(focusData.timerId);
    focusData.running = false;
    if (btn) btn.textContent = '▶ Reprendre';
  } else {
    if (focusData.secs <= 0) focusData.secs = focusDuration * 60;
    focusData.running = true;
    q('focus-dur-row')?.classList.add('locked');
    if (btn) btn.textContent = '⏸ Pause';
    focusData.timerId = setInterval(() => {
      focusData.secs--;
      _focusUpdateTimer();
      if (focusData.secs <= 0) {
        clearInterval(focusData.timerId);
        focusData.running = false;
        if (btn) btn.textContent = '▶ Recommencer';
        new Notification('TheDash — Focus', { body: `⏰ Session terminée : ${q('focus-task-title')?.textContent}` });
      }
    }, 1000);
  }
}

function focusPomReset() {
  if (focusData.timerId) clearInterval(focusData.timerId);
  focusData.running = false;
  focusData.secs = focusDuration * 60;
  const btn = q('focus-pom-toggle');
  if (btn) btn.textContent = '▶ Démarrer';
  q('focus-dur-row')?.classList.remove('locked');
  _focusUpdateTimer();
}

async function focusDone() {
  const { projectId, taskIdx } = focusData;
  closeFocusMode();
  if (projectId === null || taskIdx === null) return;
  const p = projects.find(x => x.id === projectId);
  if (!p || !p.tasks?.[taskIdx]) return;
  p.tasks[taskIdx].status = 'done';
  p.tasks[taskIdx].colId = 'col-done';
  projects = await window.api.saveProject(p);
  scheduleSync();
  if (currentProjectId === projectId) renderTasks(p);
  renderHome(); renderProjects();
}

// ══ REVUE HEBDOMADAIRE ════════════════════════════════════════════════
function _weekId() {
  const d = new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((d - startOfYear) / 86400000);
  const week = Math.ceil((dayOfYear + startOfYear.getDay()) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function _weekDateRange() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `${fmt(monday)} – ${fmt(sunday)} ${now.getFullYear()}`;
}

async function renderWeeklyReview() {
  weeklyReviews = await window.api.getWeeklyReviews();
  const wid = _weekId();
  const existing = weeklyReviews.find(r => r.id === wid);
  if (!currentWeeklyReview || currentWeeklyReview.id !== wid) {
    currentWeeklyReview = existing || {
      id: wid, weekLabel: _weekDateRange(), rating: 3,
      wentWell: '', blocked: '', nextFocus: '', notes: '',
      createdAt: new Date().toISOString(),
    };
    weeklyRating = currentWeeklyReview.rating;
    _applyWeeklyForm(currentWeeklyReview);
  }
  const lbl = q('weekly-week-label');
  if (lbl) lbl.textContent = `Semaine du ${currentWeeklyReview.weekLabel}`;
  _renderWeeklyRating();
  _renderWeeklyAutoSummary();
  _renderPastReviews();
  bindRichToolbars();
}

function _applyWeeklyForm(r) {
  setEditorHtml('weekly-went-well', r.wentWell || '');
  setEditorHtml('weekly-blocked', r.blocked || '');
  setEditorHtml('weekly-next-focus', r.nextFocus || '');
  setEditorHtml('weekly-notes', r.notes || '');
}

function _renderWeeklyRating() {
  const c = q('weekly-rating');
  if (!c) return;
  c.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button class="weekly-star${n <= weeklyRating ? ' active' : ''}" data-r="${n}">★</button>`
  ).join('');
  c.querySelectorAll('.weekly-star').forEach(btn => {
    btn.addEventListener('click', () => { weeklyRating = parseInt(btn.dataset.r); _renderWeeklyRating(); });
  });
}

function _renderWeeklyAutoSummary() {
  const el = q('weekly-auto-summary');
  if (!el) return;
  const inProg = projects.filter(p => ['en-cours', 'actif', 'in-progress', 'active'].includes(p.status));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = [];
  for (const p of projects) {
    for (const t of (p.tasks || [])) {
      if (t.deadline && t.deadline < today && t.status !== 'done') overdue.push({ title: t.title, proj: p.title });
    }
  }
  el.innerHTML = `
    <div class="wsummary-row">
      <span class="wsummary-lbl">🗂 En cours</span>
      <span class="wsummary-val">${inProg.length ? inProg.map(p => `<span class="wsummary-chip">${escHtml(p.title)}</span>`).join('') : '<em style="color:var(--text3)">Aucun</em>'}</span>
    </div>
    ${overdue.length ? `<div class="wsummary-row"><span class="wsummary-lbl" style="color:var(--danger)">⚠ En retard</span><span class="wsummary-val">${overdue.map(o => `<span class="wsummary-chip danger">${escHtml(o.title)} <em>(${escHtml(o.proj)})</em></span>`).join('')}</span></div>` : ''}
  `;
}

function _renderPastReviews() {
  const list = q('weekly-past-list');
  if (!list) return;
  const past = [...weeklyReviews].sort((a, b) => b.id.localeCompare(a.id));
  if (!past.length) { list.innerHTML = '<p style="padding:12px 16px;font-size:12px;color:var(--text3)">Aucune revue passée</p>'; return; }
  list.innerHTML = past.map(r => `
    <div class="weekly-past-item${r.id === currentWeeklyReview?.id ? ' active' : ''}" data-wid="${r.id}">
      <span class="wpast-label">${r.weekLabel}</span>
      <span class="wpast-stars">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</span>
    </div>
  `).join('');
  list.querySelectorAll('.weekly-past-item').forEach(el => {
    el.addEventListener('click', () => {
      const r = weeklyReviews.find(x => x.id === el.dataset.wid);
      if (!r) return;
      currentWeeklyReview = r; weeklyRating = r.rating || 3;
      const lbl = q('weekly-week-label');
      if (lbl) lbl.textContent = `Semaine du ${r.weekLabel}`;
      _applyWeeklyForm(r); _renderWeeklyRating();
      list.querySelectorAll('.weekly-past-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      bindRichToolbars();
    });
  });
}

async function doSaveWeeklyReview() {
  if (!currentWeeklyReview) return;
  currentWeeklyReview.rating = weeklyRating;
  currentWeeklyReview.wentWell = getEditorHtml('weekly-went-well');
  currentWeeklyReview.blocked = getEditorHtml('weekly-blocked');
  currentWeeklyReview.nextFocus = getEditorHtml('weekly-next-focus');
  currentWeeklyReview.notes = getEditorHtml('weekly-notes');
  currentWeeklyReview.updatedAt = new Date().toISOString();
  weeklyReviews = await window.api.saveWeeklyReview(currentWeeklyReview);
  _renderPastReviews();
  const btn = q('btn-save-weekly');
  if (btn) { btn.textContent = '✓ Sauvegardé'; setTimeout(() => { btn.textContent = 'Sauvegarder'; }, 2000); }
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
    const preview = stripHtml(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 90) || '—';
    return `<div class="journal-entry">
      <div class="journal-entry-line"></div>
      <div class="journal-entry-dot" style="background:${tag.color}"></div>
      <div class="journal-entry-card" data-idx="${realIdx}">
        <div class="journal-entry-header">
          <span class="journal-entry-tag" style="background:${tag.color}22;color:${tag.color}">${tag.icon} ${tag.label}</span>
          <span class="journal-entry-time">${dateStr} · ${timeStr}</span>
          <span class="journal-entry-chevron">▸</span>
          <button class="comment-del" data-idx="${realIdx}" title="Supprimer">✕</button>
        </div>
        <div class="journal-entry-preview">${escHtml(preview)}</div>
        <div class="journal-entry-text">${c.text}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.comment-del').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    removeComment(parseInt(el.dataset.idx));
  }));
  list.querySelectorAll('.journal-entry-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.comment-del')) return;
      const expanded = card.classList.toggle('expanded');
      card.querySelector('.journal-entry-preview').style.display = expanded ? 'none' : '';
      card.querySelector('.journal-entry-text').style.display = expanded ? '' : 'none';
    });
  });
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
        const preview = stripHtml(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return `<div class="schema-node ${pos}">
          <div class="schema-card ${typeClass}" data-idx="${comments.indexOf(c)}">
            <div class="schema-card-tag" style="background:${tag.color}22;color:${tag.color}">${tag.icon} ${tag.label}</div>
            <div class="schema-card-date">${dateStr}</div>
            <div class="schema-card-text">${escHtml(preview)}</div>
            <div class="schema-card-hint">Cliquer pour voir</div>
          </div>
          <div class="schema-stem"></div>
          <div class="schema-dot" style="background:${tag.color}"></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
  list.querySelectorAll('.schema-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const wasExpanded = card.classList.contains('expanded');
      // Collapse all other cards first
      list.querySelectorAll('.schema-card.expanded').forEach(c => c.classList.remove('expanded'));
      if (!wasExpanded) {
        card.classList.add('expanded');
        card.querySelector('.schema-card-hint').style.display = 'none';
      }
    });
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

async function savePomSettings() {
  const work      = parseInt(q('pom-set-work')?.value)      || 25;
  const brk       = parseInt(q('pom-set-break')?.value)     || 5;
  const longBreak = parseInt(q('pom-set-longbreak')?.value) || 15;
  POM_DURATIONS.work      = work      * 60;
  POM_DURATIONS.break     = brk       * 60;
  POM_DURATIONS.longBreak = longBreak * 60;
  // Reset current phase timer
  pomSecondsLeft = pomState.phase === 'work' ? POM_DURATIONS.work : POM_DURATIONS.break;
  clearInterval(pomState.intervalId);
  pomState.running = false;
  pomUpdateUI();
  // Persist
  appSettings.pomWork      = work;
  appSettings.pomBreak     = brk;
  appSettings.pomLongBreak = longBreak;
  await window.api.saveAppSettings(appSettings);
  q('pom-settings-panel')?.classList.add('hidden');
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
  renderThemePresets();
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

// ══ AUTO-UPDATER ═══════════════════════════════════════════════════
async function checkForUpdates() {
  const btn = q('btn-check-updates');
  const badge = q('update-status-badge');
  const applyBtn = q('btn-apply-update');
  const changedSection = q('update-changed-section');
  const changedList = q('update-changed-list');
  const lastMsg = q('update-last-commit-msg');

  if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
  if (badge) { badge.style.display = 'none'; }
  if (applyBtn) applyBtn.style.display = 'none';
  if (changedSection) changedSection.style.display = 'none';

  const res = await window.api.checkForUpdates();

  if (btn) { btn.disabled = false; btn.textContent = 'Vérifier les mises à jour'; }

  if (!res.ok) {
    if (badge) {
      badge.style.display = '';
      badge.style.color = 'var(--danger, #ef4444)';
      badge.textContent = '⚠ ' + res.error;
    }
    return;
  }

  const currentShaEl = q('update-current-sha');
  const latestShaEl  = q('update-latest-sha');
  if (currentShaEl) currentShaEl.textContent = res.currentSha;
  if (latestShaEl)  latestShaEl.textContent  = res.latestSha;

  if (badge) {
    badge.style.display = '';
    if (res.hasUpdate) {
      badge.style.color = '#f59e0b';
      badge.textContent = `🔄 Mise à jour disponible (${res.commitCount} commit${res.commitCount > 1 ? 's' : ''})`;
    } else {
      badge.style.color = 'var(--success, #10b981)';
      badge.textContent = '✅ L\'application est à jour';
    }
  }

  if (lastMsg && res.latestMessage) {
    lastMsg.style.display = '';
    lastMsg.textContent = `Dernier commit : "${res.latestMessage}"`;
  }

  if (res.hasUpdate && res.changedFiles?.length) {
    if (changedSection) changedSection.style.display = '';
    if (changedList) {
      const statusIcon = { added: '➕', modified: '✏️', removed: '🗑️', renamed: '🔀' };
      changedList.innerHTML = res.changedFiles.map(f => `
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:3px 6px;border-radius:5px;background:var(--card-bg)">
          <span title="${f.status}">${statusIcon[f.status] || '📄'}</span>
          <code style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</code>
        </div>`).join('');
    }
    if (applyBtn) applyBtn.style.display = '';
  }
}

async function applyUpdate() {
  const applyBtn = q('btn-apply-update');
  const checkBtn = q('btn-check-updates');
  const progressSection = q('update-progress-section');
  const log = q('update-progress-log');

  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Mise à jour en cours…'; }
  if (checkBtn) checkBtn.disabled = true;
  if (progressSection) progressSection.style.display = '';
  if (log) log.textContent = '';

  const res = await window.api.applyUpdate();

  if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '⬇ Installer la mise à jour'; }
  if (checkBtn) checkBtn.disabled = false;

  if (res.ok) {
    if (applyBtn) applyBtn.style.display = 'none';
    const badge = q('update-status-badge');
    if (badge) {
      badge.style.color = 'var(--success, #10b981)';
      badge.textContent = '✅ Mise à jour installée — relancez TheDash';
    }
  }
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

    const { items, pendingDeletes = [], forcePull = false } = res.body;

    // ── Process pending remote deletions ──────────────────────────
    if (pendingDeletes.length) {
      let delChanged = false;
      const ackIds = [];
      for (const del of pendingDeletes) {
        const key = del.item_key;
        ackIds.push(del.id);
        _deletedIds.add(key);
        switch (del.type) {
          case 'project':  { const i = projects.findIndex(p => p.id === key);   if (i >= 0) { projects.splice(i, 1);   delChanged = true; } break; }
          case 'note':     { const i = notes.findIndex(n => n.id === key);       if (i >= 0) { notes.splice(i, 1);      delChanged = true; } break; }
          case 'resource': { const i = resources.findIndex(r => r.id === key);   if (i >= 0) { resources.splice(i, 1); delChanged = true; } break; }
          case 'group':    { const i = groups.findIndex(g => g.id === key);      if (i >= 0) { groups.splice(i, 1);    delChanged = true; } break; }
          case 'rescat':   { const i = resCats.findIndex(c => c.id === key);     if (i >= 0) { resCats.splice(i, 1);  delChanged = true; } break; }
        }
      }
      // Save deletedIds to settings
      appSettings.deletedItemIds = [..._deletedIds];
      await window.api.saveAppSettings(appSettings);
      if (delChanged) {
        await window.api.bulkSaveAll({ projects, notes, resources, groups, resCats });
        renderHome(); renderProjects(); renderNotes();
        renderResCats(); renderResources(q('res-search')?.value || '');
      }
      // Acknowledge processed deletes
      window.api.serverRequest({
        url: `${base}/api/client/deletes/ack`,
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        body: { ids: ackIds },
      });
    }

    // ── Force pull (snapshot restore) ─────────────────────────────
    if (forcePull) {
      const updProjects  = [];
      const updNotes     = [];
      const updResources = [];
      const updGroups    = [];
      const updResCats   = [];
      _deletedIds.clear();
      appSettings.deletedItemIds = [];
      for (const item of items) {
        let data;
        try { data = JSON.parse(item.data); } catch { continue; }
        switch (item.type) {
          case 'project':  updProjects.push(data);  break;
          case 'note':     updNotes.push(data);     break;
          case 'resource': updResources.push(data); break;
          case 'group':    updGroups.push(data);    break;
          case 'rescat':   updResCats.push(data);   break;
        }
      }
      await window.api.bulkSaveAll({
        projects: updProjects, notes: updNotes, resources: updResources,
        groups: updGroups, resCats: updResCats,
      });
      await window.api.saveAppSettings(appSettings);
      projects  = updProjects;
      notes     = updNotes;
      resources = updResources;
      groups    = updGroups;
      resCats   = updResCats;
      renderHome(); renderProjects(); renderNotes();
      renderResCats(); renderResources(q('res-search')?.value || '');
      // Ack force pull
      window.api.serverRequest({
        url: `${base}/api/client/pull-ack`,
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        body: {},
      });
      return; // skip normal merge — we just replaced everything
    }

    // ── Normal merge pull ─────────────────────────────────────────
    let changed = false;
    const updProjects  = [...projects];
    const updNotes     = [...notes];
    const updResources = [...resources];
    const updGroups    = [...groups];
    const updResCats   = [...resCats];

    for (const item of items) {
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

// ══ VEILLE TECHNOLOGIQUE ══════════════════════════════════════════════════════

let veilleCategories = [];
let veilleFeeds = [];
let veilleArticles = [];
let veilleActiveCat = 'all'; // 'all' | 'archives' | 'none' | categoryId
let veilleSearchQuery = '';
let veillePage = 0;
let veilleCtxArticleId = null;
let editingVeilleCatId = null;
let editingVeilleFeedId = null;
let selectedVeilleCatColor = '#2563eb';

async function initVeille() {
  // Wire up manage modal tabs
  document.querySelectorAll('[data-vtab]').forEach(btn => {
    btn.addEventListener('click', () => switchVeilleManageTab(btn.dataset.vtab));
  });
  on('modal-veille-manage-close', 'click', () => closeModal('modal-veille-manage'));
  on('modal-veille-cat-close', 'click', () => closeModal('modal-veille-cat'));
  on('modal-veille-cat-cancel', 'click', () => closeModal('modal-veille-cat'));
  on('modal-veille-feed-close', 'click', () => closeModal('modal-veille-feed'));
  on('modal-veille-feed-cancel', 'click', () => closeModal('modal-veille-feed'));

  on('btn-veille-manage', 'click', openVeilleManage);
  on('btn-veille-refresh', 'click', veilleRefreshAll);
  on('btn-veille-add-cat', 'click', () => openVeilleCatModal());
  on('btn-veille-add-feed', 'click', () => openVeilleFeedModal());
  on('btn-veille-cat-save', 'click', saveVeilleCategory);
  on('btn-veille-feed-save', 'click', saveVeilleFeed);
  on('btn-veille-test-feed', 'click', testVeilleFeed);

  // Search bar
  const searchInput = q('veille-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      veilleSearchQuery = searchInput.value.trim().toLowerCase();
      veillePage = 0;
      renderVeilleFeed();
    });
  }

  // Context menu
  const ctxMenu = document.getElementById('veille-context-menu');
  document.addEventListener('click', () => { if (ctxMenu) ctxMenu.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctxMenu) ctxMenu.style.display = 'none'; });
  document.getElementById('veille-ctx-transfer')?.addEventListener('click', () => {
    if (veilleCtxArticleId) transferToNote(veilleCtxArticleId);
  });
  document.getElementById('veille-ctx-unread')?.addEventListener('click', () => {
    if (veilleCtxArticleId) markArticleUnread(veilleCtxArticleId);
  });

  // Color picker in category modal
  document.querySelectorAll('#veille-cat-color-picker .color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#veille-cat-color-picker .color-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedVeilleCatColor = opt.dataset.color;
    });
  });

  // Listen for background refresh events
  if (window.api.onVeilleRefreshed) {
    window.api.onVeilleRefreshed(async () => {
      await loadVeilleData();
      renderVeilleFeed();
      renderVeilleBadge();
      renderHome();
    });
  }

  await loadVeilleData();
  renderVeilleCatsBar();
  renderVeilleFeed();
  renderVeilleBadge();
  renderHome();
}

async function loadVeilleData() {
  [veilleCategories, veilleFeeds, veilleArticles] = await Promise.all([
    window.api.veilleGetCategories(),
    window.api.veilleGetFeeds(),
    window.api.veilleGetArticles({}),
  ]);
}

// ── Categories bar ─────────────────────────────────────────────────────────

function renderVeilleCatsBar() {
  const bar = q('veille-cats-bar');
  if (!bar) return;

  // Count unread per category
  const unreadAll = veilleArticles.filter(a => !a.read).length;
  const unreadByCat = {};
  veilleArticles.filter(a => !a.read).forEach(a => {
    if (a.categoryId) unreadByCat[a.categoryId] = (unreadByCat[a.categoryId] || 0) + 1;
  });

  let html = `<button class="veille-cat-pill ${veilleActiveCat === 'all' ? 'active' : ''}" data-catid="all">
    Tout <span class="veille-pill-count">${unreadAll || veilleArticles.length}</span>
  </button>`;

  for (const cat of veilleCategories) {
    const count = unreadByCat[cat.id] || 0;
    const total = veilleArticles.filter(a => a.categoryId === cat.id).length;
    html += `<button class="veille-cat-pill ${veilleActiveCat === cat.id ? 'active' : ''}" data-catid="${cat.id}" style="--cat-color:${cat.color}">
      <span class="veille-pill-dot" style="background:${cat.color}"></span>
      ${cat.name}
      <span class="veille-pill-count">${count || total}</span>
    </button>`;
  }

  // No-category pill if uncategorized articles exist
  const uncatCount = veilleArticles.filter(a => !a.categoryId).length;
  if (uncatCount) {
    html += `<button class="veille-cat-pill ${veilleActiveCat === 'none' ? 'active' : ''}" data-catid="none">
      Sans catégorie <span class="veille-pill-count">${uncatCount}</span>
    </button>`;
  }

  // Favorites pill
  const favCount = veilleArticles.filter(a => a.favorite).length;
  html += `<button class="veille-cat-pill veille-cat-pill-fav ${veilleActiveCat === 'favorites' ? 'active' : ''}" data-catid="favorites">
    <span class="veille-pill-star">★</span> Mes favoris <span class="veille-pill-count">${favCount}</span>
  </button>`;

  // Archives pill (read articles)
  const archiveCount = veilleArticles.filter(a => a.read).length;
  html += `<button class="veille-cat-pill veille-cat-pill-archive ${veilleActiveCat === 'archives' ? 'active' : ''}" data-catid="archives">
    <span class="veille-pill-star" style="opacity:.6">🗄</span> Archives <span class="veille-pill-count">${archiveCount}</span>
  </button>`;

  bar.innerHTML = html;
  bar.querySelectorAll('.veille-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      veilleActiveCat = btn.dataset.catid;
      veillePage = 0;
      renderVeilleCatsBar();
      renderVeilleFeed();
    });
  });

  // Refresh label
  updateVeilleRefreshLabel();
}

async function updateVeilleRefreshLabel() {
  const label = q('veille-refresh-label');
  if (!label) return;
  const ts = await window.api.veilleGetLastRefresh();
  if (!ts) { label.textContent = ''; return; }
  const diff = Math.round((Date.now() - ts) / 60000);
  if (diff < 1) label.textContent = 'actualisé à l\'instant';
  else if (diff < 60) label.textContent = `actualisé il y a ${diff} min`;
  else label.textContent = `actualisé il y a ${Math.round(diff / 60)}h`;
}

function renderVeilleBadge() {
  const badge = q('veille-unread-badge');
  if (!badge) return;
  const count = veilleArticles.filter(a => !a.read).length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ── Article feed ───────────────────────────────────────────────────────────

function renderVeilleFeed() {
  const container = q('veille-feed');
  if (!container) return;

  const isArchive = veilleActiveCat === 'archives';
  const isFavorites = veilleActiveCat === 'favorites';
  const PAGE_SIZE = 10;

  // Base filter
  let filtered = veilleArticles;
  if (isArchive) {
    filtered = filtered.filter(a => a.read);
  } else if (isFavorites) {
    filtered = filtered.filter(a => a.favorite);
  } else {
    // In normal view: hide read AND favorited articles unless searching
    if (!veilleSearchQuery) filtered = filtered.filter(a => !a.read && !a.favorite);
    if (veilleActiveCat === 'none') filtered = filtered.filter(a => !a.categoryId);
    else if (veilleActiveCat !== 'all') filtered = filtered.filter(a => a.categoryId === veilleActiveCat);
  }

  // Search filter (across all categories when query present)
  if (veilleSearchQuery) {
    const q2 = veilleSearchQuery;
    filtered = veilleArticles.filter(a =>
      !a.favorite &&
      ((a.title || '').toLowerCase().includes(q2) ||
      (a.description || '').toLowerCase().includes(q2) ||
      (a.feedName || '').toLowerCase().includes(q2))
    );
  }

  // Sort newest first
  filtered = [...filtered].sort((a, b) => {
    const da = new Date(a.pubDate || a.fetchedAt || 0).getTime();
    const db = new Date(b.pubDate || b.fetchedAt || 0).getTime();
    return db - da;
  });

  if (!filtered.length) {
    if (isFavorites) {
      container.innerHTML = `<div class="veille-empty">
        <div style="font-size:48px;margin-bottom:12px">⭐</div>
        <h3>Aucun favori</h3>
        <p>Cliquez sur l'étoile ☆ d'un article pour l'ajouter à vos favoris.</p>
      </div>`;
    } else if (isArchive) {
      container.innerHTML = `<div class="veille-empty">
        <div style="font-size:48px;margin-bottom:12px">🗄</div>
        <h3>Aucun article archivé</h3>
        <p>Les articles lus apparaîtront ici.</p>
      </div>`;
    } else if (veilleSearchQuery) {
      container.innerHTML = `<div class="veille-empty">
        <div style="font-size:48px;margin-bottom:12px">🔍</div>
        <h3>Aucun résultat</h3>
        <p>Aucun article ne correspond à «&nbsp;${veilleSearchQuery}&nbsp;».</p>
      </div>`;
    } else if (!veilleFeeds.length) {
      container.innerHTML = `<div class="veille-empty">
        <div style="font-size:48px;margin-bottom:12px">📡</div>
        <h3>Aucune source configurée</h3>
        <p>Ajoutez des flux RSS pour commencer votre veille technologique.</p>
        <button class="btn-primary" onclick="openVeilleManage()">+ Ajouter une source</button>
      </div>`;
    } else {
      container.innerHTML = `<div class="veille-empty">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3>Tout est lu !</h3>
        <p>Actualisez pour récupérer de nouveaux articles.</p>
      </div>`;
    }
    return;
  }

  // Pagination for archives, favorites and search results
  const usePagination = isArchive || isFavorites || veilleSearchQuery;
  const totalPages = usePagination ? Math.ceil(filtered.length / PAGE_SIZE) : 1;
  const currentPage = Math.min(veillePage, totalPages - 1);
  const pageItems = usePagination ? filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) : filtered;

  // Group by date
  const groups = {};
  pageItems.forEach(a => {
    const d = a.pubDate ? new Date(a.pubDate) : new Date(a.fetchedAt);
    const label = isNaN(d) ? 'Date inconnue' : formatVeilleDate(new Date(d));
    if (!groups[label]) groups[label] = [];
    groups[label].push(a);
  });

  const ctxMenu = document.getElementById('veille-context-menu');

  let html = '';
  for (const [dateLabel, articles] of Object.entries(groups)) {
    html += `<div class="veille-date-group"><span class="veille-date-label">${dateLabel}</span></div>`;
    for (const a of articles) {
      const cat = veilleCategories.find(c => c.id === a.categoryId);
      const timeAgo = a.pubDate ? relativeTime(new Date(a.pubDate)) : '';
      const highlight = veilleSearchQuery
        ? `<span class="veille-search-hl">${veilleSearchQuery}</span>`
        : null;
      const titleHtml = veilleSearchQuery
        ? highlightText(a.title, veilleSearchQuery)
        : a.title;
      html += `<div class="veille-card ${a.read ? 'read' : ''} ${a.favorite ? 'fav' : ''}" data-id="${a.id}">
        <div class="veille-card-meta">
          ${cat ? `<span class="veille-card-cat" style="background:${cat.color}20;color:${cat.color};border-color:${cat.color}40">${cat.name}</span>` : ''}
          <span class="veille-card-source">${a.feedName}</span>
          <span class="veille-card-time">${timeAgo}</span>
        </div>
        <div class="veille-card-title">${titleHtml}</div>
        ${a.description ? `<div class="veille-card-desc">${veilleSearchQuery ? highlightText(a.description, veilleSearchQuery) : a.description}</div>` : ''}
        <div class="veille-card-actions">
          <button class="veille-btn-link" data-link="${a.link}" data-id="${a.id}">Lire l'article →</button>
          ${!a.read ? `<button class="veille-btn-read" data-id="${a.id}">Marquer lu</button>` : ''}
        </div>
      </div>`;
    }
  }

  // Pagination controls
  if (usePagination && totalPages > 1) {
    html += `<div class="veille-pagination">
      <button class="veille-page-btn" id="veille-page-prev" ${currentPage === 0 ? 'disabled' : ''}>← Précédent</button>
      <span class="veille-page-info">Page ${currentPage + 1} / ${totalPages} (${filtered.length} articles)</span>
      <button class="veille-page-btn" id="veille-page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Suivant →</button>
    </div>`;
  }

  container.innerHTML = html;

  // Pagination buttons
  container.querySelector('#veille-page-prev')?.addEventListener('click', () => {
    veillePage = Math.max(0, currentPage - 1);
    renderVeilleFeed();
    container.scrollTop = 0;
  });
  container.querySelector('#veille-page-next')?.addEventListener('click', () => {
    veillePage = Math.min(totalPages - 1, currentPage + 1);
    renderVeilleFeed();
    container.scrollTop = 0;
  });

  // Context menu (right-click)
  container.querySelectorAll('.veille-card').forEach(card => {
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      veilleCtxArticleId = card.dataset.id;
      const art = veilleArticles.find(a => a.id === veilleCtxArticleId);
      // Show/hide "Marquer non-lu" depending on read state
      const unreadBtn = document.getElementById('veille-ctx-unread');
      if (unreadBtn) unreadBtn.style.display = art?.read ? '' : 'none';
      if (ctxMenu) {
        ctxMenu.style.display = 'block';
        ctxMenu.style.left = `${e.clientX}px`;
        ctxMenu.style.top = `${e.clientY}px`;
      }
    });
  });

  // Read link + mark read
  container.querySelectorAll('.veille-btn-link').forEach(btn => {
    btn.addEventListener('click', async () => {
      window.api.openUrl(btn.dataset.link);
      const id = btn.dataset.id;
      await window.api.veilleMarkRead([id]);
      const art = veilleArticles.find(a => a.id === id);
      if (art) { art.read = true; art.readAt = new Date().toISOString(); }
      const card = container.querySelector(`.veille-card[data-id="${id}"]`);
      if (card) card.classList.add('read');
      renderVeilleBadge();
      renderVeilleCatsBar();
    });
  });

  container.querySelectorAll('.veille-btn-read').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await window.api.veilleMarkRead([id]);
      const art = veilleArticles.find(a => a.id === id);
      if (art) { art.read = true; art.readAt = new Date().toISOString(); }
      const card = container.querySelector(`.veille-card[data-id="${id}"]`);
      if (card) { card.classList.add('read'); btn.remove(); }
      renderVeilleBadge();
      renderVeilleCatsBar();
    });
  });

  // Swipe gestures on cards
  container.querySelectorAll('.veille-card').forEach(card => {
    addVeilleSwipe(card,
      // swipe right → archive (mark read)
      async () => {
        const id = card.dataset.id;
        await window.api.veilleMarkRead([id]);
        const art = veilleArticles.find(a => a.id === id);
        if (art) { art.read = true; art.readAt = new Date().toISOString(); }
        card.classList.add('swipe-out-right');
        setTimeout(() => { renderVeilleCatsBar(); renderVeilleFeed(); renderVeilleBadge(); }, 280);
        showVeilleToast('🗄 Article archivé');
      },
      // swipe left → favorite
      async () => {
        const id = card.dataset.id;
        const isFav = await window.api.veilleToggleFavorite(id);
        const art = veilleArticles.find(a => a.id === id);
        if (art) art.favorite = isFav;
        card.classList.add('swipe-out-left');
        setTimeout(() => { renderVeilleCatsBar(); renderVeilleFeed(); }, 280);
        showVeilleToast(isFav ? '⭐ Ajouté aux favoris' : '☆ Retiré des favoris');
      }
    );
  });
}

function addVeilleSwipe(card, onSwipeRight, onSwipeLeft) {
  const THRESHOLD = 72;
  let startX = 0;
  let dragging = false;

  card.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    // Don't initiate swipe if clicking on a button or link inside the card
    if (e.target.closest('button, a')) return;
    startX = e.clientX;
    dragging = true;
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });

  card.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const capped = Math.sign(dx) * Math.min(Math.abs(dx), 130);
    card.style.transform = `translateX(${capped}px)`;
    card.classList.toggle('swipe-hint-right', dx > THRESHOLD);
    card.classList.toggle('swipe-hint-left',  dx < -THRESHOLD);
  });

  const end = async e => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - startX;
    card.style.transition = '';
    card.style.transform = '';
    card.classList.remove('swipe-hint-right', 'swipe-hint-left');
    if (dx > THRESHOLD) await onSwipeRight();
    else if (dx < -THRESHOLD) await onSwipeLeft();
  };

  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', () => {
    dragging = false;
    card.style.transition = '';
    card.style.transform = '';
    card.classList.remove('swipe-hint-right', 'swipe-hint-left');
  });
}

function formatVeilleDate(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return 'Aujourd\'hui';
  if (d.getTime() === yesterday.getTime()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function relativeTime(d) {
  if (!d || isNaN(d)) return '';
  const diff = Math.round((Date.now() - d.getTime()) / 60000);
  if (diff < 1) return 'à l\'instant';
  if (diff < 60) return `il y a ${diff} min`;
  if (diff < 1440) return `il y a ${Math.round(diff / 60)}h`;
  return `il y a ${Math.round(diff / 1440)}j`;
}

function highlightText(text, query) {
  if (!text || !query) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="veille-hl">$1</mark>');
}

async function transferToNote(articleId) {
  const art = veilleArticles.find(a => a.id === articleId);
  if (!art) return;
  const snippet = (art.description || '').replace(/<[^>]*>/g, '').slice(0, 300);
  const pubDate = art.pubDate ? new Date(art.pubDate).toLocaleDateString('fr-FR') : '';
  const content = `<p><strong>${art.title}</strong></p>` +
    (snippet ? `<p>${snippet}…</p>` : '') +
    `<p><a href="${art.link}">${art.link}</a></p>` +
    (pubDate ? `<p><em>Publié le ${pubDate} — via ${art.feedName}</em></p>` : '');
  const note = {
    id: `note-${Date.now()}`,
    title: art.title.slice(0, 80),
    content,
    color: '#fef08a',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await window.api.veilleTransferToNote(note);
  // Reload notes if on notes page
  if (typeof notes !== 'undefined') {
    notes = await window.api.getNotes();
    if (typeof renderNotes === 'function') renderNotes();
    if (typeof renderHome === 'function') renderHome();
  }
  // Brief toast
  showVeilleToast('📝 Article transféré dans les Notes');
}

async function markArticleUnread(articleId) {
  await window.api.veilleMarkUnread([articleId]);
  const art = veilleArticles.find(a => a.id === articleId);
  if (art) { art.read = false; delete art.readAt; }
  renderVeilleCatsBar();
  renderVeilleFeed();
  renderVeilleBadge();
}

function showVeilleToast(msg) {
  let toast = document.getElementById('veille-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'veille-toast';
    toast.className = 'veille-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function veilleRefreshAll() {
  const btn = q('btn-veille-refresh');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  const label = q('veille-refresh-label');
  if (label) label.textContent = 'actualisation…';

  await window.api.veilleRefreshAll();
  await loadVeilleData();
  renderVeilleCatsBar();
  renderVeilleFeed();
  renderVeilleBadge();

  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
}

// ── Manage modal ───────────────────────────────────────────────────────────

async function openVeilleManage() {
  renderVeilleManageFeeds();
  renderVeilleManageCats();
  await loadVeilleArchiveSettingsUI();
  switchVeilleManageTab('feeds');
  openModal('modal-veille-manage');
}

function switchVeilleManageTab(tab) {
  document.querySelectorAll('[data-vtab]').forEach(b => b.classList.toggle('active', b.dataset.vtab === tab));
  document.querySelectorAll('.veille-manage-pane').forEach(p => p.classList.toggle('active', p.id === `vtab-${tab}`));
}

async function loadVeilleArchiveSettingsUI() {
  const settings = await window.api.veilleGetArchiveSettings();
  const daysInput = document.getElementById('veille-archive-days');
  const timeInput = document.getElementById('veille-archive-time');
  const unreadInput = document.getElementById('veille-max-unread-days');
  if (daysInput) { daysInput.value = settings.archiveDays ?? 30; updateArchiveDaysLabel(daysInput.value); }
  if (timeInput) timeInput.value = settings.archiveTime || '02:00';
  if (unreadInput) { unreadInput.value = settings.maxUnreadDays ?? 0; updateUnreadDaysLabel(unreadInput.value); }

  daysInput?.addEventListener('input', () => updateArchiveDaysLabel(daysInput.value));
  unreadInput?.addEventListener('input', () => updateUnreadDaysLabel(unreadInput.value));

  document.getElementById('btn-veille-archive-save')?.addEventListener('click', saveVeilleArchiveSettings);
  document.getElementById('btn-veille-archive-cleanup')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('veille-archive-status');
    if (statusEl) statusEl.textContent = 'Nettoyage en cours…';
    await window.api.veilleRunArchiveCleanup();
    await loadVeilleData();
    renderVeilleCatsBar();
    renderVeilleFeed();
    renderVeilleBadge();
    if (statusEl) { statusEl.textContent = '✅ Nettoyage effectué.'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
  });
}

function updateArchiveDaysLabel(val) {
  const el = document.getElementById('veille-archive-days-label');
  if (!el) return;
  el.textContent = val == 0 ? 'Désactivé' : `${val} jour${val > 1 ? 's' : ''}`;
}

function updateUnreadDaysLabel(val) {
  const el = document.getElementById('veille-max-unread-label');
  if (!el) return;
  el.textContent = val == 0 ? 'Désactivé' : `${val} jour${val > 1 ? 's' : ''}`;
}

async function saveVeilleArchiveSettings() {
  const days = parseInt(document.getElementById('veille-archive-days')?.value ?? 30);
  const time = document.getElementById('veille-archive-time')?.value || '02:00';
  const unread = parseInt(document.getElementById('veille-max-unread-days')?.value ?? 0);
  await window.api.veilleSaveArchiveSettings({ archiveDays: days, archiveTime: time, maxUnreadDays: unread });
  const statusEl = document.getElementById('veille-archive-status');
  if (statusEl) { statusEl.textContent = '✅ Paramètres enregistrés.'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
}

function renderVeilleManageCats() {
  const list = q('veille-cats-list');
  if (!list) return;
  if (!veilleCategories.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">Aucune catégorie. Commencez par en créer une.</p>`;
    return;
  }
  list.innerHTML = veilleCategories.map(cat => {
    const feedCount = veilleFeeds.filter(f => f.categoryId === cat.id).length;
    return `<div class="veille-manage-row">
      <span class="veille-manage-dot" style="background:${cat.color}"></span>
      <span class="veille-manage-name">${cat.name}</span>
      <span class="veille-manage-sub">${feedCount} source${feedCount > 1 ? 's' : ''}</span>
      <div class="veille-manage-btns">
        <button class="icon-btn" data-edit-cat="${cat.id}" title="Modifier">✎</button>
        <button class="icon-btn danger" data-del-cat="${cat.id}" title="Supprimer">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-edit-cat]').forEach(btn => openVeilleCatModal.bind(null, btn.dataset.editCat) && btn.addEventListener('click', () => openVeilleCatModal(btn.dataset.editCat)));
  list.querySelectorAll('[data-del-cat]').forEach(btn => btn.addEventListener('click', () => deleteVeilleCategory(btn.dataset.delCat)));
}

function renderVeilleManageFeeds() {
  const list = q('veille-feeds-list');
  if (!list) return;
  if (!veilleFeeds.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--text3);text-align:center;padding:20px 0">Aucune source. Ajoutez un flux RSS pour commencer.</p>`;
    return;
  }
  list.innerHTML = veilleFeeds.map(feed => {
    const cat = veilleCategories.find(c => c.id === feed.categoryId);
    const artCount = veilleArticles.filter(a => a.feedId === feed.id).length;
    return `<div class="veille-manage-row">
      ${cat ? `<span class="veille-manage-dot" style="background:${cat.color}"></span>` : '<span class="veille-manage-dot" style="background:var(--text3)"></span>'}
      <div style="flex:1;min-width:0">
        <div class="veille-manage-name">${feed.name}</div>
        <div class="veille-manage-sub" style="font-size:11px;word-break:break-all">${feed.url}</div>
      </div>
      <span class="veille-manage-sub">${artCount} art.</span>
      <div class="veille-manage-btns">
        <button class="icon-btn" data-edit-feed="${feed.id}" title="Modifier">✎</button>
        <button class="icon-btn danger" data-del-feed="${feed.id}" title="Supprimer">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-edit-feed]').forEach(btn => btn.addEventListener('click', () => openVeilleFeedModal(btn.dataset.editFeed)));
  list.querySelectorAll('[data-del-feed]').forEach(btn => btn.addEventListener('click', () => deleteVeilleFeed(btn.dataset.delFeed)));
}

// ── Category CRUD ──────────────────────────────────────────────────────────

function openVeilleCatModal(editId = null) {
  editingVeilleCatId = editId;
  const el = q('modal-veille-cat-title');
  if (el) el.textContent = editId ? 'Modifier la catégorie' : 'Nouvelle catégorie';

  const nameInput = q('veille-cat-name');
  if (nameInput) nameInput.value = '';
  selectedVeilleCatColor = '#2563eb';

  if (editId) {
    const cat = veilleCategories.find(c => c.id === editId);
    if (cat) {
      if (nameInput) nameInput.value = cat.name;
      selectedVeilleCatColor = cat.color;
    }
  }

  document.querySelectorAll('#veille-cat-color-picker .color-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === selectedVeilleCatColor);
  });

  openModal('modal-veille-cat');
}

async function saveVeilleCategory() {
  const name = q('veille-cat-name')?.value.trim();
  if (!name) return;
  const cat = {
    id: editingVeilleCatId || `vcat-${Date.now()}`,
    name,
    color: selectedVeilleCatColor,
  };
  veilleCategories = await window.api.veilleSaveCategory(cat);
  closeModal('modal-veille-cat');
  renderVeilleManageCats();
  renderVeilleCatsBar();
  renderVeilleFeed();
}

async function deleteVeilleCategory(id) {
  veilleCategories = await window.api.veilleDeleteCategory(id);
  // Uncategorize feeds of this category
  const affected = veilleFeeds.filter(f => f.categoryId === id);
  for (const feed of affected) {
    feed.categoryId = null;
    await window.api.veilleSaveFeed(feed);
  }
  veilleFeeds = await window.api.veilleGetFeeds();
  renderVeilleManageCats();
  renderVeilleManageFeeds();
  renderVeilleCatsBar();
  renderVeilleFeed();
}

// ── Feed CRUD ──────────────────────────────────────────────────────────────

function openVeilleFeedModal(editId = null) {
  editingVeilleFeedId = editId;
  const el = q('modal-veille-feed-title');
  if (el) el.textContent = editId ? 'Modifier la source' : 'Ajouter une source RSS';

  const nameInput = q('veille-feed-name');
  const urlInput  = q('veille-feed-url');
  const catSel    = q('veille-feed-cat');
  const testResult = q('veille-feed-test-result');

  if (nameInput) nameInput.value = '';
  if (urlInput)  urlInput.value  = '';
  if (testResult) testResult.textContent = '';

  // Populate category select
  if (catSel) {
    catSel.innerHTML = '<option value="">— Aucune catégorie —</option>' +
      veilleCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  if (editId) {
    const feed = veilleFeeds.find(f => f.id === editId);
    if (feed) {
      if (nameInput) nameInput.value = feed.name;
      if (urlInput)  urlInput.value  = feed.url;
      if (catSel)    catSel.value    = feed.categoryId || '';
    }
  }

  openModal('modal-veille-feed');
}

async function testVeilleFeed() {
  const url = q('veille-feed-url')?.value.trim();
  const result = q('veille-feed-test-result');
  const btn = q('btn-veille-test-feed');
  if (!url || !result) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Test…'; }
  result.textContent = '';
  result.style.color = 'var(--text3)';

  const res = await window.api.veilleTestFeed(url);
  if (res.ok) {
    result.style.color = '#10b981';
    result.textContent = `✅ ${res.count} article(s) trouvé(s). Ex : "${res.sample}"`;
  } else {
    result.style.color = '#ef4444';
    result.textContent = `❌ ${res.error}`;
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Tester'; }
}

async function saveVeilleFeed() {
  const name = q('veille-feed-name')?.value.trim();
  const url  = q('veille-feed-url')?.value.trim();
  const catId = q('veille-feed-cat')?.value || null;
  if (!name || !url) return;

  const feed = {
    id: editingVeilleFeedId || `vfeed-${Date.now()}`,
    name,
    url,
    categoryId: catId || null,
  };
  veilleFeeds = await window.api.veilleSaveFeed(feed);
  closeModal('modal-veille-feed');

  // Auto-fetch the new feed immediately
  await window.api.veilleRefreshAll();
  await loadVeilleData();
  renderVeilleManageFeeds();
  renderVeilleCatsBar();
  renderVeilleFeed();
  renderVeilleBadge();
}

async function deleteVeilleFeed(id) {
  veilleFeeds = await window.api.veilleDeleteFeed(id);
  veilleArticles = veilleArticles.filter(a => a.feedId !== id);
  renderVeilleManageFeeds();
  renderVeilleCatsBar();
  renderVeilleFeed();
  renderVeilleBadge();
}

init();


