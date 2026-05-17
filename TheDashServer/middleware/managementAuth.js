'use strict';

module.exports = function managementAuth(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Unauthorized — please log in' });
  }
  next();
};
