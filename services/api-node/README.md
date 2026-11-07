# api-node

REST API + WebSocket realtime đọc cảnh báo từ PostgreSQL thật
(bảng `alerts` do analyzer-python ghi). Pure JavaScript, Node.js 20,
Express 4. Không có TypeScript nên không có bước build (`npm run build`
không tồn tại); `npm ci` + `npm test` là đủ để kiểm chứng.

## API

Mọi route `/api/*` (trừ login) và `/ws` yêu cầu JWT hợp lệ.
`/healthz`, `/readyz`, `POST /api/auth/login` không yêu cầu.

| Route | Mô tả |
| --- | --- |
| `GET /healthz` | 200 khi process sống |
| `GET /readyz` | 200 chỉ khi ping được cả Postgres và Redis, 503 khi không |
| `POST /api/auth/login` | `{username, password}` → `{token, expires_in}` |
| `GET /api/alerts?limit=&offset=&type=&severity=&status=&ip=` | List, `created_at DESC`, limit 1–100 (mặc định 20), offset ≥ 0 |
| `GET /api/alerts/:id` | Một alert, 404 khi không có |
| `PATCH /api/alerts/:id/status` | `{status: open\|acknowledged\|resolved}`, 400 khi sai giá trị, 404 khi không có |
| `GET /api/stats` | Tổng số, đếm theo type, theo severity, theo ngày (7 ngày gần đây), theo giờ (24 giờ gần đây) — tất cả tính từ DB thật |
| `WS /ws?token=<jwt>` | Realtime (xem dưới) |

Loại alert: `brute_force | port_scan | sqli`.
Severity: `low | medium | high`. Status: `open | acknowledged | resolved`.

## WebSocket realtime — cơ chế thật: POLLING, không phải pub/sub

Analyzer **không publish** gì lên Redis (nó chỉ đọc `events:queue`
và ghi Postgres), nên không có channel pub/sub nào để subscribe.
Vì vậy api-node **poll bảng `alerts` mỗi `WS_POLL_INTERVAL_MS`
(mặc định 2000 ms)**, tìm các dòng có `last_seen` vượt qua watermark
`(last_seen, id)` đã thấy, và chỉ broadcast các dòng mới/cập nhật đó
cho client đang kết nối. Khi kết nối, client nhận trước một snapshot
50 alert mới nhất (`{type: "snapshot", alerts: [...]}`), sau đó nhận
delta (`{type: "alerts", alerts: [...]}`). Không có dữ liệu mẫu nào
được gửi. Client kết nối bằng JWT qua query param vì trình duyệt
không đặt được header `Authorization` trên WebSocket handshake:
`ws://localhost:3000/ws?token=<jwt>`.

## Xác thực

- Admin user/password **chỉ** qua env `API_ADMIN_USER` /
  `API_ADMIN_PASSWORD`. Không đặt → login trả 503 `login_disabled`.
  Không có user/pass mặc định hardcode.
- JWT secret **chỉ** qua env `JWT_SECRET`. Không đặt → server từ
  chối khởi động (thoát code 1, log rõ lý do); login cũng trả 503
  `jwt_not_configured` nếu tới được đó.
- Token hết hạn theo `JWT_EXPIRES_IN` (mặc định `1h`).
- Login bị rate limit: mặc định 10 lần / 15 phút / IP
  (`LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`).

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `3000` | Listen |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `localhost` / `5432` / `secuser` / `change-me` / `sec_events` | Postgres (hoặc `DATABASE_URL` thay cho tất cả) |
| `REDIS_ADDR` | `localhost:6379` | Redis, dạng `host:port` (trong compose: `redis:6379`) |
| `REDIS_PASSWORD` / `REDIS_DB` | `` / `0` | Redis |
| `API_ADMIN_USER` / `API_ADMIN_PASSWORD` | _(trống = login tắt)_ | Tài khoản seed duy nhất |
| `JWT_SECRET` | _(bắt buộc)_ | Secret ký JWT |
| `JWT_EXPIRES_IN` | `1h` | Hạn token |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` | `10` / `900000` | Rate limit login |
| `WS_POLL_INTERVAL_MS` | `2000` | Khoảng poll bảng alerts cho WS |
| `PG_CONNECTION_TIMEOUT_MS` / `PG_QUERY_TIMEOUT_MS` | `5000` / `5000` | Timeout pg pool |
| `REDIS_CONNECT_TIMEOUT_MS` | `5000` | Timeout kết nối Redis |

## Chạy local

```bash
cd services/api-node
npm ci
JWT_SECRET='doi-secret-that-truoc-khi-dung-that' \
API_ADMIN_USER=admin API_ADMIN_PASSWORD='doi-mat-khau-that' \
node src/server.js
```

Cần Postgres + Redis thật đang chạy (xem compose ở root).

## Kiểm tra bằng curl

```bash
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/readyz   # 503 khi chưa có Postgres/Redis

TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"doi-mat-khau-that"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -s "http://localhost:3000/api/alerts?limit=10&type=brute_force" \
  -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/alerts/1 -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/stats -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH http://localhost:3000/api/alerts/1/status \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"acknowledged"}'
```

WebSocket (cần `websocat` hoặc client WS, token lấy như trên):

```bash
websocat "ws://localhost:3000/ws?token=$TOKEN"
```

## Log, shutdown, retry

- Log JSON một dòng một object (`timestamp`, `level`, `msg`,
  `request_id`, `method`, `path`, `status`, ...) ra stdout.
- Graceful shutdown SIGTERM/SIGINT: dừng poller WS, đóng WS + HTTP
  server, đóng pg pool và Redis client (ép thoát sau 10s nếu kẹt).
- Retry/timeout: pg pool `connectionTimeoutMillis` + `query_timeout`
  5s, query retry tối đa 2 lần; Redis `connectTimeout` 5s,
  `maxRetriesPerRequest: 3`, reconnect backoff tối đa 5 lần;
  `/readyz` ping cả hai với timeout riêng.

## Test

```bash
npm test   # Jest + Supertest
```

Test chạy với **test double** (FakePool/FakeRedis trong `tests/fakes.js`),
không cần Postgres/Redis thật — code production không mock gì, chỉ
test inject fake qua `createApp()`. Test bao gồm: health/readyz khi
DB/Redis chết, login sai / thiếu secret / login tắt, rate limit login,
list + filter + phân trang, 404, PATCH status, stats, WS snapshot +
delta, và server từ chối khởi động khi thiếu `JWT_SECRET` (spawn tiến
trình thật). Xem `tests/*.test.js` để biết test nào dùng fake.

## Chưa kiểm chứng

- Chưa chạy với Postgres/Redis thật (máy này không có), chưa chạy
  `docker compose up`, chưa build image Docker thật — các test trên
  chỉ chứng minh logic HTTP/WS/auth với test double.
