# dashboard-ts

Giao diện xem cảnh báo cho container-platform (phần 4): React 18 +
Vite 6 + TypeScript strict, build tĩnh rồi phục vụ bằng nginx.

**Không có dữ liệu mẫu trong UI.** Mọi số liệu đều từ api-node thật
(REST `/api/alerts`, `/api/stats`, PATCH status, WebSocket `/ws`).
Khi chưa có alert thật, bảng hiển thị "Chưa có cảnh báo nào". Khi API
chết hoặc trả lỗi, UI hiển thị thông báo lỗi + nút "Thử lại", không
hiển thị bảng trống giả vờ như không có alert. Dữ liệu mẫu chỉ tồn
tại trong test (`src/test/`, ghi rõ ở đầu file test).

## Tính năng

- Trang login: `POST /api/auth/login`, token lưu ở **sessionStorage**
  (mất khi đóng tab). Không hardcode tài khoản hay token. Hết hạn /
  token sai (401) thì quay lại trang login kèm thông báo.
- Bảng alerts: cột thời gian, IP, loại, severity, count, first/last
  seen, status. Filter đúng query param của API (`type`, `severity`,
  `status`, `ip`), phân trang `limit`/`offset` (20/trang).
- Chi tiết 1 alert: bấm vào dòng → `GET /api/alerts/:id`, evidence
  hiển thị dạng JSON, đổi status qua `PATCH /api/alerts/:id/status`
  (`open` / `acknowledged` / `resolved`).
- Biểu đồ: vẽ từ `/api/stats` thật (`by_type`, `by_severity`,
  `by_day_last_7d`, `by_hour_last_24h`). **Lựa chọn: tự vẽ SVG** thay
  vì thư viện biểu đồ (recharts không được dùng) — dữ liệu là các
  series nhỏ cố định, tự vẽ đủ dùng và khỏi thêm dependency cần ghim.
- Timeline realtime: WebSocket `/ws?token=<jwt>` — nhận snapshot 50
  alert mới nhất rồi merge delta vào danh sách (upsert theo id, giữ
  `created_at` DESC, tối đa 50), không reload toàn trang. Cơ chế thật
  bên api-node là poll bảng alerts mỗi 2s, không phải pub/sub.

## Cấu hình (env Vite, bake lúc build)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `VITE_API_URL` | _(trống = relative path)_ | Base URL của api-node. Trong compose để trống, nginx proxy `/api` và `/ws` tới `api-node:3000`. Chạy ngoài compose thì đặt `http://localhost:3000`. |
| `VITE_WS_URL` | _(suy ra từ VITE_API_URL hoặc origin)_ | Override URL WebSocket, ví dụ `ws://localhost:3000/ws`. |

## Chạy local (cần api-node thật đang chạy ở :3000)

```bash
cd services/dashboard-ts
npm ci
npm run dev     # http://localhost:5173 — Vite proxy /api và /ws sang localhost:3000
```

## Kiểm tra

```bash
npm ci
npm test        # vitest: API layer với fetch mock + merge WS (xem src/test/)
npm run build   # tsc --noEmit + vite build -> dist/
```

## Docker / compose

```bash
docker compose up --build -d   # dashboard ở http://localhost:${DASHBOARD_PORT:-8081}
```

Image multi-stage: build `node:20-slim` (`npm ci`, `npm run build`),
chạy `nginx:alpine` với user non-root `nginx`, `HEALTHCHECK` bằng
`wget` tới `/`. Build arg `VITE_API_URL` (mặc định trống = gọi
relative qua nginx proxy).

## Chưa kiểm chứng

- Chưa chạy với api-node/Postgres/Redis thật (máy này không có), chưa
  chạy `docker compose up`, chưa build image Docker thật, chưa mở
  dashboard trên trình duyệt thật với API thật.
