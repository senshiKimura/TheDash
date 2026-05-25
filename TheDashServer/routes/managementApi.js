'use strict';

const express = require('express');
const router  = express.Router();
const config  = require('../config');
const db      = require('../db/database');
const managementAuth = require('../middleware/managementAuth');

// ─── Public ───────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (password !== config.adminPassword) return res.status(401).json({ error: 'Invalid password' });
  req.session.isAdmin = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/status', (req, res) => {
  res.json({ authenticated: !!req.session.isAdmin });
});

// ─── Protected ────────────────────────────────────────────────────

router.use(managementAuth);

router.get('/stats', async (req, res) => {
  try { res.json(await db.getStats()); }
  catch { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

router.get('/clients', async (req, res) => {
  try { res.json({ clients: await db.getAllClients() }); }
  catch { res.status(500).json({ error: 'Failed to fetch clients' }); }
});

router.get('/clients/:id', async (req, res) => {
  try {
    const client = await db.getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch { res.status(500).json({ error: 'Failed to fetch client' }); }
});

router.get('/clients/:id/items', async (req, res) => {
  try {
    const items = await db.getClientItems(req.params.id);
    res.json({ items });
  } catch { res.status(500).json({ error: 'Failed to fetch items' }); }
});

// Delete a specific data item (creates a pending_delete for the client)
router.delete('/clients/:id/items/:itemKey', async (req, res) => {
  const { id, itemKey } = req.params;
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type query param required' });
  try {
    await db.deleteDataItem(id, itemKey);
    await db.addPendingDelete(id, type, itemKey);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to delete item' }); }
});

// ─── Snapshots (per client) ───────────────────────────────────────

router.get('/clients/:id/snapshots', async (req, res) => {
  try {
    res.json({ snapshots: await db.getClientSnapshots(req.params.id) });
  } catch { res.status(500).json({ error: 'Failed to fetch snapshots' }); }
});

router.post('/clients/:id/snapshots', async (req, res) => {
  const { label } = req.body;
  const client = await db.getClientById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const snapLabel = (label && label.trim()) || `Manuel – ${new Date().toLocaleDateString('fr-FR')}`;
  try {
    const snap = await db.createSnapshot(req.params.id, snapLabel);
    if (!snap) return res.status(400).json({ error: 'No data to snapshot' });
    res.status(201).json({ ok: true, snapshot: snap });
  } catch { res.status(500).json({ error: 'Failed to create snapshot' }); }
});

router.delete('/clients/:id', async (req, res) => {
  try {
    const deleted = await db.deleteClient(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Client not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to delete client' }); }
});

router.delete('/clients/:id/data', async (req, res) => {
  try {
    await db.deleteClientData(req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to delete client data' }); }
});

// ─── Snapshots (global) ───────────────────────────────────────────

router.get('/snapshots', async (req, res) => {
  try {
    const { clientId } = req.query;
    const snapshots = clientId
      ? await db.getClientSnapshots(clientId)
      : await db.getAllSnapshots();
    res.json({ snapshots });
  } catch { res.status(500).json({ error: 'Failed to fetch snapshots' }); }
});

router.get('/snapshots/:id', async (req, res) => {
  try {
    const snap = await db.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({ snapshot: snap });
  } catch { res.status(500).json({ error: 'Failed to fetch snapshot' }); }
});

router.post('/snapshots/:id/restore', async (req, res) => {
  try {
    const ok = await db.restoreSnapshot(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Snapshot not found or empty' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to restore snapshot' }); }
});

router.delete('/snapshots/:id', async (req, res) => {
  try {
    const deleted = await db.deleteSnapshot(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to delete snapshot' }); }
});

// Must be before /archives/:id to avoid "purge" being matched as :id
router.post('/archives/purge', async (req, res) => {
  try {
    const count = await db.purgeExpiredArchives();
    res.json({ ok: true, purged: count });
  } catch { res.status(500).json({ error: 'Purge failed' }); }
});

router.get('/archives', async (req, res) => {
  try {
    const { clientId } = req.query;
    const archives = clientId
      ? await db.getClientArchives(clientId)
      : await db.getAllArchives();
    res.json({ archives });
  } catch { res.status(500).json({ error: 'Failed to fetch archives' }); }
});

router.get('/archives/:id', async (req, res) => {
  try {
    const item = await db.getArchiveItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Archive item not found' });
    res.json({ item });
  } catch { res.status(500).json({ error: 'Failed to fetch archive item' }); }
});

router.post('/archives/:id/restore', async (req, res) => {
  try {
    const item = await db.getArchiveItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Archive item not found' });
    res.json({ item });
  } catch { res.status(500).json({ error: 'Failed to restore archive item' }); }
});

router.delete('/archives/:id', async (req, res) => {
  try {
    const deleted = await db.deleteArchiveItem(req.params.id, null);
    if (!deleted) return res.status(404).json({ error: 'Archive item not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to delete archive item' }); }
});

module.exports = router;

