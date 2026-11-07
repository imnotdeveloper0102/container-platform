// PostgreSQL + Redis clients with bounded timeouts and limited retries.
// Production code only — tests inject fakes through createApp() instead.
'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');
const { logger } = require('./logger');

function createPool(cfg) {
  const pool = new Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.pgMax,
    connectionTimeoutMillis: cfg.pgConnectionTimeoutMs,
    query_timeout: cfg.pgQueryTimeoutMs,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => {
    // Idle-client errors must not crash the process; readiness will
    // report the DB as down until it recovers.
    logger.error('pg pool error', { error: String(err && err.message || err) });
  });
  return pool;
}

function createRedis(cfg) {
  const [host, portRaw] = cfg.redisAddr.split(':');
  const port = parseInt(portRaw || '', 10) || 6379;
  const redis = new Redis({
    host: host || 'localhost',
    port,
    password: cfg.redisPassword || undefined,
    db: cfg.redisDb,
    connectTimeout: cfg.redisConnectTimeoutMs,
    // Bounded reconnect: try a few times with backoff, then stop
    // retrying on that attempt (readyz reports 503 until it recovers).
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    lazyConnect: false,
    enableReadyCheck: true,
  });
  redis.on('error', (err) => {
    logger.error('redis error', { error: String(err && err.message || err) });
  });
  return redis;
}

// One query attempt with a single retry on a transient failure.
// Retries are bounded (max 2 attempts total); callers surface the
// error as 503/500 instead of hanging forever.
async function queryWithRetry(pool, text, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      lastErr = err;
      logger.warn('pg query failed', { attempt, error: String(err.message) });
    }
  }
  throw lastErr;
}

module.exports = { createPool, createRedis, queryWithRetry };
