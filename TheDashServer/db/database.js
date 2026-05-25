'use strict';

const mysql  = require('mysql2/promise');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

let pool;

// ─── Helpers ─────────────────────────────────────────────────────

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ─── Init ─────────────────────────────────────────────────────────

async function initDatabase() {
  pool = mysql.createPool({
    host:               config.db.host,
    port:               config.db.port,
    user:               config.db.user,
    password:           config.db.password,
    database:           config.db.name,
    waitForConnections: true,
    connectionLimit:    10,
    charset:            'utf8mb4',
  });

  // Verify connection
  await pool.execute('SELECT 1');
  console.log('[DB] Connected to MySQL');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id            VARCHAR(36)  PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      api_key_hash  VARCHAR(64)  NOT NULL UNIQUE,
      ip_address    VARCHAR(45),
      storage_used  BIGINT       DEFAULT 0,
      storage_quota BIGINT       DEFAULT 1073741824,
      platform      VARCHAR(100) DEFAULT 'unknown',
      last_seen     DATETIME,
      created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS data_items (
      id         VARCHAR(36)  PRIMARY KEY,
      client_id  VARCHAR(36)  NOT NULL,
      type       VARCHAR(100) NOT NULL,
      item_key   VARCHAR(500) NOT NULL,
      data       LONGTEXT     NOT NULL,
      created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      UNIQUE KEY uq_item (client_id, type, item_key(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS archives (
      id          VARCHAR(36)  PRIMARY KEY,
      client_id   VARCHAR(36)  NOT NULL,
      original_id VARCHAR(36),
      type        VARCHAR(100) NOT NULL,
      item_key    VARCHAR(500),
      data        LONGTEXT     NOT NULL,
      deleted_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
      expires_at  DATETIME     NOT NULL,
      INDEX idx_archives_client  (client_id),
      INDEX idx_archives_expires (expires_at),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS pending_deletes (
      id         VARCHAR(36)  PRIMARY KEY,
      client_id  VARCHAR(36)  NOT NULL,
      type       VARCHAR(100) NOT NULL,
      item_key   VARCHAR(500) NOT NULL,
      created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pd_client (client_id),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id         VARCHAR(36)  PRIMARY KEY,
      client_id  VARCHAR(36)  NOT NULL,
      label      VARCHAR(255) NOT NULL,
      data       LONGTEXT     NOT NULL,
      item_count INT          DEFAULT 0,
      created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_snap_client  (client_id),
      INDEX idx_snap_created (created_at),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS pending_force_pulls (
      client_id  VARCHAR(36) PRIMARY KEY,
      created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('[DB] Tables ready');
}

// ─── Client operations ────────────────────────────────────────────

async function registerClient(name, ipAddress, platform) {
  const id = uuidv4();
  const rawKey = `${uuidv4()}-${uuidv4()}`;
  const keyHash = hashApiKey(rawKey);
  const now = new Date();

  await pool.execute(
    `INSERT INTO clients (id, name, api_key_hash, ip_address, platform, last_seen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, keyHash, ipAddress, platform || 'unknown', now, now],
  );

  return { id, apiKey: rawKey };
}

async function validateClientApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const hash = hashApiKey(apiKey);
  const [rows] = await pool.execute(
    'SELECT * FROM clients WHERE api_key_hash = ?', [hash],
  );
  return rows[0] || null;
}

async function updateClientHeartbeat(clientId, ipAddress, storageUsed) {
  await pool.execute(
    'UPDATE clients SET last_seen = NOW(), ip_address = ?, storage_used = ? WHERE id = ?',
    [ipAddress, storageUsed || 0, clientId],
  );
}

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 2 * 60 * 1000;
}

async function getAllClients() {
  const [rows] = await pool.execute('SELECT * FROM clients ORDER BY last_seen DESC');
  return rows.map(({ api_key_hash, ...c }) => ({
    ...c,
    status: isOnline(c.last_seen) ? 'online' : 'offline',
  }));
}

async function getClientById(id) {
  const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [id]);
  if (!rows.length) return null;
  const { api_key_hash, ...c } = rows[0];
  return { ...c, status: isOnline(c.last_seen) ? 'online' : 'offline' };
}

async function deleteClient(id) {
  const [result] = await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function deleteClientData(clientId) {
  await pool.execute('DELETE FROM data_items WHERE client_id = ?', [clientId]);
  await pool.execute('UPDATE clients SET storage_used = 0 WHERE id = ?', [clientId]);
}

// ─── Sync operations ──────────────────────────────────────────────

async function syncItems(clientId, items) {
  if (!items.length) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const now = new Date();
    for (const item of items) {
      const id   = item.id || uuidv4();
      const data = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
      await conn.execute(
        `INSERT INTO data_items (id, client_id, type, item_key, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`,
        [id, clientId, item.type, item.key || '', data, item.createdAt ? new Date(item.createdAt) : now, now],
      );
    }
    // Recalculate storage_used as sum of data lengths
    await conn.execute(
      'UPDATE clients SET storage_used = (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM data_items WHERE client_id = ?) WHERE id = ?',
      [clientId, clientId],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getClientItems(clientId) {
  const [rows] = await pool.execute(
    `SELECT id, type, item_key,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')), '') AS item_name,
       LENGTH(data) AS data_size, updated_at
     FROM data_items WHERE client_id = ? ORDER BY type, item_key`,
    [clientId],
  );
  return rows;
}

async function getClientItemsFull(clientId) {
  const [rows] = await pool.execute(
    'SELECT id, type, item_key, data, updated_at FROM data_items WHERE client_id = ? ORDER BY type',
    [clientId],
  );
  return rows;
}

async function deleteDataItem(clientId, itemKey) {
  await pool.execute('DELETE FROM data_items WHERE client_id = ? AND item_key = ?', [clientId, itemKey]);
  await pool.execute(
    'UPDATE clients SET storage_used = (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM data_items WHERE client_id = ?) WHERE id = ?',
    [clientId, clientId],
  );
}

// ─── Archive operations ───────────────────────────────────────────

async function addToArchive(clientId, originalId, type, itemKey, data, expiresAt) {
  const id      = uuidv4();
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  await pool.execute(
    `INSERT INTO archives (id, client_id, original_id, type, item_key, data, deleted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [id, clientId, originalId || null, type, itemKey || null, dataStr, new Date(expiresAt)],
  );
  return id;
}

async function getClientArchives(clientId) {
  const [rows] = await pool.execute(
    'SELECT * FROM archives WHERE client_id = ? ORDER BY deleted_at DESC', [clientId],
  );
  return rows;
}

async function getAllArchives() {
  const [rows] = await pool.execute(`
    SELECT a.*, c.name AS client_name
    FROM archives a
    LEFT JOIN clients c ON a.client_id = c.id
    ORDER BY a.deleted_at DESC
  `);
  return rows;
}

async function getArchiveItem(id) {
  const [rows] = await pool.execute('SELECT * FROM archives WHERE id = ?', [id]);
  return rows[0] || null;
}

async function deleteArchiveItem(id, clientId) {
  const [result] = clientId
    ? await pool.execute('DELETE FROM archives WHERE id = ? AND client_id = ?', [id, clientId])
    : await pool.execute('DELETE FROM archives WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function purgeExpiredArchives() {
  const [result] = await pool.execute('DELETE FROM archives WHERE expires_at <= NOW()');
  return result.affectedRows;
}

// ─── Pending deletes ─────────────────────────────────────────────

async function addPendingDelete(clientId, type, itemKey) {
  const id = uuidv4();
  await pool.execute(
    'INSERT INTO pending_deletes (id, client_id, type, item_key) VALUES (?, ?, ?, ?)',
    [id, clientId, type, itemKey],
  );
  return id;
}

async function getPendingDeletes(clientId) {
  const [rows] = await pool.execute(
    'SELECT id, type, item_key FROM pending_deletes WHERE client_id = ?',
    [clientId],
  );
  return rows;
}

async function ackPendingDeletes(clientId, ids) {
  if (!ids || !ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  await pool.execute(
    `DELETE FROM pending_deletes WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...ids],
  );
}

// ─── Snapshots ───────────────────────────────────────────────────

async function createSnapshot(clientId, label) {
  const items = await getClientItemsFull(clientId);
  if (!items.length) return null; // nothing to snapshot
  const data = JSON.stringify(items.map(i => ({ type: i.type, item_key: i.item_key, data: i.data })));
  const id   = uuidv4();
  await pool.execute(
    'INSERT INTO snapshots (id, client_id, label, data, item_count) VALUES (?, ?, ?, ?, ?)',
    [id, clientId, label, data, items.length],
  );
  return { id, label, item_count: items.length };
}

async function createSnapshotsForAllClients() {
  const [clients] = await pool.execute('SELECT id, name FROM clients');
  const label = `Auto – ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  let created = 0;
  for (const c of clients) {
    try {
      const snap = await createSnapshot(c.id, label);
      if (snap) created++;
    } catch (err) {
      console.error(`[Snapshot] Failed for client ${c.name}:`, err.message);
    }
  }
  return created;
}

async function getClientSnapshots(clientId) {
  const [rows] = await pool.execute(
    'SELECT id, label, item_count, created_at FROM snapshots WHERE client_id = ? ORDER BY created_at DESC',
    [clientId],
  );
  return rows;
}

async function getAllSnapshots() {
  const [rows] = await pool.execute(`
    SELECT s.id, s.label, s.item_count, s.created_at, c.name AS client_name, s.client_id
    FROM snapshots s
    LEFT JOIN clients c ON s.client_id = c.id
    ORDER BY s.created_at DESC
  `);
  return rows;
}

async function getSnapshot(id) {
  const [rows] = await pool.execute('SELECT * FROM snapshots WHERE id = ?', [id]);
  return rows[0] || null;
}

async function deleteSnapshot(id) {
  const [result] = await pool.execute('DELETE FROM snapshots WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function restoreSnapshot(snapshotId) {
  const snap = await getSnapshot(snapshotId);
  if (!snap) return false;

  let items;
  try { items = JSON.parse(snap.data); } catch { return false; }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Replace all data_items with snapshot content
    await conn.execute('DELETE FROM data_items WHERE client_id = ?', [snap.client_id]);
    const now = new Date();
    for (const item of items) {
      const id = uuidv4();
      await conn.execute(
        `INSERT INTO data_items (id, client_id, type, item_key, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, snap.client_id, item.type, item.item_key, item.data, now, now],
      );
    }
    // Recalculate storage
    await conn.execute(
      'UPDATE clients SET storage_used = (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM data_items WHERE client_id = ?) WHERE id = ?',
      [snap.client_id, snap.client_id],
    );
    // Signal client to force-pull
    await conn.execute(
      'INSERT INTO pending_force_pulls (client_id) VALUES (?) ON DUPLICATE KEY UPDATE created_at = NOW()',
      [snap.client_id],
    );
    // Clear pending deletes (restore supersedes them)
    await conn.execute('DELETE FROM pending_deletes WHERE client_id = ?', [snap.client_id]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── Force pull ──────────────────────────────────────────────────

async function hasPendingForcePull(clientId) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM pending_force_pulls WHERE client_id = ?', [clientId],
  );
  return rows.length > 0;
}

async function clearPendingForcePull(clientId) {
  await pool.execute('DELETE FROM pending_force_pulls WHERE client_id = ?', [clientId]);
}

// ─── Stats ────────────────────────────────────────────────────────

async function getStats() {
  const [[{ totalClients }]]  = await pool.execute('SELECT COUNT(*) AS totalClients FROM clients');
  const [[{ onlineClients }]] = await pool.execute(
    'SELECT COUNT(*) AS onlineClients FROM clients WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)',
  );
  const [[{ totalStorage }]]  = await pool.execute('SELECT COALESCE(SUM(storage_used), 0) AS totalStorage FROM clients');
  const [[{ totalArchives }]] = await pool.execute('SELECT COUNT(*) AS totalArchives FROM archives');
  const [[{ totalItems }]]    = await pool.execute('SELECT COUNT(*) AS totalItems FROM data_items');
  const [[{ totalSnapshots }]] = await pool.execute('SELECT COUNT(*) AS totalSnapshots FROM snapshots');

  return {
    totalClients,
    onlineClients,
    offlineClients: totalClients - onlineClients,
    totalStorage,
    totalArchives,
    totalItems,
    totalSnapshots,
  };
}

module.exports = {
  initDatabase,
  registerClient,
  validateClientApiKey,
  updateClientHeartbeat,
  getAllClients,
  getClientById,
  deleteClient,
  deleteClientData,
  syncItems,
  getClientItems,
  getClientItemsFull,
  deleteDataItem,
  addToArchive,
  getClientArchives,
  getAllArchives,
  getArchiveItem,
  deleteArchiveItem,
  purgeExpiredArchives,
  // Pending deletes
  addPendingDelete,
  getPendingDeletes,
  ackPendingDeletes,
  // Snapshots
  createSnapshot,
  createSnapshotsForAllClients,
  getClientSnapshots,
  getAllSnapshots,
  getSnapshot,
  deleteSnapshot,
  restoreSnapshot,
  // Force pull
  hasPendingForcePull,
  clearPendingForcePull,
  getStats,
};
