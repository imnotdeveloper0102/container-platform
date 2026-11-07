import { describe, expect, it } from 'vitest';
import { mergeAlerts, parseWsMessage } from '../ws';
import type { Alert } from '../types';

function alert(id: number, created_at: string, status: Alert['status'] = 'open'): Alert {
  return {
    id, created_at, ip: '1.2.3.4', type: 'brute_force', severity: 'high',
    count: 5, first_seen: created_at, last_seen: created_at, evidence: {}, status,
  };
}

describe('mergeAlerts (WS snapshot + delta)', () => {
  it('replaces the list with the snapshot, newest first', () => {
    const merged = mergeAlerts([], [alert(1, '2026-11-07T10:00:00Z'), alert(2, '2026-11-07T11:00:00Z')]);
    expect(merged.map((a) => a.id)).toEqual([2, 1]);
  });

  it('upserts a delta by id instead of duplicating it', () => {
    const merged = mergeAlerts(
      [alert(1, '2026-11-07T10:00:00Z')],
      [alert(1, '2026-11-07T10:00:00Z', 'acknowledged'), alert(2, '2026-11-07T11:00:00Z')],
    );
    expect(merged.map((a) => a.id)).toEqual([2, 1]);
    expect(merged.find((a) => a.id === 1)?.status).toBe('acknowledged');
  });

  it('caps the timeline at 50 rows', () => {
    const many = Array.from({ length: 60 }, (_, i) => alert(i + 1, `2026-11-07T${String(i % 24).padStart(2, '0')}:00:00Z`));
    expect(mergeAlerts([], many)).toHaveLength(50);
  });
});

describe('parseWsMessage', () => {
  it('accepts snapshot and delta messages', () => {
    expect(parseWsMessage(JSON.stringify({ type: 'snapshot', alerts: [] }))).toEqual({ type: 'snapshot', alerts: [] });
    expect(parseWsMessage(JSON.stringify({ type: 'alerts', alerts: [alert(1, '2026-11-07T10:00:00Z')] }))?.type).toBe('alerts');
  });

  it('rejects malformed or unknown messages instead of crashing', () => {
    expect(parseWsMessage('not json')).toBeNull();
    expect(parseWsMessage(JSON.stringify({ type: 'unknown', alerts: [] }))).toBeNull();
  });
});
