// Config for api-node. Everything comes from the environment; there are
// no hardcoded users, passwords or secrets anywhere in this service.
// JWT_SECRET and the admin credentials are required for login to work
// (see auth.js); the server refuses to start without JWT_SECRET.
'use strict';

function env(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key, fallback) {
  const n = parseInt(process.env[key] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = env('POSTGRES_HOST', 'localhost');
  const port = envInt('POSTGRES_PORT', 5432);
  const user = env('POSTGRES_USER', 'secuser');
  const password = process.env.POSTGRES_PASSWORD || 'change-me';
  const db = env('POSTGRES_DB', 'sec_events');
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

function redisAddr() {
  // Same REDIS_ADDR form as collector-go / analyzer-python: host:port.
  return env('REDIS_ADDR', 'localhost:6379');
}

const config = {
  host: env('API_HOST', '0.0.0.0'),
  port: envInt('API_PORT', 3000),
  databaseUrl: databaseUrl(),
  // pg pool: bounded waits so a dead DB fails fast instead of hanging.
  pgConnectionTimeoutMs: envInt('PG_CONNECTION_TIMEOUT_MS', 5000),
  pgQueryTimeoutMs: envInt('PG_QUERY_TIMEOUT_MS', 5000),
  pgMax: envInt('PG_POOL_MAX', 10),
  redisAddr: redisAddr(),
  redisPassword: process.env.REDIS_PASSWORD || '',
  redisDb: envInt('REDIS_DB', 0),
  redisConnectTimeoutMs: envInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
  // Auth. Admin user/password and JWT secret come ONLY from env.
  // Empty admin credentials => login is disabled (503, see auth.js).
  adminUser: process.env.API_ADMIN_USER || '',
  adminPassword: process.env.API_ADMIN_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: env('JWT_EXPIRES_IN', '1h'),
  loginRateLimitWindowMs: envInt('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  loginRateLimitMax: envInt('LOGIN_RATE_LIMIT_MAX', 10),
  // WebSocket realtime is POLLING, not Redis pub/sub: the analyzer
  // publishes nothing, so this service polls the alerts table.
  wsPollIntervalMs: envInt('WS_POLL_INTERVAL_MS', 2000),
};

module.exports = { config, env, envInt };
