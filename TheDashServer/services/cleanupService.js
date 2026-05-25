'use strict';

const cron = require('node-cron');
const db   = require('../db/database');

function startCleanupJob() {
  // Every day at 02:00 — purge expired archives
  cron.schedule('0 2 * * *', async () => {
    try {
      const purged = await db.purgeExpiredArchives();
      if (purged > 0) {
        console.log(`[Cleanup] Purged ${purged} expired archive item(s)`);
      }
    } catch (err) {
      console.error('[Cleanup] Failed:', err.message);
    }
  });

  // Every day at 23:55 — create daily snapshots for all clients
  cron.schedule('55 23 * * *', async () => {
    try {
      const created = await db.createSnapshotsForAllClients();
      console.log(`[Snapshot] Daily snapshot created for ${created} client(s)`);
    } catch (err) {
      console.error('[Snapshot] Failed:', err.message);
    }
  });

  console.log('[Cleanup] Nightly archive purge scheduled (02:00)');
  console.log('[Snapshot] Daily snapshot scheduled (23:55)');
}

module.exports = { startCleanupJob };
