'use strict';

require('dotenv').config();

const https   = require('https');
const fs      = require('fs');
const express = require('express');
const session = require('express-session');
const path    = require('path');
const config  = require('./config');
const db      = require('./db/database');
const clientApi     = require('./routes/clientApi');
const managementApi = require('./routes/managementApi');
const { startCleanupJob } = require('./services/cleanupService');

// ─── Startup guards ───────────────────────────────────────────────

if (!config.adminPassword || config.adminPassword === 'change-me') {
  console.error('FATAL: Set a real ADMIN_PASSWORD in your .env file before starting.');
  process.exit(1);
}

let sslOptions;
try {
  sslOptions = {
    key:  fs.readFileSync(config.ssl.key),
    cert: fs.readFileSync(config.ssl.cert),
  };
} catch (err) {
  console.error(`FATAL: Cannot read TLS certificate files.`);
  console.error(`  Key:  ${config.ssl.key}`);
  console.error(`  Cert: ${config.ssl.cert}`);
  console.error(`\nGenerate a self-signed certificate (dev/LAN):`);
  console.error(`  mkdir ssl`);
  console.error(`  openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/CN=localhost"`);
  process.exit(1);
}

// ─── Express app ─────────────────────────────────────────────────

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,       // enforced — HTTPS only
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/client',     clientApi);
app.use('/api/management', managementApi);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────

async function start() {
  await db.initDatabase();
  startCleanupJob();

  https.createServer(sslOptions, app).listen(config.port, () => {
    console.log(`TheDashServer running on port ${config.port} (HTTPS)`);
    console.log(`Management UI → https://localhost:${config.port}`);
  });
}

start().catch(err => {
  console.error('Failed to start TheDashServer:', err.message);
  process.exit(1);
});

