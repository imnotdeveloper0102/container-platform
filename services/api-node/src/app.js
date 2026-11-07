// Express app factory. createApp({ pool, redis, cfg, queryWithRetry })
// accepts injected clients so tests can pass fakes; production
// (server.js) passes the real pg Pool and ioredis client.
// Pure JS (no TypeScript), Node >= 20.
'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { logger } = require('./logger');
const { loginHandler, requireAuth } = require('./auth');
const { queryWithRetry: defaultQueryWithRetry } = require('./db');

const ALERT_TYPES = ['brute_force', 'port_scan', 'sqli'];
const SEVERITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'acknowledged', 'resolved'];

function isValidEnum(value, allowed) {
  return typeof value === 'string' && allowed.includes(value);
}

function parsePagination(query) {
  const limitRaw = query.limit === undefined ? 20 : Number(query.limit);
  const offsetRaw = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
    return { error: 'limit must be an integer between 1 and 100' };
  }
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0) {
    return { error: 'offset must be an integer >= 0' };
  }
  return { limit: limitRaw, offset: offsetRaw };
}

function createApp(deps) {
  const { pool, redis, cfg } = deps;
  const queryWithRetry = deps.queryWithRetry || defaultQueryWithRetry;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // request_id on every request + JSON access log line.
  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    const started = Date.now();
    res.on('finish', () => {
      logger.info('http request', {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  // ---- liveness / readiness (no auth) ----
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.get('/readyz', async (req, res) => {
    const checks = { postgres: false, redis: false };
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('postgres ping timeout')), cfg.pgQueryTimeoutMs,
        )),
      ]);
      checks.postgres = true;
    } catch (err) {
      logger.warn('readyz postgres failed', { error: String(err.message) });
    }
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('redis ping timeout')), cfg.redisConnectTimeoutMs,
        )),
      ]);
      checks.redis = pong === 'PONG';
    } catch (err) {
      logger.warn('readyz redis failed', { error: String(err.message) });
    }
    if (checks.postgres && checks.redis) {
      return res.json({ status: 'ready', ...checks });
    }
    return res.status(503).json({ status: 'not_ready', ...checks });
  });

  // ---- auth (no auth on login itself) ----
  const loginLimiter = rateLimit({
    windowMs: cfg.loginRateLimitWindowMs,
    max: cfg.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_login_attempts' },
  });
  app.post('/api/auth/login', loginLimiter, loginHandler(cfg));

  // ---- everything below requires a valid Bearer JWT ----
  const auth = requireAuth(cfg);
  app.use('/api/alerts', auth);
  app.use('/api/stats', auth);

  // GET /api/alerts — list, paginated, filtered, newest first.
  app.get('/api/alerts', async (req, res) => {
    const page = parsePagination(req.query);
    if (page.error) return res.status(400).json({ error: page.error });
    const { type, severity, status, ip } = req.query;
    if (type !== undefined && !isValidEnum(type, ALERT_TYPES)) {
      return res.status(400).json({ error: `type must be one of ${ALERT_TYPES.join(',')}` });
    }
    if (severity !== undefined && !isValidEnum(severity, SEVERITIES)) {
      return res.status(400).json({ error: `severity must be one of ${SEVERITIES.join(',')}` });
    }
    if (status !== undefined && !isValidEnum(status, STATUSES)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join(',')}` });
    }
    if (ip !== undefined && (typeof ip !== 'string' || ip.length > 45)) {
      return res.status(400).json({ error: 'ip must be a string of at most 45 characters' });
    }
    const where = [];
    const params = [];
    const add = (sql, value) => { params.push(value); where.push(`${sql} $${params.length}`); };
    if (type) add('type =', type);
    if (severity) add('severity =', severity);
    if (status) add('status =', status);
    if (ip) add('ip =', ip);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    try {
      const totalRes = await queryWithRetry(
        pool, `SELECT COUNT(*)::int AS total FROM alerts ${whereSql}`, params,
      );
      const listParams = [...params, page.limit, page.offset];
      const listRes = await queryWithRetry(
        pool,
        `SELECT id, created_at, ip, type, severity, count, first_seen, last_seen, evidence, status
         FROM alerts ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );
      return res.json({
        total: totalRes.rows[0].total,
        limit: page.limit,
        offset: page.offset,
        alerts: listRes.rows,
      });
    } catch (err) {
      logger.error('list alerts failed', { request_id: req.requestId, error: String(err.message) });
      return res.status(500).json({ error: 'database_error' });
    }
  });

  // GET /api/alerts/:id — one alert, 404 when absent.
  app.get('/api/alerts/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }
    try {
      const result = await queryWithRetry(
        pool,
        `SELECT id, created_at, ip, type, severity, count, first_seen, last_seen, evidence, status
         FROM alerts WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'alert_not_found' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      logger.error('get alert failed', { request_id: req.requestId, error: String(err.message) });
      return res.status(500).json({ error: 'database_error' });
    }
  });

  // PATCH /api/alerts/:id/status — open | acknowledged | resolved.
  app.patch('/api/alerts/:id/status', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }
    const { status } = req.body || {};
    if (!isValidEnum(status, STATUSES)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join(',')}` });
    }
    try {
      const result = await queryWithRetry(
        pool,
        `UPDATE alerts SET status = $1 WHERE id = $2
         RETURNING id, created_at, ip, type, severity, count, first_seen, last_seen, evidence, status`,
        [status, id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'alert_not_found' });
      }
      logger.info('alert status changed', { request_id: req.requestId, id, status });
      return res.json(result.rows[0]);
    } catch (err) {
      logger.error('update alert status failed', { request_id: req.requestId, error: String(err.message) });
      return res.status(500).json({ error: 'database_error' });
    }
  });

  // GET /api/stats — all counts computed from the real DB, nothing hardcoded.
  app.get('/api/stats', async (req, res) => {
    try {
      const [totalRes, byTypeRes, bySeverityRes, byDayRes, byHourRes] = await Promise.all([
        queryWithRetry(pool, 'SELECT COUNT(*)::int AS total FROM alerts', []),
        queryWithRetry(pool, 'SELECT type, COUNT(*)::int AS n FROM alerts GROUP BY type ORDER BY n DESC', []),
        queryWithRetry(pool, 'SELECT severity, COUNT(*)::int AS n FROM alerts GROUP BY severity ORDER BY n DESC', []),
        queryWithRetry(
          pool,
          `SELECT DATE(created_at) AS day, COUNT(*)::int AS n FROM alerts
           WHERE created_at >= now() - interval '7 days'
           GROUP BY day ORDER BY day DESC`,
          [],
        ),
        queryWithRetry(
          pool,
          `SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS n FROM alerts
           WHERE created_at >= now() - interval '24 hours'
           GROUP BY hour ORDER BY hour DESC`,
          [],
        ),
      ]);
      const asMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.n]));
      return res.json({
        total: totalRes.rows[0].total,
        by_type: asMap(byTypeRes.rows, 'type'),
        by_severity: asMap(bySeverityRes.rows, 'severity'),
        by_day_last_7d: byDayRes.rows.map((r) => ({ day: String(r.day), count: r.n })),
        by_hour_last_24h: byHourRes.rows.map((r) => ({ hour: r.hour, count: r.n })),
      });
    } catch (err) {
      logger.error('stats failed', { request_id: req.requestId, error: String(err.message) });
      return res.status(500).json({ error: 'database_error' });
    }
  });

  // JSON parse errors and anything else: JSON, never an HTML stack trace.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    logger.error('unhandled error', { request_id: req.requestId, error: String(err && err.message || err) });
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createApp, ALERT_TYPES, SEVERITIES, STATUSES };
