// Test doubles for the api-node tests. The production code never uses
// these: createApp() accepts injected pool/redis, so tests pass fakes
// while production (server.js) passes the real pg Pool / ioredis client.
// No real Postgres or Redis is needed to run these tests.
'use strict';

function makeRows() {
  return [
    {
      id: 1, created_at: new Date('2026-11-07T10:00:00.000Z'),
      ip: '1.2.3.4', type: 'brute_force', severity: 'high', count: 5,
      first_seen: new Date('2026-11-07T09:55:00.000Z'),
      last_seen: new Date('2026-11-07T10:00:00.000Z'),
      evidence: { attempts: 5 }, status: 'open',
    },
    {
      id: 2, created_at: new Date('2026-11-07T09:00:00.000Z'),
      ip: '5.6.7.8', type: 'port_scan', severity: 'medium', count: 3,
      first_seen: new Date('2026-11-07T08:59:00.000Z'),
      last_seen: new Date('2026-11-07T09:00:00.000Z'),
      evidence: { ports: [22, 80, 443] }, status: 'open',
    },
    {
      id: 3, created_at: new Date('2026-11-06T12:00:00.000Z'),
      ip: '1.2.3.4', type: 'sqli', severity: 'high', count: 1,
      first_seen: new Date('2026-11-06T12:00:00.000Z'),
      last_seen: new Date('2026-11-06T12:00:00.000Z'),
      evidence: { payload: "1' OR '1'='1" }, status: 'acknowledged',
    },
  ];
}

// Filter rows the same way the real SQL WHERE clause would, reading the
// conditions out of the SQL text in the order the app builds them.
function applyFilters(rows, text, params) {
  const conditions = [];
  ['type =', 'severity =', 'status =', 'ip ='].forEach((cond) => {
    const at = text.indexOf(cond);
    if (at >= 0) conditions.push({ at, field: cond.split(' ')[0] });
  });
  conditions.sort((a, b) => a.at - b.at);
  let out = rows.slice();
  conditions.forEach((c, i) => {
    out = out.filter((r) => String(r[c.field]) === String(params[i]));
  });
  return out;
}

class FakePool {
  constructor() {
    this.rows = makeRows();
    this.fail = false; // when true, every query throws (simulates dead DB)
  }

  async query(text, params = []) {
    if (this.fail) throw new Error('fake db down');
    const sql = String(text);

    if (/SELECT 1/.test(sql)) return { rows: [{ '?column?': 1 }] };

    // WebSocket snapshot: ORDER BY created_at DESC LIMIT 50, no OFFSET.
    if (sql.includes('LIMIT 50') && !sql.includes('OFFSET')) {
      return { rows: this.rows.slice().sort((a, b) => b.created_at - a.created_at).slice(0, 50) };
    }

    // WebSocket poll: rows whose last_seen moved past the watermark.
    if (sql.includes('last_seen > $1')) {
      const [watermark, maxId] = params;
      const out = this.rows.filter((r) => (
        r.last_seen > watermark || (r.last_seen.getTime() === watermark.getTime() && r.id > maxId)
      )).sort((a, b) => a.last_seen - b.last_seen || a.id - b.id);
      return { rows: out };
    }

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: applyFilters(this.rows, sql, params).length }] };
    }

    if (sql.includes('GROUP BY type')) {
      const map = {};
      this.rows.forEach((r) => { map[r.type] = (map[r.type] || 0) + 1; });
      return { rows: Object.entries(map).map(([type, n]) => ({ type, n })) };
    }
    if (sql.includes('GROUP BY severity')) {
      const map = {};
      this.rows.forEach((r) => { map[r.severity] = (map[r.severity] || 0) + 1; });
      return { rows: Object.entries(map).map(([severity, n]) => ({ severity, n })) };
    }
    if (sql.includes('DATE(created_at)')) {
      const map = {};
      this.rows.forEach((r) => {
        const d = r.created_at.toISOString().slice(0, 10);
        map[d] = (map[d] || 0) + 1;
      });
      return { rows: Object.entries(map).map(([day, n]) => ({ day, n })) };
    }
    if (sql.includes("date_trunc('hour'")) {
      const map = {};
      this.rows.forEach((r) => {
        const h = r.created_at.toISOString().slice(0, 13) + ':00:00.000Z';
        map[h] = (map[h] || 0) + 1;
      });
      return { rows: Object.entries(map).map(([hour, n]) => ({ hour, n })) };
    }

    if (sql.includes('UPDATE alerts SET status')) {
      const [status, id] = params;
      const row = this.rows.find((r) => r.id === id);
      if (!row) return { rows: [] };
      row.status = status;
      return { rows: [row] };
    }

    if (sql.includes('WHERE id = $1')) {
      const row = this.rows.find((r) => r.id === params[0]);
      return { rows: row ? [row] : [] };
    }

    // List query: ORDER BY created_at DESC ... LIMIT $n OFFSET $m.
    if (sql.includes('ORDER BY created_at DESC')) {
      const filtered = applyFilters(this.rows, sql, params);
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const sorted = filtered.sort((a, b) => b.created_at - a.created_at);
      return { rows: sorted.slice(offset, offset + limit) };
    }

    throw new Error(`FakePool: unhandled SQL: ${sql.slice(0, 120)}`);
  }
}

class FakeRedis {
  constructor() { this.fail = false; }
  async ping() {
    if (this.fail) throw new Error('fake redis down');
    return 'PONG';
  }
}

function testConfig(overrides) {
  return {
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: 'postgresql://fake',
    pgConnectionTimeoutMs: 1000,
    pgQueryTimeoutMs: 1000,
    pgMax: 2,
    redisAddr: 'localhost:6379',
    redisPassword: '',
    redisDb: 0,
    redisConnectTimeoutMs: 1000,
    adminUser: 'admin',
    adminPassword: 'secret',
    jwtSecret: 'test-secret-do-not-use-in-prod',
    jwtExpiresIn: '1h',
    loginRateLimitWindowMs: 15 * 60 * 1000,
    loginRateLimitMax: 100,
    wsPollIntervalMs: 100,
    ...(overrides || {}),
  };
}

module.exports = { FakePool, FakeRedis, testConfig, makeRows };
