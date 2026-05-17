'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../db/database');
const clientAuth = require('../middleware/clientAuth');
const config     = require('../config');

// ─── POST /api/client/register ────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, platform } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const ip     = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const result = await db.registerClient(name.trim(), ip, platform);
    res.status(201).json({ clientId: result.id, apiKey: result.apiKey });
  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/client/heartbeat ───────────────────────────────────
router.post('/heartbeat', clientAuth, async (req, res) => {
  const { storageUsed } = req.body;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  try {
    await db.updateClientHeartbeat(req.client.id, ip, Number(storageUsed) || 0);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// ─── POST /api/client/sync ────────────────────────────────────────
router.post('/sync', clientAuth, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array' });
  }
  try {
    await db.syncItems(req.client.id, items);
    res.json({ ok: true, synced: items.length });
  } catch (err) {
    console.error('[sync]', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ─── POST /api/client/archive ─────────────────────────────────────
router.post('/archive', clientAuth, async (req, res) => {
  const { originalId, type, itemKey, data } = req.body;
  if (!type || data === undefined) {
    return res.status(400).json({ error: 'type and data are required' });
  }
  try {
    const retentionMs = config.archiveRetentionDays * 24 * 60 * 60 * 1000;
    const expiresAt   = new Date(Date.now() + retentionMs).toISOString();
    const archiveId   = await db.addToArchive(req.client.id, originalId, type, itemKey, data, expiresAt);
    res.status(201).json({ ok: true, archiveId });
  } catch (err) {
    res.status(500).json({ error: 'Archive failed' });
  }
});

// ─── GET /api/client/archives ─────────────────────────────────────
router.get('/archives', clientAuth, async (req, res) => {
  try {
    res.json({ archives: await db.getClientArchives(req.client.id) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch archives' });
  }
});

// ─── DELETE /api/client/archive/:id ──────────────────────────────
router.delete('/archive/:id', clientAuth, async (req, res) => {
  try {
    const deleted = await db.deleteArchiveItem(req.params.id, req.client.id);
    if (!deleted) return res.status(404).json({ error: 'Archive item not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete archive item' });
  }
});

module.exports = router;

