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

// ─── Stats ────────────────────────────────────────────────────────

async function getStats() {
  const [[{ totalClients }]]  = await pool.execute('SELECT COUNT(*) AS totalClients FROM clients');
  const [[{ onlineClients }]] = await pool.execute(
    'SELECT COUNT(*) AS onlineClients FROM clients WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)',
  );
  const [[{ totalStorage }]]  = await pool.execute('SELECT COALESCE(SUM(storage_used), 0) AS totalStorage FROM clients');
  const [[{ totalArchives }]] = await pool.execute('SELECT COUNT(*) AS totalArchives FROM archives');
  const [[{ totalItems }]]    = await pool.execute('SELECT COUNT(*) AS totalItems FROM data_items');

  return {
    totalClients,
    onlineClients,
    offlineClients: totalClients - onlineClients,
    totalStorage,
    totalArchives,
    totalItems,
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
  getStats,
};
