const { app, BrowserWindow, ipcMain, dialog, Notification, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
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

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'));
  mainWin = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 640,
    frame: false, backgroundColor: '#f5f7ff',
    icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.loadFile('index.html');
  mainWin.setIcon(icon);
}

app.whenReady().then(() => {
  createWindow();
  startReminderLoop();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

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

ipcMain.handle('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender).minimize());
ipcMain.handle('window-maximize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.handle('window-close', (e) => BrowserWindow.fromWebContents(e.sender).close());

ipcMain.handle('show-item-in-folder', (_, p) => shell.showItemInFolder(p));

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
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: data }); }
      });
    });
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

