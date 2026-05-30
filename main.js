const { app, BrowserWindow, ipcMain, dialog, Notification, shell, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { google } = require('googleapis');

// Force Windows taskbar to use our icon instead of electron.exe
if (process.platform === 'win32') app.setAppUserModelId('com.thedash.app');

// ── Google Calendar ──────────────────────────────────────────────────────────
let googleClient = null;
let googleAuthServer = null;
let googleAuthWin = null;

function getGoogleClient() {
  const creds = load('google-creds', null);
  if (!creds?.clientId || !creds?.clientSecret) return null;
  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, 'http://localhost:9871/callback');
  const tokens = load('google-tokens', null);
  if (tokens) client.setCredentials(tokens);
  client.on('tokens', (t) => {
    const stored = load('google-tokens', {});
    save('google-tokens', { ...stored, ...t });
  });
  return client;
}

// ── Data helpers ─────────────────────────────────────────────────────────────
const dataFile = (name) => path.join(app.getPath('userData'), `${name}.json`);

function load(name, def = []) {
  const f = dataFile(name);
  if (!fs.existsSync(f)) return def;
  try { const v = JSON.parse(fs.readFileSync(f, 'utf-8')); return v ?? def; }
  catch { return def; }
}
function save(name, data) { fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2)); }

// ── Window ───────────────────────────────────────────────────────────────────
let mainWin;
let tray = null;

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'));
  const trayIcon = process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon;
  tray = new Tray(trayIcon);
  tray.setToolTip('TheDash');
  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: mainWin?.isVisible() ? 'Masquer TheDash' : 'Afficher TheDash',
      click: () => { if (mainWin?.isVisible()) mainWin.hide(); else { mainWin.show(); mainWin.focus(); } },
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(buildMenu());
  tray.on('click', () => {
    if (mainWin?.isVisible()) { mainWin.focus(); } else { mainWin.show(); mainWin.focus(); }
    tray.setContextMenu(buildMenu());
  });
  tray.on('right-click', () => tray.setContextMenu(buildMenu()));
}

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'));
  const savedSettings = load('app-settings', {});
  const themeBgMap = { light: '#f5f7ff', dark: '#080e1c', hacker: '#020c14' };
  const initBg = themeBgMap[savedSettings.themeMode] || (savedSettings.darkMode ? '#080e1c' : '#f5f7ff');
  mainWin = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 640,
    frame: false, backgroundColor: initBg,
    icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.loadFile('index.html');
  mainWin.setIcon(icon);
  mainWin.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); mainWin.hide(); } });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startReminderLoop();
  startVeilleRefreshLoop();
  startVeilleArchiveScheduler();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && app.isQuitting) app.quit(); });

// ── Reminder loop ─────────────────────────────────────────────────────────────
function startReminderLoop() {
  checkReminders();
  setInterval(checkReminders, 60 * 1000); // every minute
}

function checkReminders() {
  const raw = load('projects', []);
  const projects = Array.isArray(raw) ? raw : (raw.projects || []);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const p of projects) {
    // Project deadline reminders
    if (p.deadline && p.status !== 'termine') {
      const dl = new Date(p.deadline);
      const diffDays = Math.ceil((dl - now) / 86400000);
      const reminders = p.reminders || [];
      for (const r of reminders) {
        if (!r.enabled) continue;
        let shouldNotify = false;
        if (r.type === 'once' && r.date === today && !r.notifiedDates?.includes(today)) shouldNotify = true;
        if (r.type === 'daily') {
          const startDate = r.startDate || today;
          if (today >= startDate && !r.notifiedDates?.includes(today)) shouldNotify = true;
        }
        if (r.type === 'before' && diffDays === r.daysBefore && !r.notifiedDates?.includes(today)) shouldNotify = true;
        if (shouldNotify) {
          notify(`📋 ${p.title}`, r.message || `Rappel : échéance le ${p.deadline}`);
          r.notifiedDates = [...(r.notifiedDates || []), today];
        }
      }
    }
    // Task deadline reminders
    for (const task of (p.tasks || [])) {
      if (task.deadline && task.status !== 'done') {
        const dl = new Date(task.deadline);
        const diffDays = Math.ceil((dl - now) / 86400000);
        if (diffDays <= 1 && !task.notifiedDeadline) {
          notify(`⚡ Tâche : ${task.title}`, `Projet "${p.title}" — échéance ${diffDays <= 0 ? 'dépassée' : 'demain'}`);
          task.notifiedDeadline = true;
        }
      }
    }
  }
  save('projects', projects);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('reminders-checked');
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-projects', () => { const d = load('projects', []); return Array.isArray(d) ? d : (d.projects || []); });
ipcMain.handle('save-project', (_, p) => {
  const raw = load('projects', []); const projects = Array.isArray(raw) ? raw : (raw.projects || []);
  const idx = projects.findIndex(x => x.id === p.id);
  if (idx >= 0) projects[idx] = p; else projects.push(p);
  save('projects', projects); return projects;
});
ipcMain.handle('delete-project', (_, id) => {
  const raw = load('projects', []); const projects = (Array.isArray(raw) ? raw : (raw.projects || [])).filter(p => p.id !== id);
  save('projects', projects); return projects;
});

ipcMain.handle('get-resources', () => load('resources', []));
ipcMain.handle('save-resource', (_, r) => {
  const res = load('resources', []);
  const idx = res.findIndex(x => x.id === r.id);
  if (idx >= 0) res[idx] = r; else res.push(r);
  save('resources', res); return res;
});
ipcMain.handle('delete-resource', (_, id) => {
  const res = load('resources', []).filter(r => r.id !== id);
  save('resources', res); return res;
});

ipcMain.handle('get-notes', () => load('notes', []));
ipcMain.handle('save-note', (_, n) => {
  const notes = load('notes', []);
  const idx = notes.findIndex(x => x.id === n.id);
  if (idx >= 0) notes[idx] = n; else notes.push(n);
  save('notes', notes); return notes;
});
ipcMain.handle('delete-note', (_, id) => {
  const notes = load('notes', []).filter(n => n.id !== id);
  save('notes', notes); return notes;
});

ipcMain.handle('open-file-dialog', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], title: 'Sélectionner des fichiers' });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('open-path', (_, p) => shell.openPath(p));
ipcMain.handle('open-url-external', (_, url) => shell.openExternal(url));

ipcMain.handle('set-window-background', (_, color) => { if (mainWin) mainWin.setBackgroundColor(color); });
ipcMain.handle('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender).minimize());
ipcMain.handle('window-maximize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.handle('window-close', (e) => { const win = BrowserWindow.fromWebContents(e.sender); if (win === mainWin) win.hide(); else win.close(); });

ipcMain.handle('open-project-window', (_, projectId) => {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'));
  const win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#f5f7ff', icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile('index.html');
  win.webContents.once('did-finish-load', () => win.webContents.send('goto-project', projectId));
});

ipcMain.handle('show-item-in-folder', (_, p) => shell.showItemInFolder(p));

ipcMain.handle('get-weekly-reviews', () => load('weekly-reviews', []));
ipcMain.handle('save-weekly-review', (_, review) => {
  const reviews = load('weekly-reviews', []);
  const idx = reviews.findIndex(r => r.id === review.id);
  if (idx >= 0) reviews[idx] = review; else reviews.push(review);
  save('weekly-reviews', reviews);
  return reviews;
});

ipcMain.handle('open-image-dialog', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Choisir une image de couverture',
    filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','gif','webp','svg','bmp'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('import-file', (_, srcPath, action) => {
  const filesDir = path.join(app.getPath('userData'), 'ressources');
  if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
  const fname = path.basename(srcPath);
  const ext = path.extname(fname);
  const base = path.basename(fname, ext);
  let destPath = path.join(filesDir, fname);
  let counter = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(filesDir, `${base}_${counter++}${ext}`);
  }
  try {
    if (action === 'move') fs.renameSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
    return { ok: true, path: destPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-app-settings', () => load('app-settings', {}));
ipcMain.handle('save-app-settings', (_, s) => { save('app-settings', s); return s; });

// ── TheDashServer HTTP requests (allows self-signed TLS) ────────────────────
ipcMain.handle('server-request', async (_, { url, method = 'GET', headers = {}, body = null }) => {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve({ ok: false, error: 'URL invalide' }); return; }
    const opts = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      rejectUnauthorized: false,
      timeout: 7000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
});

ipcMain.handle('rename-resource', (_, id, newName) => {
  const res = load('resources', []);
  const r = res.find(x => x.id === id);
  if (!r) return res;
  if (r.type === 'file' && r.value) {
    try {
      const dir = path.dirname(r.value);
      const ext = path.extname(r.value);
      const newPath = path.join(dir, newName + ext);
      fs.renameSync(r.value, newPath);
      r.value = newPath;
    } catch (e) { /* keep old path if disk rename fails */ }
  }
  r.name = newName;
  save('resources', res);
  return res;
});

ipcMain.handle('get-groups', () => load('groups', []));
ipcMain.handle('save-group', (_, g) => {
  const groups = load('groups', []);
  const idx = groups.findIndex(x => x.id === g.id);
  if (idx >= 0) groups[idx] = g; else groups.push(g);
  save('groups', groups); return groups;
});
ipcMain.handle('delete-group', (_, id) => {
  const groups = load('groups', []).filter(g => g.id !== id);
  save('groups', groups); return groups;
});

// ── Resource Categories ────────────────────────────────────────────────────────
ipcMain.handle('get-res-cats', () => load('res-categories', []));
ipcMain.handle('save-res-cat', (_, cat) => {
  const cats = load('res-categories', []);
  const idx = cats.findIndex(c => c.id === cat.id);
  if (idx >= 0) cats[idx] = cat; else cats.push(cat);
  save('res-categories', cats); return cats;
});
ipcMain.handle('delete-res-cat', (_, id) => {
  const cats = load('res-categories', []).filter(c => c.id !== id);
  save('res-categories', cats); return cats;
});

ipcMain.handle('bulk-save-all', (_, data) => {
  const { projects, notes, resources, groups, resCats } = data || {};
  if (projects  !== undefined) save('projects',       projects);
  if (notes     !== undefined) save('notes',          notes);
  if (resources !== undefined) save('resources',      resources);
  if (groups    !== undefined) save('groups',         groups);
  if (resCats   !== undefined) save('res-categories', resCats);
  return true;
});

// ── Google Calendar ────────────────────────────────────────────────────────────
ipcMain.handle('google-status', () => {
  const creds = load('google-creds', null);
  const tokens = load('google-tokens', null);
  return { hasCredentials: !!(creds?.clientId), connected: !!(tokens?.access_token) };
});

ipcMain.handle('google-set-creds', (_, clientId, clientSecret) => {
  save('google-creds', { clientId, clientSecret });
  googleClient = null;
  return { ok: true };
});

ipcMain.handle('google-connect', async () => {
  googleClient = getGoogleClient();
  if (!googleClient) return { error: 'Aucun identifiant configuré' };
  const authUrl = googleClient.generateAuthUrl({
    access_type: 'offline', prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
  });
  return new Promise((resolve) => {
    if (googleAuthServer) { try { googleAuthServer.close(); } catch {} googleAuthServer = null; }
    googleAuthServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:9871');
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#f0f4ff"><h2 style="color:#2563eb">✅ Connexion réussie !</h2><p>Vous pouvez fermer cette fenêtre.</p></body></html>');
      googleAuthServer.close(); googleAuthServer = null;
      if (googleAuthWin && !googleAuthWin.isDestroyed()) { googleAuthWin.close(); googleAuthWin = null; }
      if (code) {
        try {
          const { tokens } = await googleClient.getToken(code);
          googleClient.setCredentials(tokens);
          save('google-tokens', tokens);
          if (mainWin) mainWin.webContents.send('google-auth-success');
          resolve({ ok: true });
        } catch (e) { resolve({ error: e.message }); }
      } else { resolve({ error: 'Aucun code reçu' }); }
    });
    googleAuthServer.listen(9871, 'localhost', () => {
      googleAuthWin = new BrowserWindow({
        width: 520, height: 680, parent: mainWin,
        title: 'Connexion Google Calendar',
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      googleAuthWin.loadURL(authUrl);
      googleAuthWin.on('closed', () => {
        googleAuthWin = null;
        if (googleAuthServer) { try { googleAuthServer.close(); } catch {} googleAuthServer = null; }
        resolve({ cancelled: true });
      });
    });
  });
});

ipcMain.handle('google-create-event', async (_, event) => {
  if (!googleClient) googleClient = getGoogleClient();
  if (!googleClient) return { error: 'Non authentifié' };
  try {
    const cal = google.calendar({ version: 'v3', auth: googleClient });
    const res = await cal.events.insert({ calendarId: 'primary', requestBody: event });
    return { ok: true, eventId: res.data.id };
  } catch (e) {
    if (e.code === 401) { save('google-tokens', null); googleClient = null; }
    return { error: e.message };
  }
});

ipcMain.handle('google-disconnect', () => {
  save('google-tokens', null);
  if (googleClient) { googleClient.revokeCredentials().catch(() => {}); googleClient = null; }
  return { ok: true };
});

// ── Auto-updater (GitHub + git pull + rebuild) ────────────────────────────────
const GITHUB_REPO = 'senshiKimura/TheDash';
const UPDATE_INSTALL_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.local', 'share', 'thedash'
);
const UPDATE_APPIMAGE_DEST = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.local', 'bin', 'thedash.AppImage'
);

function githubApiGet(apiPath) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: { 'User-Agent': 'TheDash-Updater/1.0', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, error: 'JSON invalide' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

ipcMain.handle('check-for-updates', async () => {
  // Get current SHA from local git repo
  const currentSha = await new Promise((resolve) => {
    const proc = spawn('git', ['-C', UPDATE_INSTALL_DIR, 'rev-parse', 'HEAD']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    proc.on('error', () => resolve(null));
  });

  if (!currentSha) {
    return { ok: false, error: 'Répertoire source introuvable. Installez via install.sh d\'abord.' };
  }

  // Get latest commit on main from GitHub
  const latestRes = await githubApiGet(`/repos/${GITHUB_REPO}/commits/main`);
  if (!latestRes.ok || !latestRes.data?.sha) {
    return { ok: false, error: 'Impossible de contacter GitHub. Vérifiez votre connexion.' };
  }
  const latestSha = latestRes.data.sha;
  const hasUpdate = currentSha !== latestSha;

  let changedFiles = [];
  let commitCount = 0;

  if (hasUpdate) {
    const compareRes = await githubApiGet(
      `/repos/${GITHUB_REPO}/compare/${currentSha}...${latestSha}`
    );
    if (compareRes.ok && compareRes.data?.files) {
      changedFiles = compareRes.data.files.map((f) => ({
        name: f.filename,
        status: f.status, // added | modified | removed | renamed
      }));
      commitCount = compareRes.data?.total_commits || 0;
    }
  }

  return {
    ok: true,
    hasUpdate,
    currentSha: currentSha.slice(0, 7),
    latestSha: latestSha.slice(0, 7),
    changedFiles,
    commitCount,
    latestMessage: latestRes.data?.commit?.message?.split('\n')[0] || '',
  };
});

ipcMain.handle('apply-update', async () => {
  const sendProgress = (msg) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('update-progress', msg);
    }
  };

  const runStep = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env } });
    proc.stdout.on('data', (d) => sendProgress(d.toString()));
    proc.stderr.on('data', (d) => sendProgress(d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Échec (code ${code})`))));
    proc.on('error', (e) => reject(e));
  });

  try {
    sendProgress('→ Récupération des mises à jour depuis GitHub...\n');
    await runStep('git', ['-C', UPDATE_INSTALL_DIR, 'pull', '--ff-only'], UPDATE_INSTALL_DIR);

    sendProgress('→ Vérification des dépendances...\n');
    await runStep('npm', ['install', '--silent'], UPDATE_INSTALL_DIR);

    sendProgress('→ Build AppImage (peut prendre une minute)...\n');
    await runStep('npm', ['run', 'build:linux'], UPDATE_INSTALL_DIR);

    // Find the built AppImage
    const distDir = path.join(UPDATE_INSTALL_DIR, 'dist');
    const appImages = fs.readdirSync(distDir).filter((f) => f.endsWith('.AppImage'));
    if (!appImages.length) throw new Error('AppImage non trouvé dans dist/ après le build.');

    const builtAppImage = path.join(distDir, appImages[0]);
    sendProgress(`→ Installation de ${appImages[0]}...\n`);
    fs.copyFileSync(builtAppImage, UPDATE_APPIMAGE_DEST);
    fs.chmodSync(UPDATE_APPIMAGE_DEST, 0o755);

    sendProgress('✅ Mise à jour terminée ! Veuillez relancer TheDash.\n');
    return { ok: true };
  } catch (e) {
    sendProgress(`❌ Erreur : ${e.message}\n`);
    return { ok: false, error: e.message };
  }
});

// ══ VEILLE TECHNOLOGIQUE (RSS/Atom) ══════════════════════════════════════════

function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : (m[2] || '')).trim();
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRSSXml(xml) {
  const items = [];
  const isAtom = /<feed\b/i.test(xml) && /Atom/i.test(xml.slice(0, 300));

  if (isAtom) {
    const re = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const e = m[1];
      const linkMatch = e.match(/<link[^>]+href=["']([^"']+)["']/i);
      const link = linkMatch ? linkMatch[1] : extractXmlTag(e, 'link');
      items.push({
        title: extractXmlTag(e, 'title'),
        link,
        description: stripHtmlTags(extractXmlTag(e, 'summary') || extractXmlTag(e, 'content')).slice(0, 380),
        pubDate: extractXmlTag(e, 'updated') || extractXmlTag(e, 'published'),
        guid: extractXmlTag(e, 'id') || link,
      });
    }
  } else {
    const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const e = m[1];
      const link = extractXmlTag(e, 'link') || extractXmlTag(e, 'guid');
      items.push({
        title: extractXmlTag(e, 'title'),
        link,
        description: stripHtmlTags(extractXmlTag(e, 'description') || extractXmlTag(e, 'content:encoded')).slice(0, 380),
        pubDate: extractXmlTag(e, 'pubDate') || extractXmlTag(e, 'dc:date'),
        guid: extractXmlTag(e, 'guid') || link,
      });
    }
  }

  return items.filter(i => i.title && i.link);
}

function fetchRssUrl(url, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'TheDash-Veille/1.0 (RSS Reader)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        },
        timeout: 12000,
        rejectUnauthorized: false,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          const loc = res.headers.location;
          const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
          resolve(fetchRssUrl(nextUrl, maxRedirects - 1));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout réseau')); });
      req.on('error', reject);
      req.end();
    } catch (e) { reject(e); }
  });
}

async function fetchAndCacheVeilleFeed(feed) {
  const res = await fetchRssUrl(feed.url);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  const items = parseRSSXml(res.body);
  if (!items.length) return { ok: false, error: 'Aucun article trouvé — vérifiez l\'URL RSS/Atom' };

  const existing = load('veille-articles', []);
  const existingGuids = new Set(existing.map(a => a.guid));

  const newArticles = items
    .filter(i => !existingGuids.has(i.guid))
    .map(i => ({
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      feedId: feed.id,
      feedName: feed.name,
      categoryId: feed.categoryId,
      title: i.title,
      link: i.link,
      description: i.description,
      pubDate: i.pubDate,
      guid: i.guid,
      read: false,
      fetchedAt: new Date().toISOString(),
    }));

  const combined = [...newArticles, ...existing].slice(0, 1000);
  save('veille-articles', combined);
  return { ok: true, newCount: newArticles.length };
}

async function refreshAllVeilleFeeds() {
  const feeds = load('veille-feeds', []);
  const results = [];
  for (const feed of feeds) {
    try {
      const r = await fetchAndCacheVeilleFeed(feed);
      results.push({ feedId: feed.id, feedName: feed.name, ...r });
    } catch (e) {
      results.push({ feedId: feed.id, feedName: feed.name, ok: false, error: e.message });
    }
  }
  save('veille-last-refresh', Date.now());
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('veille-refreshed');
  return results;
}

function runVeilleArchiveCleanup() {
  const settings = load('veille-archive-settings', { archiveDays: 30, maxUnreadDays: 0 });
  const now = Date.now();
  let arts = load('veille-articles', []);

  if (settings.archiveDays === 0) {
    arts = arts.filter(a => !a.read);
  } else if (settings.archiveDays > 0) {
    const cutoff = now - settings.archiveDays * 86400000;
    arts = arts.filter(a => {
      if (!a.read) return true;
      const d = new Date(a.readAt || a.fetchedAt || a.pubDate || 0).getTime();
      return d > cutoff;
    });
  }

  if (settings.maxUnreadDays > 0) {
    const unreadCutoff = now - settings.maxUnreadDays * 86400000;
    arts = arts.filter(a => {
      if (a.read) return true;
      const d = new Date(a.fetchedAt || a.pubDate || 0).getTime();
      return d > unreadCutoff;
    });
  }

  save('veille-articles', arts);
}

function startVeilleArchiveScheduler() {
  runVeilleArchiveCleanup();
  setInterval(() => {
    const settings = load('veille-archive-settings', { archiveDays: 30, archiveTime: '02:00', maxUnreadDays: 0 });
    const now = new Date();
    const [h, m] = (settings.archiveTime || '02:00').split(':').map(Number);
    if (now.getHours() === h && now.getMinutes() === m) runVeilleArchiveCleanup();
  }, 60000);
}

function startVeilleRefreshLoop() {
  const maybeFetch = async () => {
    const last = load('veille-last-refresh', 0);
    const feeds = load('veille-feeds', []);
    if (feeds.length && Date.now() - last > 6 * 60 * 60 * 1000) {
      await refreshAllVeilleFeeds().catch(() => {});
    }
  };
  maybeFetch();
  setInterval(maybeFetch, 60 * 60 * 1000);
}

// Veille IPC handlers
ipcMain.handle('veille-get-categories', () => load('veille-categories', []));
ipcMain.handle('veille-save-category', (_, cat) => {
  const cats = load('veille-categories', []);
  const idx = cats.findIndex(c => c.id === cat.id);
  if (idx >= 0) cats[idx] = cat; else cats.push(cat);
  save('veille-categories', cats); return cats;
});
ipcMain.handle('veille-delete-category', (_, id) => {
  const cats = load('veille-categories', []).filter(c => c.id !== id);
  save('veille-categories', cats); return cats;
});

ipcMain.handle('veille-get-feeds', () => load('veille-feeds', []));
ipcMain.handle('veille-save-feed', (_, feed) => {
  const feeds = load('veille-feeds', []);
  const idx = feeds.findIndex(f => f.id === feed.id);
  if (idx >= 0) feeds[idx] = feed; else feeds.push(feed);
  save('veille-feeds', feeds); return feeds;
});
ipcMain.handle('veille-delete-feed', (_, id) => {
  const feeds = load('veille-feeds', []).filter(f => f.id !== id);
  const articles = load('veille-articles', []).filter(a => a.feedId !== id);
  save('veille-feeds', feeds);
  save('veille-articles', articles);
  return feeds;
});

ipcMain.handle('veille-get-articles', (_, opts = {}) => {
  let arts = load('veille-articles', []);
  if (opts.categoryId) arts = arts.filter(a => a.categoryId === opts.categoryId);
  if (opts.feedId) arts = arts.filter(a => a.feedId === opts.feedId);
  if (opts.unreadOnly) arts = arts.filter(a => !a.read);
  return arts;
});

ipcMain.handle('veille-mark-read', (_, ids) => {
  const arts = load('veille-articles', []);
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  const now = new Date().toISOString();
  arts.forEach(a => { if (set.has(a.id)) { a.read = true; if (!a.readAt) a.readAt = now; } });
  save('veille-articles', arts); return true;
});

ipcMain.handle('veille-mark-all-read', (_, opts = {}) => {
  const arts = load('veille-articles', []);
  arts.forEach(a => {
    if (!opts.categoryId && !opts.feedId) { a.read = true; return; }
    if (opts.categoryId && a.categoryId === opts.categoryId) a.read = true;
    if (opts.feedId && a.feedId === opts.feedId) a.read = true;
  });
  save('veille-articles', arts); return true;
});

ipcMain.handle('veille-refresh-all', async () => refreshAllVeilleFeeds());

ipcMain.handle('veille-test-feed', async (_, url) => {
  try {
    const res = await fetchRssUrl(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} — URL inaccessible` };
    const items = parseRSSXml(res.body);
    if (!items.length) return { ok: false, error: 'Aucun article trouvé. Vérifiez que c\'est bien une URL RSS ou Atom.' };
    return { ok: true, count: items.length, sample: items[0]?.title || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('veille-get-last-refresh', () => load('veille-last-refresh', 0));

ipcMain.handle('veille-mark-unread', (_, ids) => {
  const arts = load('veille-articles', []);
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  arts.forEach(a => { if (set.has(a.id)) { a.read = false; delete a.readAt; } });
  save('veille-articles', arts); return true;
});

ipcMain.handle('veille-transfer-to-note', (_, noteData) => {
  const notes = load('notes', []);
  notes.unshift(noteData);
  save('notes', notes); return true;
});

ipcMain.handle('veille-get-archive-settings', () =>
  load('veille-archive-settings', { archiveDays: 30, archiveTime: '02:00', maxUnreadDays: 0 })
);

ipcMain.handle('veille-save-archive-settings', (_, settings) => {
  save('veille-archive-settings', settings); return settings;
});

ipcMain.handle('veille-run-archive-cleanup', () => { runVeilleArchiveCleanup(); return true; });

ipcMain.handle('veille-toggle-favorite', (_, id) => {
  const arts = load('veille-articles', []);
  const art = arts.find(a => a.id === id);
  if (art) art.favorite = !art.favorite;
  save('veille-articles', arts);
  return art ? art.favorite : false;
});

// ── iCal subscriptions ─────────────────────────────────────────────────────

function parseICS(text) {
  const events = [];
  // RFC 5545: unfold continuation lines
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = unfolded.split('\n');
  let cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.date && cur.label) events.push(cur);
      cur = null; continue;
    }
    if (!cur) continue;
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const keyPart = line.slice(0, ci).split(';')[0].toUpperCase();
    const val = line.slice(ci + 1);
    if (keyPart === 'DTSTART') {
      const d = val.replace(/T.*/,'');
      if (d.length >= 8) cur.date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    } else if (keyPart === 'SUMMARY') {
      cur.label = val.replace(/\\n/g,' ').replace(/\\,/g,',').replace(/\\\\/g,'\\');
    } else if (keyPart === 'UID') {
      cur.uid = val;
    }
  }
  return events;
}

ipcMain.handle('cal-fetch-ics', async (_, { url, secret }) => {
  try {
    const fetchUrl = url.replace(/^webcal:\/\//i, 'https://');
    const headers = {};
    if (secret) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`:${secret}`).toString('base64');
    }
    const res = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return { ok: true, events: parseICS(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cal-get-subscriptions', () => load('cal-subscriptions', []));
ipcMain.handle('cal-save-subscriptions', (_, subs) => { save('cal-subscriptions', subs); return true; });

