'use strict';

const db = require('../db/database');

module.exports = async function clientAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'X-Api-Key header required' });

  try {
    const client = await db.validateClientApiKey(apiKey);
    if (!client) return res.status(401).json({ error: 'Invalid API key' });
    req.client = client;
    next();
  } catch (err) {
    console.error('[Auth]', err.message);
    res.status(500).json({ error: 'Authentication error' });
  }
};
