import { useState } from 'react';
import { patchAlertStatus } from '../api';
import type { Alert, AlertStatus } from '../types';
import { STATUSES } from '../types';

export function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('vi-VN');
}

export function AlertDetail(props: {
  alert: Alert;
  token: string;
  onClose: () => void;
  onStatusChanged: (alert: Alert) => void;
  onAuthExpired: () => void;
}): React.ReactElement {
  const { alert, token } = props;
  const [status, setStatus] = useState<AlertStatus>(alert.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (status === alert.status) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await patchAlertStatus(token, alert.id, status);
      props.onStatusChanged(updated);
    } catch (err) {
      if (err instanceof Error && err.message.includes('hết hạn')) {
        props.onAuthExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Đổi trạng thái thất bại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-label={`Chi tiết cảnh báo ${alert.id}`} onClick={(e) => e.stopPropagation()}>
        <h2>Cảnh báo #{alert.id}</h2>
        <dl>
          <dt>Thời gian tạo</dt><dd>{formatTime(alert.created_at)}</dd>
          <dt>IP</dt><dd>{alert.ip}</dd>
          <dt>Loại</dt><dd>{alert.type}</dd>
          <dt>Mức độ</dt><dd>{alert.severity}</dd>
          <dt>Số lần</dt><dd>{alert.count}</dd>
          <dt>Lần đầu</dt><dd>{formatTime(alert.first_seen)}</dd>
          <dt>Lần cuối</dt><dd>{formatTime(alert.last_seen)}</dd>
          <dt>Trạng thái</dt><dd>{alert.status}</dd>
        </dl>
        <h3>Evidence (JSON)</h3>
        <pre>{JSON.stringify(alert.evidence, null, 2)}</pre>
        <label>
          Đổi trạng thái
          <select value={status} onChange={(e) => setStatus(e.target.value as AlertStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button onClick={save} disabled={busy || status === alert.status}>
            {busy ? 'Đang lưu…' : 'Lưu trạng thái'}
          </button>
          <button onClick={props.onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
