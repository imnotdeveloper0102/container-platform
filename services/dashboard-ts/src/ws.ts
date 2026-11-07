// Merge logic for the WebSocket feed. api-node sends a snapshot of the
// 50 newest alerts on connect, then deltas ({type: "alerts"}) when rows
// are new/updated (it polls the alerts table every 2s — not pub/sub).
// Merge rule: upsert by id, keep created_at DESC, cap the list at 50
// (the snapshot size) so the timeline never grows unbounded.
import type { Alert } from './types';

export type WsMessage =
  | { type: 'snapshot'; alerts: Alert[] }
  | { type: 'alerts'; alerts: Alert[] }
  | { type: 'error'; error: string };

export function mergeAlerts(current: Alert[], incoming: Alert[], cap = 50): Alert[] {
  const byId = new Map<number, Alert>();
  for (const a of current) byId.set(a.id, a);
  for (const a of incoming) byId.set(a.id, a);
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, cap);
}

export function parseWsMessage(raw: string): WsMessage | null {
  try {
    const msg = JSON.parse(raw) as WsMessage;
    if (msg && (msg.type === 'snapshot' || msg.type === 'alerts') && Array.isArray(msg.alerts)) {
      return msg;
    }
    if (msg && msg.type === 'error') return msg;
    return null;
  } catch {
    return null;
  }
}
