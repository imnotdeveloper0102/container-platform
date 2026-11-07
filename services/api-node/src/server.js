// Entry point: builds the real pg Pool + ioredis client, starts the
// HTTP server and the /ws WebSocket server, handles graceful shutdown.
// The server REFUSES TO START without JWT_SECRET — a missing secret
// must never silently mean "no auth". Login is additionally disabled
// when API_ADMIN_USER / API_ADMIN_PASSWORD are unset (see auth.js).
'use strict';

const http = require('http');
const { config } = require('./config');
const { logger } = require('./logger');
const { createPool, createRedis, queryWithRetry } = require('./db');
const { createApp } = require('./app');
const { attachWebSocket } = require('./ws');

if (!config.jwtSecret) {
  logger.error('refusing to start: JWT_SECRET is not set', {});
  process.stderr.write('api-node: JWT_SECRET is not set — refusing to start.\n');
  process.exit(1);
}

const pool = createPool(config);
const redis = createRedis(config);
const app = createApp({ pool, redis, cfg: config, queryWithRetry });
const server = http.createServer(app);
const { wss, broadcaster } = attachWebSocket({
  server, pool, cfg: config, queryWithRetry,
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  broadcaster.stop();
  wss.clients.forEach((client) => client.close());
  wss.close();
  server.close(async () => {
    try { await pool.end(); } catch (err) { logger.warn('pool close failed', { error: String(err.message) }); }
    try { redis.disconnect(); } catch (err) { logger.warn('redis close failed', { error: String(err.message) }); }
    logger.info('api-node stopped', {});
    process.exit(0);
  });
  // Do not hang forever on a stuck connection: force exit after 10s.
  setTimeout(() => {
    logger.warn('forced shutdown after timeout', {});
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, config.host, () => {
  logger.info('api-node listening', {
    host: config.host,
    port: config.port,
    ws_poll_interval_ms: config.wsPollIntervalMs,
    login_enabled: Boolean(config.adminUser && config.adminPassword),
  });
});
