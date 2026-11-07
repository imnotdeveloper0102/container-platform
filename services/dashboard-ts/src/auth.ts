// Token storage: sessionStorage (token mất khi đóng tab/trình duyệt,
// không lưu vĩnh viễn như localStorage). Không hardcode tài khoản hay
// token ở bất cứ đâu — token chỉ đến từ POST /api/auth/login.
const TOKEN_KEY = 'container-platform.token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}
