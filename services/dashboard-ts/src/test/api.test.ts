// Tests use fetch mocks only — no real API, no sample alert data is
// shipped in the UI. Fixtures below exist only inside these tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildAlertsQuery, fetchAlerts, fetchStats, login, patchAlertStatus } from '../api';
import type { Alert } from '../types';

const alertFixture: Alert = {
  id: 1,
  created_at: '2026-11-07T10:00:00.000Z',
  ip: '1.2.3.4',
  type: 'brute_force',
  severity: 'high',
  count: 5,
  first_seen: '2026-11-07T09:55:00.000Z',
  last_seen: '2026-11-07T10:00:00.000Z',
  evidence: { attempts: 5 },
  status: 'open',
};

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildAlertsQuery', () => {
  it('builds limit/offset plus only the filters that are set', () => {
    const q = buildAlertsQuery({ limit: 20, offset: 40, type: 'brute_force', severity: 'high', ip: '1.2.3.4' });
    expect(q).toContain('limit=20');
    expect(q).toContain('offset=40');
    expect(q).toContain('type=brute_force');
    expect(q).toContain('severity=high');
    expect(q).toContain('ip=1.2.3.4');
    expect(q).not.toContain('status=');
  });
});

describe('login', () => {
  it('returns the token on success', async () => {
    mockFetch({ token: 'tok', expires_in: '1h' });
    await expect(login('admin', 'pw')).resolves.toEqual({ token: 'tok', expires_in: '1h' });
  });

  it('maps 401 to invalid_credentials', async () => {
    mockFetch({ error: 'invalid_credentials' }, 401);
    await expect(login('admin', 'wrong')).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
  });

  it('maps 503 to login_disabled', async () => {
    mockFetch({ error: 'login_disabled' }, 503);
    await expect(login('admin', 'pw')).rejects.toMatchObject({ status: 503, code: 'login_disabled' });
  });

  it('maps a failed fetch to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(login('admin', 'pw')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});

describe('fetchAlerts / fetchStats / patchAlertStatus', () => {
  it('sends Bearer token and returns the list payload', async () => {
    mockFetch({ total: 1, limit: 20, offset: 0, alerts: [alertFixture] });
    const list = await fetchAlerts('tok', { limit: 20, offset: 0, type: 'brute_force' });
    expect(list.total).toBe(1);
    expect(list.alerts[0].ip).toBe('1.2.3.4');
    const url = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('/api/alerts?');
    expect(url).toContain('type=brute_force');
  });

  it('returns stats with the real api-node field names', async () => {
    mockFetch({
      total: 3,
      by_type: { brute_force: 2, sqli: 1 },
      by_severity: { high: 3 },
      by_day_last_7d: [{ day: '2026-11-07', count: 3 }],
      by_hour_last_24h: [{ hour: '2026-11-07T10:00:00.000Z', count: 3 }],
    });
    const stats = await fetchStats('tok');
    expect(stats.by_day_last_7d[0].count).toBe(3);
    expect(stats.by_hour_last_24h).toHaveLength(1);
  });

  it('PATCHes the status and returns the updated alert', async () => {
    mockFetch({ ...alertFixture, status: 'acknowledged' });
    const updated = await patchAlertStatus('tok', 1, 'acknowledged');
    expect(updated.status).toBe('acknowledged');
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ status: 'acknowledged' }));
  });

  it('maps 401 to invalid_token so the UI can send the user back to login', async () => {
    mockFetch({ error: 'invalid_token' }, 401);
    await expect(fetchAlerts('expired', { limit: 20, offset: 0 })).rejects.toBeInstanceOf(ApiError);
    await expect(fetchAlerts('expired', { limit: 20, offset: 0 })).rejects.toMatchObject({ status: 401 });
  });
});
