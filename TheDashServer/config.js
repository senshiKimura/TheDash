'use strict';

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3100,
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET || 'default-insecure-secret',
  archiveRetentionDays: parseInt(process.env.ARCHIVE_RETENTION_DAYS, 10) || 30,

  ssl: {
    key:  process.env.SSL_KEY_PATH  || './ssl/key.pem',
    cert: process.env.SSL_CERT_PATH || './ssl/cert.pem',
  },

  db: {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    user:     process.env.DB_USER     || 'thedash',
    password: process.env.DB_PASSWORD || '',
    name:     process.env.DB_NAME     || 'thedash',
  },
};
