// JWT auth. No default user/password and no default secret anywhere:
//  - API_ADMIN_USER / API_ADMIN_PASSWORD unset => login is disabled
//    (POST /api/auth/login answers 503 login_disabled).
//  - JWT_SECRET unset => the server refuses to start (server.js) and
//    login also answers 503 if it is somehow reached.
// Tokens are signed with jsonwebtoken, expiry from JWT_EXPIRES_IN.
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { logger } = require('./logger');

function loginEnabled(cfg) {
  return Boolean(cfg.adminUser && cfg.adminPassword && cfg.jwtSecret);
}

// Constant-time comparison so a wrong password does not leak timing.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issueToken(cfg, username) {
  return jwt.sign({ sub: username }, cfg.jwtSecret, {
    expiresIn: cfg.jwtExpiresIn,
  });
}

function verifyToken(cfg, token) {
  return jwt.verify(token, cfg.jwtSecret);
}

function loginHandler(cfg) {
  return (req, res) => {
    if (!cfg.jwtSecret) {
      return res.status(503).json({ error: 'jwt_not_configured' });
    }
    if (!cfg.adminUser || !cfg.adminPassword) {
      return res.status(503).json({ error: 'login_disabled' });
    }
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username_and_password_required' });
    }
    if (!safeEqual(username, cfg.adminUser) || !safeEqual(password, cfg.adminPassword)) {
      logger.warn('login failed', { request_id: req.requestId, username });
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = issueToken(cfg, username);
    logger.info('login ok', { request_id: req.requestId, username });
    return res.json({ token, expires_in: cfg.jwtExpiresIn });
  };
}

// Bearer JWT required. 401 when missing, malformed or expired/invalid.
function requireAuth(cfg) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }
    try {
      req.user = verifyToken(cfg, match[1]);
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid_token' });
    }
  };
}

module.exports = { loginEnabled, loginHandler, requireAuth, issueToken, verifyToken };
