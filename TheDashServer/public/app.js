'use strict';

// ─── State ────────────────────────────────────────────────────────

const state = { clients: [], currentClientId: null };

// ─── Fetch helpers ────────────────────────────────────────────────

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const get  = (url)        => api('GET',    url);
const post = (url, body)  => api('POST',   url, body);
const del  = (url)        => api('DELETE', url);

// ─── Formatting ───────────────────────────────────────────────────

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function fmtAgo(s) {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  if (ms < 60e3)   return 'just now';
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)}m ago`;
  if (ms < 86400e3)return `${Math.floor(ms / 3600e3)}h ago`;
  return `${Math.floor(ms / 86400e3)}d ago`;
}

function badge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

// ─── XSS protection ───────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── Confirm dialog ───────────────────────────────────────────────

function confirm(title, msg) {
  return new Promise(resolve => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent  = msg;
    document.getElementById('modal').classList.remove('hidden');

    const close = (val) => {
      document.getElementById('modal').classList.add('hidden');
      document.getElementById('modal-ok').onclick     = null;
      document.getElementById('modal-cancel').onclick = null;
      resolve(val);
    };
    document.getElementById('modal-ok').onclick     = () => close(true);
    document.getElementById('modal-cancel').onclick = () => close(false);
  });
}

// ─── Navigation ───────────────────────────────────────────────────

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${name}"]`)?.classList.add('active');

  if (name === 'dashboard') loadDashboard();
  else if (name === 'clients')  loadClients();
  else if (name === 'archives') loadArchives();
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
});

// ─── Auth ─────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const d = await get('/api/management/status');
    d.authenticated ? showApp() : showLogin();
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  showPage('dashboard');
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  try {
    await post('/api/management/login', { password: document.getElementById('password').value });
    err.classList.add('hidden');
    showApp();
  } catch { err.classList.remove('hidden'); }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await post('/api/management/logout');
  showLogin();
});

// ─── Dashboard ────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const [stats, { clients }] = await Promise.all([
      get('/api/management/stats'),
      get('/api/management/clients'),
    ]);

    document.getElementById('s-total').textContent   = stats.totalClients;
    document.getElementById('s-online').textContent  = stats.onlineClients;
    document.getElementById('s-storage').textContent = fmtBytes(stats.totalStorage);
    document.getElementById('s-archives').textContent= stats.totalArchives;

    const tbody = document.getElementById('dash-tbody');
    if (!clients.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No clients registered yet.</td></tr>';
      return;
    }
    tbody.innerHTML = clients.map(c => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${badge(c.status)}</td>
        <td>${fmtAgo(c.last_seen)}</td>
        <td>${fmtBytes(c.storage_used)}</td>
        <td>${esc(c.platform)}</td>
      </tr>`).join('');
  } catch (err) { console.error('Dashboard:', err); }
}

document.getElementById('refresh-dashboard').addEventListener('click', loadDashboard);

// ─── Clients list ─────────────────────────────────────────────────

async function loadClients() {
  showClientsListView();
  try {
    const { clients } = await get('/api/management/clients');
    state.clients = clients;
    renderClientsTable(clients);
  } catch (err) { console.error('Clients:', err); }
}

function showClientsListView() {
  document.getElementById('clients-list').classList.remove('hidden');
  document.getElementById('client-detail').classList.add('hidden');
}

function renderClientsTable(clients) {
  const tbody = document.getElementById('clients-tbody');
  if (!clients.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No clients registered.</td></tr>';
    return;
  }
  tbody.innerHTML = clients.map(c => `
    <tr>
      <td><a class="tbl-link client-link" data-id="${esc(c.id)}">${esc(c.name)}</a></td>
      <td>${badge(c.status)}</td>
      <td>${esc(c.ip_address || '—')}</td>
      <td>${fmtAgo(c.last_seen)}</td>
      <td>${fmtBytes(c.storage_used)}</td>
      <td>${esc(c.platform)}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td><button class="btn btn-danger btn-sm del-client-btn" data-id="${esc(c.id)}" data-name="${esc(c.name)}">Delete</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('.client-link').forEach(a =>
    a.addEventListener('click', () => openClientDetail(a.dataset.id)));

  tbody.querySelectorAll('.del-client-btn').forEach(b =>
    b.addEventListener('click', () => deleteClient(b.dataset.id, b.dataset.name)));
}

async function deleteClient(id, name) {
  if (!await confirm('Delete client', `Delete "${name}" and all its data and archives? This cannot be undone.`)) return;
  try {
    await del(`/api/management/clients/${id}`);
    loadClients();
  } catch (err) { alert('Failed: ' + err.message); }
}

document.getElementById('refresh-clients').addEventListener('click', loadClients);

// ─── Client detail ────────────────────────────────────────────────

async function openClientDetail(id) {
  state.currentClientId = id;
  document.getElementById('clients-list').classList.add('hidden');
  document.getElementById('client-detail').classList.remove('hidden');

  try {
    const [{ client }, { archives }, { items }] = await Promise.all([
      get(`/api/management/clients/${id}`),
      get(`/api/management/archives?clientId=${id}`),
      get(`/api/management/clients/${id}/items`),
    ]);

    document.getElementById('detail-name').textContent = client.name;
    document.getElementById('d-status').innerHTML      = badge(client.status);
    document.getElementById('d-storage').textContent   = fmtBytes(client.storage_used);
    document.getElementById('d-ip').textContent        = client.ip_address || '—';
    document.getElementById('d-archives').textContent  = archives.length;
    document.getElementById('d-items').textContent     = items.length;

    renderDetailItems(items);
    renderDetailArchives(archives);
  } catch (err) { console.error('Detail:', err); }
}

function renderDetailItems(items) {
  const tbody = document.getElementById('detail-items-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No items synced yet.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(i => `
    <tr>
      <td>${esc(i.type)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.item_key)}">${esc(i.item_name || i.item_key || '—')}</td>
      <td>${fmtBytes(i.data_size)}</td>
      <td>${fmtDate(i.updated_at)}</td>
    </tr>`).join('');
}

function renderDetailArchives(archives) {
  const tbody = document.getElementById('detail-archives-tbody');
  if (!archives.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No archives for this client.</td></tr>';
    return;
  }
  tbody.innerHTML = archives.map(a => `
    <tr>
      <td>${esc(a.type)}</td>
      <td>${esc(a.item_key || '—')}</td>
      <td>${fmtDate(a.deleted_at)}</td>
      <td>${fmtDate(a.expires_at)}</td>
      <td class="row-gap">
        <button class="btn btn-ghost btn-sm view-btn" data-raw="${esc(a.data)}">View</button>
        <button class="btn btn-danger btn-sm del-arc-btn" data-id="${esc(a.id)}">Delete</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.view-btn').forEach(b =>
    b.addEventListener('click', () => showDataModal(b.dataset.raw)));

  tbody.querySelectorAll('.del-arc-btn').forEach(b =>
    b.addEventListener('click', async () => {
      if (!await confirm('Delete archive', 'Permanently delete this archived item?')) return;
      try { await del(`/api/management/archives/${b.dataset.id}`); openClientDetail(state.currentClientId); }
      catch (err) { alert('Failed: ' + err.message); }
    }));
}

document.getElementById('back-clients').addEventListener('click', () => { showClientsListView(); loadClients(); });

document.getElementById('detail-del-client').addEventListener('click', async () => {
  const c = state.clients.find(x => x.id === state.currentClientId);
  await deleteClient(state.currentClientId, c?.name || state.currentClientId);
});

document.getElementById('detail-del-data').addEventListener('click', async () => {
  if (!await confirm('Delete data', 'Delete all synced data for this client? Archives are kept.')) return;
  try { await del(`/api/management/clients/${state.currentClientId}/data`); openClientDetail(state.currentClientId); }
  catch (err) { alert('Failed: ' + err.message); }
});

// ─── Archives ─────────────────────────────────────────────────────

async function loadArchives() {
  try {
    const [{ archives }, { clients }] = await Promise.all([
      get('/api/management/archives'),
      get('/api/management/clients'),
    ]);

    const sel = document.getElementById('arc-filter');
    sel.innerHTML = '<option value="">All clients</option>' +
      clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    renderArchivesTable(archives);
  } catch (err) { console.error('Archives:', err); }
}

function renderArchivesTable(archives) {
  const tbody = document.getElementById('archives-tbody');
  if (!archives.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No archives.</td></tr>';
    return;
  }
  tbody.innerHTML = archives.map(a => `
    <tr>
      <td>${esc(a.client_name || a.client_id)}</td>
      <td>${esc(a.type)}</td>
      <td>${esc(a.item_key || '—')}</td>
      <td>${fmtDate(a.deleted_at)}</td>
      <td>${fmtDate(a.expires_at)}</td>
      <td class="row-gap">
        <button class="btn btn-ghost btn-sm view-btn" data-raw="${esc(a.data)}">View</button>
        <button class="btn btn-danger btn-sm del-arc-btn" data-id="${esc(a.id)}">Delete</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.view-btn').forEach(b =>
    b.addEventListener('click', () => showDataModal(b.dataset.raw)));

  tbody.querySelectorAll('.del-arc-btn').forEach(b =>
    b.addEventListener('click', async () => {
      if (!await confirm('Delete archive', 'Permanently delete this archived item?')) return;
      try { await del(`/api/management/archives/${b.dataset.id}`); loadArchives(); }
      catch (err) { alert('Failed: ' + err.message); }
    }));
}

document.getElementById('arc-filter').addEventListener('change', async e => {
  const clientId = e.target.value;
  const url = clientId ? `/api/management/archives?clientId=${clientId}` : '/api/management/archives';
  try { const { archives } = await get(url); renderArchivesTable(archives); }
  catch (err) { console.error(err); }
});

document.getElementById('refresh-archives').addEventListener('click', loadArchives);

document.getElementById('purge-btn').addEventListener('click', async () => {
  if (!await confirm('Purge expired archives', 'Permanently delete all archive items that have passed their expiry date?')) return;
  try {
    const { purged } = await post('/api/management/archives/purge');
    alert(`Purged ${purged} expired item(s).`);
    loadArchives();
  } catch (err) { alert('Failed: ' + err.message); }
});

// ─── Data preview modal ───────────────────────────────────────────

function showDataModal(raw) {
  try {
    document.getElementById('data-preview').textContent = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    document.getElementById('data-preview').textContent = raw;
  }
  document.getElementById('data-modal').classList.remove('hidden');
}

document.getElementById('data-modal-close').addEventListener('click', () => {
  document.getElementById('data-modal').classList.add('hidden');
});

// ─── Auto-refresh dashboard every 30 s ───────────────────────────

setInterval(() => {
  if (document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
}, 30_000);

// ─── Boot ─────────────────────────────────────────────────────────

checkAuth();
