// Types mirror the real api-node contract (services/api-node/src/app.js).
// No sample data lives anywhere in src/ — every value comes from the API.

export type AlertType = 'brute_force' | 'port_scan' | 'sqli';
export type Severity = 'low' | 'medium' | 'high';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export const ALERT_TYPES: AlertType[] = ['brute_force', 'port_scan', 'sqli'];
export const SEVERITIES: Severity[] = ['low', 'medium', 'high'];
export const STATUSES: AlertStatus[] = ['open', 'acknowledged', 'resolved'];

export interface Alert {
  id: number;
  created_at: string;
  ip: string;
  type: AlertType;
  severity: Severity;
  count: number;
  first_seen: string;
  last_seen: string;
  evidence: unknown;
  status: AlertStatus;
}

export interface AlertsList {
  total: number;
  limit: number;
  offset: number;
  alerts: Alert[];
}

export interface Stats {
  total: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  // Exact field names from api-node: by_day_last_7d / by_hour_last_24h.
  by_day_last_7d: { day: string; count: number }[];
  by_hour_last_24h: { hour: string; count: number }[];
}

export interface AlertsFilter {
  type?: AlertType;
  severity?: Severity;
  status?: AlertStatus;
  ip?: string;
}
