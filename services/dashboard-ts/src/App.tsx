import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchAlert, fetchAlerts, fetchStats, wsUrl } from './api';
import { clearToken, getToken, setToken } from './auth';
import { mergeAlerts, parseWsMessage } from './ws';
import type { Alert, AlertsFilter, AlertStatus, Stats } from './types';
import { ALERT_TYPES, SEVERITIES, STATUSES } from './types';
import { LoginPage } from './components/LoginPage';
import { AlertDetail, formatTime } from './components/AlertDetail';
import { StatsCharts } from './components/Charts';
import './App.css';

const PAGE_SIZE = 20;

function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export default function App(): React.ReactElement {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertsFilter>({});
  const [ipInput, setIpInput] = useState('');
  const [page, setPage] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Alert | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Alert[]>([]);
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  const logout = useCallback((notice?: string) => {
    clearToken();
    setTokenState(null);
    setTimeline([]);
    setStats(null);
    if (notice) setAuthNotice(notice);
    wsRef.current?.close();
  }, []);

  const load = useCallback(async (tok: string, f: AlertsFilter, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const [list, st] = await Promise.all([
        fetchAlerts(tok, { limit: PAGE_SIZE, offset: p * PAGE_SIZE, ...f }),
        fetchStats(tok),
      ]);
      setAlerts(list.alerts);
      setTotal(list.total);
      setStats(st);
    } catch (err) {
      if (isAuthError(err)) {
        logout('Phiên đăng nhập đã hết hạn. Đăng nhập lại.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu.');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (token) load(token, filter, page);
  }, [token, filter, page, load]);

  // WebSocket realtime: snapshot on connect, then deltas merged in.
  // No full-page reload; the table is refreshed by re-fetching only
  // when the user changes filter/page or an alert status changes.
  useEffect(() => {
    if (!token) return;
    setWsState('connecting');
    const ws = new WebSocket(wsUrl(token));
    wsRef.current = ws;
    ws.onopen = () => setWsState('connected');
    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = parseWsMessage(ev.data);
      if (!msg) return;
      if (msg.type === 'snapshot' || msg.type === 'alerts') {
        setTimeline((prev) => mergeAlerts(prev, msg.alerts));
      }
    };
    ws.onclose = () => setWsState('closed');
    ws.onerror = () => setWsState('closed');
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token]);

  function handleLoggedIn(tok: string): void {
    setToken(tok);
    setTokenState(tok);
    setAuthNotice(null);
    setTimeline([]);
    setPage(0);
  }

  async function openDetail(id: number): Promise<void> {
    if (!token) return;
    setDetailError(null);
    try {
      setSelected(await fetchAlert(token, id));
    } catch (err) {
      if (isAuthError(err)) {
        logout('Phiên đăng nhập đã hết hạn. Đăng nhập lại.');
        return;
      }
      setDetailError(err instanceof Error ? err.message : 'Không tải được chi tiết cảnh báo.');
    }
  }

  function handleStatusChanged(updated: Alert): void {
    setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setTimeline((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected(updated);
    if (token) void load(token, filter, page);
  }

  function applyIpFilter(e: React.FormEvent): void {
    e.preventDefault();
    setFilter((f) => ({ ...f, ip: ipInput.trim() || undefined }));
    setPage(0);
  }

  function setFilterField<K extends keyof AlertsFilter>(key: K, value: AlertsFilter[K]): void {
    setFilter((f) => ({ ...f, [key]: value || undefined }));
    setPage(0);
  }

  if (!token) {
    return (
      <>
        {authNotice && <p className="notice" role="alert">{authNotice}</p>}
        <LoginPage onLoggedIn={handleLoggedIn} />
      </>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="dashboard">
      <header>
        <h1>Sec Event Pipeline — Cảnh báo bảo mật</h1>
        <div>
          <span>Realtime (WS): {wsState === 'connected' ? 'đang kết nối' : wsState === 'connecting' ? 'đang kết nối…' : 'mất kết nối'}</span>
          {' '}
          <button onClick={() => logout()}>Đăng xuất</button>
        </div>
      </header>

      {stats && (
        <section aria-label="Tổng quan">
          <p><strong>Tổng số cảnh báo: {stats.total}</strong></p>
          <StatsCharts stats={stats} />
        </section>
      )}

      <section aria-label="Bộ lọc">
        <form onSubmit={applyIpFilter} className="filters">
          <label>
            Loại
            <select value={filter.type ?? ''} onChange={(e) => setFilterField('type', e.target.value as AlertsFilter['type'])}>
              <option value="">Tất cả</option>
              {ALERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            Mức độ
            <select value={filter.severity ?? ''} onChange={(e) => setFilterField('severity', e.target.value as AlertsFilter['severity'])}>
              <option value="">Tất cả</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Trạng thái
            <select value={filter.status ?? ''} onChange={(e) => setFilterField('status', e.target.value as AlertStatus)}>
              <option value="">Tất cả</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            IP
            <input value={ipInput} onChange={(e) => setIpInput(e.target.value)} placeholder="vd: 1.2.3.4" />
          </label>
          <button type="submit">Lọc theo IP</button>
          <button type="button" onClick={() => { setFilter({}); setIpInput(''); setPage(0); }}>Xóa bộ lọc</button>
        </form>
      </section>

      {loading && <p>Đang tải cảnh báo…</p>}
      {error && (
        <div className="error" role="alert">
          <p>Không tải được dữ liệu: {error}</p>
          <button onClick={() => load(token, filter, page)}>Thử lại</button>
        </div>
      )}
      {detailError && <p className="error" role="alert">{detailError}</p>}
      {!loading && !error && alerts.length === 0 && (
        <p>Chưa có cảnh báo nào{Object.keys(filter).length ? ' khớp với bộ lọc' : ''}.</p>
      )}
      {!error && alerts.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>Thời gian</th><th>IP</th><th>Loại</th><th>Mức độ</th>
                <th>Số lần</th><th>Lần đầu</th><th>Lần cuối</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} onClick={() => void openDetail(a.id)} className="clickable">
                  <td>{formatTime(a.created_at)}</td>
                  <td>{a.ip}</td>
                  <td>{a.type}</td>
                  <td>{a.severity}</td>
                  <td>{a.count}</td>
                  <td>{formatTime(a.first_seen)}</td>
                  <td>{formatTime(a.last_seen)}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>← Trước</button>
            <span>Trang {page + 1} / {pageCount} — tổng {total} cảnh báo</span>
            <button disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Sau →</button>
          </div>
        </>
      )}

      <section aria-label="Timeline realtime">
        <h2>Timeline realtime (WebSocket)</h2>
        {wsState !== 'connected' && <p>Chưa kết nối realtime — timeline sẽ cập nhật khi WebSocket nối lại.</p>}
        {timeline.length === 0 ? (
          <p>Chưa nhận được cảnh báo nào qua realtime.</p>
        ) : (
          <ul>
            {timeline.map((a) => (
              <li key={a.id}>
                {formatTime(a.created_at)} — {a.ip} — {a.type} ({a.severity}) ×{a.count} — {a.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <AlertDetail
          alert={selected}
          token={token}
          onClose={() => setSelected(null)}
          onStatusChanged={handleStatusChanged}
          onAuthExpired={() => logout('Phiên đăng nhập đã hết hạn. Đăng nhập lại.')}
        />
      )}
    </main>
  );
}
