// Tests for the HTTP API. These run against the FakePool / FakeRedis
// test doubles (see fakes.js) — NO real Postgres or Redis is required.
// What is real here: the Express routes, the JWT auth, the rate limit,
// the SQL the app builds (the fake executes the same WHERE/limit logic
// the SQL expresses), and the HTTP behaviour Supertest observes.
'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { FakePool, FakeRedis, testConfig } = require('./fakes');

function buildApp(cfgOverrides) {
  const pool = new FakePool();
  const redis = new FakeRedis();
  const cfg = testConfig(cfgOverrides);
  const app = createApp({ pool, redis, cfg });
  return { app, pool, redis, cfg };
}

async function login(app, user = 'admin', pass = 'secret') {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: user, password: pass });
  return res;
}

describe('health / readiness', () => {
  test('GET /healthz returns 200 without auth', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /readyz returns 200 when pool + redis are up', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', postgres: true, redis: true });
  });

  test('GET /readyz returns 503 when the DB is down', async () => {
    const { app, pool } = buildApp();
    pool.fail = true;
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.postgres).toBe(false);
  });

  test('GET /readyz returns 503 when Redis is down', async () => {
    const { app, redis } = buildApp();
    redis.fail = true;
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe(false);
  });
});

describe('auth', () => {
  test('protected routes reject requests without a token', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/alerts')).status).toBe(401);
    expect((await request(app).get('/api/stats')).status).toBe(401);
    expect((await request(app).get('/api/alerts/1')).status).toBe(401);
  });

  test('login with a wrong password returns 401', async () => {
    const { app } = buildApp();
    const res = await login(app, 'admin', 'wrong');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  test('login with a wrong username returns 401', async () => {
    const { app } = buildApp();
    expect((await login(app, 'nobody', 'secret')).status).toBe(401);
  });

  test('login returns a token that works for /api/alerts', async () => {
    const { app } = buildApp();
    const res = await login(app);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    const alerts = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(alerts.status).toBe(200);
    expect(alerts.body.total).toBe(3);
  });

  test('a tampered token is rejected', async () => {
    const { app } = buildApp();
    const { body } = await login(app);
    const bad = `${body.token.slice(0, -2)}xx`;
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  test('login is disabled (503) when no admin user is configured', async () => {
    const { app } = buildApp({ adminUser: '', adminPassword: '' });
    const res = await login(app);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('login_disabled');
  });

  test('login is refused (503) when JWT_SECRET is missing', async () => {
    const { app } = buildApp({ jwtSecret: '' });
    const res = await login(app);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('jwt_not_configured');
  });

  test('login rate limit blocks after the configured max attempts', async () => {
    const { app } = buildApp({ loginRateLimitMax: 2, loginRateLimitWindowMs: 60000 });
    await login(app, 'admin', 'wrong');
    await login(app, 'admin', 'wrong');
    const third = await login(app, 'admin', 'wrong');
    expect(third.status).toBe(429);
  });
});

describe('GET /api/alerts', () => {
  let app;
  let token;
  beforeEach(async () => {
    ({ app } = buildApp());
    ({ body: { token } } = await login(app));
  });
  const auth = () => request(app).get('/api/alerts').set('Authorization', `Bearer ${token}`);

  test('lists alerts newest first with total/limit/offset', async () => {
    const res = await auth();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.alerts.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  test('pagination: limit=2 then offset=2', async () => {
    const page1 = await request(app).get('/api/alerts?limit=2').set('Authorization', `Bearer ${token}`);
    expect(page1.body.alerts.map((a) => a.id)).toEqual([1, 2]);
    const page2 = await request(app).get('/api/alerts?limit=2&offset=2').set('Authorization', `Bearer ${token}`);
    expect(page2.body.alerts.map((a) => a.id)).toEqual([3]);
    expect(page2.body.total).toBe(3);
  });

  test('filter by type', async () => {
    const res = await request(app).get('/api/alerts?type=brute_force').set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(1);
    expect(res.body.alerts[0].type).toBe('brute_force');
  });

  test('filter by severity + status + ip combined', async () => {
    const res = await request(app)
      .get('/api/alerts?severity=high&status=open&ip=1.2.3.4')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(1);
    expect(res.body.alerts[0].id).toBe(1);
  });

  test('invalid filter values return 400', async () => {
    expect((await request(app).get('/api/alerts?type=nope').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/alerts?severity=nope').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/alerts?status=nope').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/alerts?limit=0').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/alerts?limit=101').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    expect((await request(app).get('/api/alerts?offset=-1').set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});

describe('GET /api/alerts/:id', () => {
  test('returns one alert', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app).get('/api/alerts/2').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('5.6.7.8');
    expect(res.body.type).toBe('port_scan');
  });

  test('returns 404 for a missing id', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app).get('/api/alerts/999').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('alert_not_found');
  });

  test('returns 400 for a non-numeric id', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    expect((await request(app).get('/api/alerts/abc').set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});

describe('PATCH /api/alerts/:id/status', () => {
  test('changes open -> acknowledged and returns the updated row', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app)
      .patch('/api/alerts/1/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'acknowledged' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
    expect(res.body.id).toBe(1);
    // The change is visible on a later GET.
    const again = await request(app).get('/api/alerts/1').set('Authorization', `Bearer ${token}`);
    expect(again.body.status).toBe('acknowledged');
  });

  test('rejects an invalid status with 400', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app)
      .patch('/api/alerts/1/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  test('returns 404 for a missing id', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app)
      .patch('/api/alerts/999/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats', () => {
  test('counts come from the DB rows (total, by type, by severity, by day/hour)', async () => {
    const { app } = buildApp();
    const { body: { token } } = await login(app);
    const res = await request(app).get('/api/stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.by_type).toEqual({ brute_force: 1, port_scan: 1, sqli: 1 });
    expect(res.body.by_severity).toEqual({ high: 2, medium: 1 });
    expect(Array.isArray(res.body.by_day_last_7d)).toBe(true);
    expect(Array.isArray(res.body.by_hour_last_24h)).toBe(true);
    expect(res.body.by_day_last_7d.reduce((s, d) => s + d.count, 0)).toBe(3);
  });
});

describe('DB failure handling', () => {
  test('list returns 500 when the DB is down', async () => {
    const { app, pool } = buildApp();
    const { body: { token } } = await login(app);
    pool.fail = true;
    const res = await request(app).get('/api/alerts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('database_error');
  });
});
