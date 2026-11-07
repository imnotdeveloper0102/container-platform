import { useState } from 'react';
import { login } from '../api';

export function LoginPage(props: { onLoggedIn: (token: string) => void }): React.ReactElement {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await login(username, password);
      props.onLoggedIn(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Sec Event Pipeline — Đăng nhập</h1>
      <p>Tài khoản do quản trị viên cấp qua biến môi trường của api-node (API_ADMIN_USER / API_ADMIN_PASSWORD). Dashboard không lưu sẵn tài khoản nào.</p>
      <form onSubmit={submit}>
        <label>
          Tên đăng nhập
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </main>
  );
}
