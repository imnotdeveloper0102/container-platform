// WebSocket + server-startup tests. The WS test runs against the
// FakePool (no real Postgres/Redis): the broadcaster polls the fake
// table, so a row added after connect must arrive as a delta message.
// The startup test spawns the real server.js as a child process.
'use strict';

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const { createApp } = require('../src/app');
const { attachWebSocket } = require('../src/ws');
const { issueToken } = require('../src/auth');
const { FakePool, FakeRedis, testConfig } = require('./fakes');

describe('WebSocket /ws (polling, not pub/sub)', () => {
  let server;
  let wss;
  let broadcaster;
  let pool;
  let token;

  beforeEach((done) => {
    pool = new FakePool();
    const redis = new FakeRedis();
    const cfg = testConfig({ wsPollIntervalMs: 100 });
    token = issueToken(cfg, 'admin');
    const app = createApp({ pool, redis, cfg });
    server = http.createServer(app);
    ({ wss, broadcaster } = attachWebSocket({
      server, pool, cfg, queryWithRetry: async (p, sql, params) => p.query(sql, params),
    }));
    server.listen(0, '127.0.0.1', done);
  });

  afterEach((done) => {
    broadcaster.stop();
    wss.close();
    server.close(done);
  });

  function wsUrl(extra) {
    const port = server.address().port;
    return `ws://127.0.0.1:${port}/ws?token=${token}${extra || ''}`;
  }

  test('rejects a connection without a token', (done) => {
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('error', () => {}); // handshake 401 surfaces as an error
    ws.on('unexpected-response', (req, res) => {
      expect(res.statusCode).toBe(401);
      done();
    });
  });

  test('sends a snapshot on connect, then a delta for a new row', (done) => {
    const ws = new WebSocket(wsUrl());
    const messages = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      messages.push(msg);
      if (msg.type === 'snapshot') {
        expect(msg.alerts.length).toBe(3);
        // Add a new alert after the snapshot; the poller must pick it up.
        pool.rows.push({
          id: 4, created_at: new Date('2026-11-07T11:00:00.000Z'),
          ip: '9.9.9.9', type: 'brute_force', severity: 'high', count: 6,
          first_seen: new Date('2026-11-07T10:55:00.000Z'),
          last_seen: new Date('2026-11-07T11:00:00.000Z'),
          evidence: { attempts: 6 }, status: 'open',
        });
      }
      if (msg.type === 'alerts') {
        expect(msg.alerts.map((a) => a.id)).toEqual([4]);
        expect(msg.alerts[0].ip).toBe('9.9.9.9');
        ws.close();
        done();
      }
    });
    ws.on('error', done);
  }, 10000);
});

describe('server.js refuses to start without JWT_SECRET', () => {
  test('exits non-zero and says why (real child process, no DB involved)', (done) => {
    const env = { ...process.env };
    delete env.JWT_SECRET;
    execFile(
      process.execPath,
      [path.join(__dirname, '..', 'src', 'server.js')],
      { env, timeout: 10000 },
      (err, stdout, stderr) => {
        expect(err).not.toBeNull();
        expect(err.code).toBe(1);
        expect(`${stdout}${stderr}`).toMatch(/JWT_SECRET is not set/);
        done();
      },
    );
  });
});
