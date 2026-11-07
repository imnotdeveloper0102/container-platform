// WebSocket realtime.
//
// HONEST MECHANISM — this is NOT Redis pub/sub. The analyzer does not
// publish anything to Redis (it only consumes events:queue and writes
// Postgres), so there is no channel to subscribe to. Instead this
// module polls the alerts table every WS_POLL_INTERVAL_MS (default
// 2000 ms) for rows whose last_seen moved past the watermark
// (last_seen, id), and broadcasts only those new/updated rows to the
// connected clients. On connect a client first receives a snapshot of
// the 50 most recent alerts, then deltas. No sample data is ever sent.
'use strict';

const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');
const { logger } = require('./logger');

const POLL_SQL = `
  SELECT id, created_at, ip, type, severity, count, first_seen, last_seen, evidence, status
  FROM alerts
  WHERE last_seen > $1 OR (last_seen = $1 AND id > $2)
  ORDER BY last_seen ASC, id ASC
  LIMIT 100
`;

const SNAPSHOT_SQL = `
  SELECT id, created_at, ip, type, severity, count, first_seen, last_seen, evidence, status
  FROM alerts
  ORDER BY created_at DESC
  LIMIT 50
`;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function serialise(row) {
  return {
    ...row,
    created_at: toIso(row.created_at),
    first_seen: toIso(row.first_seen),
    last_seen: toIso(row.last_seen),
  };
}

function createBroadcaster({ pool, wss, pollIntervalMs, queryWithRetry }) {
  // Watermark: (lastSeen, maxId) of the newest row already broadcast.
  let lastSeen = new Date(0);
  let maxId = 0;
  let timer = null;
  let polling = false;

  function broadcast(obj) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  }

  async function pollOnce() {
    if (polling) return; // never overlap two polls
    polling = true;
    try {
      const res = await queryWithRetry(pool, POLL_SQL, [lastSeen, maxId]);
      const rows = (res.rows || []).map(serialise);
      if (rows.length > 0) {
        const newest = rows[rows.length - 1];
        lastSeen = new Date(newest.last_seen);
        maxId = newest.id;
        broadcast({ type: 'alerts', alerts: rows });
        logger.info('ws broadcast', { count: rows.length });
      }
    } catch (err) {
      // Poll failure is transient: log and keep the old watermark so
      // the next poll retries the same window instead of losing rows.
      logger.warn('ws poll failed', { error: String(err.message) });
    } finally {
      polling = false;
    }
  }

  async function sendSnapshot(ws) {
    try {
      const res = await queryWithRetry(pool, SNAPSHOT_SQL, []);
      ws.send(JSON.stringify({
        type: 'snapshot',
        alerts: (res.rows || []).map(serialise),
      }));
      // Snapshot rows are already seen: move the watermark past them
      // so the first poll does not re-broadcast the same rows.
      const rows = res.rows || [];
      if (rows.length > 0) {
        const newest = rows.map(serialise).reduce((a, b) => (
          new Date(b.last_seen) > new Date(a.last_seen) ? b : a
        ));
        if (new Date(newest.last_seen) > lastSeen) {
          lastSeen = new Date(newest.last_seen);
          maxId = Math.max(maxId, ...rows.map((r) => r.id));
        }
      }
    } catch (err) {
      logger.warn('ws snapshot failed', { error: String(err.message) });
      ws.send(JSON.stringify({ type: 'error', error: 'snapshot_failed' }));
    }
  }

  function start() {
    timer = setInterval(() => { pollOnce(); }, pollIntervalMs);
    timer.unref();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { start, stop, pollOnce, sendSnapshot, broadcast };
}

// Attach a WebSocketServer to an existing HTTP server at path /ws.
// Auth: the client must pass its JWT as ?token=<jwt> (browsers cannot
// set an Authorization header on a WebSocket handshake). Invalid or
// missing token => the handshake is rejected with 401.
function attachWebSocket({ server, pool, cfg, queryWithRetry }) {
  const wss = new WebSocketServer({ noServer: true });
  const broadcaster = createBroadcaster({
    pool, wss, pollIntervalMs: cfg.wsPollIntervalMs, queryWithRetry,
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    let token = '';
    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      pathname = url.pathname;
      token = url.searchParams.get('token') || '';
    } catch (err) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      verifyToken(cfg, token);
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    logger.info('ws client connected', { clients: wss.clients.size });
    broadcaster.sendSnapshot(ws);
    ws.on('close', () => {
      logger.info('ws client disconnected', { clients: wss.clients.size });
    });
    ws.on('error', (err) => {
      logger.warn('ws client error', { error: String(err.message) });
    });
  });

  broadcaster.start();
  return { wss, broadcaster };
}

module.exports = { attachWebSocket, createBroadcaster, POLL_SQL, SNAPSHOT_SQL };
