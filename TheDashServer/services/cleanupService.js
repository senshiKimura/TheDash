'use strict';

const cron = require('node-cron');
const db   = require('../db/database');

function startCleanupJob() {
  // Every day at 02:00
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

  console.log('[Cleanup] Nightly archive purge scheduled (02:00)');
}

module.exports = { startCleanupJob };
