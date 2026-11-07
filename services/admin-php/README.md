# admin-php

Trang quản trị riêng của container-platform: tổng quan alerts, quản trị
người dùng, luật phát hiện, cấu hình hệ thống. PHP 8.3, Slim 4,
nginx + php-fpm trong cùng một container, PostgreSQL chung (`sec_events`).

## Vì sao Slim 4, không phải Laravel

Chỉ cần vài route + form, không cần ORM, queue, job, scheduler hay blade
của Laravel. Slim 4 nhẹ, ít bề mặt tấn công, dễ kiểm chứng từng route, và
đủ cho một trang quản trị nội bộ. Template dùng PHP thuần (không thêm
Twig), query dùng PDO prepared statement trực tiếp.

## Vì sao 1 container, không phải 2

nginx và php-fpm cùng vòng đời, chỉ có một cổng (8080 trong container),
php-fpm chỉ nghe loopback `127.0.0.1:9000` nên không lộ ra ngoài. Tách
2 container chỉ thêm một network hop mà không thêm lợi ích gì ở quy mô này.

## Route

Mọi route quản trị yêu cầu đăng nhập session; `/healthz` và `/readyz`
không yêu cầu. Đăng nhập dùng **session riêng**, không dùng JWT của
api-node (hai hệ xác thực khác nhau, ghi rõ để khỏi nhầm).

| Route | Mô tả |
| --- | --- |
| `GET /healthz` | 200 khi process sống |
| `GET /readyz` | 200 chỉ khi ping được Postgres, 503 khi không |
| `GET /login`, `POST /login` | Đăng nhập session |
| `POST /logout` | Đăng xuất |
| `GET /dashboard` | Đếm alerts từ DB thật (tổng, theo type/severity/status, 10 alert mới nhất) |
| `GET /users`, `GET /users/new`, `POST /users` | Danh sách / tạo người dùng (chỉ admin) |
| `GET /users/{id}/edit`, `POST /users/{id}/edit`, `POST /users/{id}/delete` | Sửa / xóa người dùng (chỉ admin) |
| `GET /rules`, `POST /rules` | Xem / sửa luật phát hiện (admin, operator) |
| `GET /settings`, `POST /settings`, `POST /settings/new` | Xem / sửa / thêm cấu hình hệ thống (admin, operator) |

Quyền: `admin` (toàn quyền), `operator` (luật + cấu hình, không quản lý
người dùng), `viewer` (chỉ xem). Không được tự xóa tài khoản của mình,
không được tự đổi quyền của mình, không được xóa admin cuối cùng.

## Cơ sở dữ liệu

Dùng chung DB `sec_events` với analyzer/api-node. Bảng `alerts` do
analyzer tạo, admin-php chỉ đọc. Migration thật ở
`migrations/001_admin_schema.sql`, chạy khi container khởi động
(`bin/migrate.php`, thử lại tối đa 30s) và lần đầu mỗi php-fpm worker
tạo app:

| Bảng | Cột |
| --- | --- |
| `app_users` | `id`, `username` unique, `password_hash`, `role`, `created_at` |
| `detection_rules` | `key` (PK), `value`, `description`, `updated_at` |
| `settings` | `key` (PK), `value`, `description`, `updated_at` |

Tài khoản seed **chỉ** qua env `ADMIN_USER` / `ADMIN_PASSWORD`, và
**chỉ** tạo khi bảng `app_users` còn trống. Không đặt env thì không tạo
gì cả, log warning `admin_seed_missing`, và chưa ai đăng nhập được cho
tới khi đặt env rồi restart container. Không có user/pass hardcode.

## Luật phát hiện — giới hạn quan trọng

Bảng `detection_rules` có đúng 5 key khớp tên/tham số analyzer đang dùng
(`BRUTE_FORCE_THRESHOLD`, `BRUTE_FORCE_WINDOW_SECONDS`,
`PORT_SCAN_THRESHOLD`, `PORT_SCAN_WINDOW_SECONDS`,
`ALERT_COOLDOWN_SECONDS`), seed lần đầu từ env tương ứng.

**Đổi rule trong trang quản trị CHƯA tự áp dụng cho analyzer đang chạy.**
Analyzer-python đọc ngưỡng từ biến môi trường khi khởi động và không tự
reload khi DB đổi. Muốn áp dụng: sửa giá trị tương ứng trong `.env` rồi
restart analyzer:

```bash
docker compose up -d --force-recreate analyzer-python
```

Bảng `detection_rules` lúc này chỉ là nguồn cấu hình để người vận hành
xem/sửa, không phải kênh điều khiển analyzer. Giới hạn này ghi rõ cả ở
trang luật trong UI.

## Cấu hình hệ thống — phạm vi

Bảng `settings` chỉ chứa cấu hình chung mà trang quản trị này đọc:
`site.title` (tiêu đề trang), `alerts.page_size` (số alert gần nhất trên
tổng quan, kẹp 5–50). Thêm key khác chỉ lưu vào DB; chỉ các key mà code
đọc mới có tác dụng thật. `settings` **không** điều khiển collector-go,
analyzer-python hay api-node — các service đó vẫn đọc env của chính chúng.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `localhost` / `5432` / `secuser` / `change-me` / `sec_events` | Postgres (hoặc `DATABASE_URL` thay cho tất cả) |
| `ADMIN_PORT` | `8082` | Cổng host map ra nginx 8080 trong container |
| `ADMIN_USER` / `ADMIN_PASSWORD` | _(trống = không seed)_ | Tài khoản seed duy nhất, chỉ tạo khi bảng trống |
| `ADMIN_SESSION_SECURE` | `0` | `1` để cookie session có flag Secure (bật khi dùng sau HTTPS) |
| `ADMIN_SESSION_LIFETIME_MINUTES` | `60` | Hạn session (gc_maxlifetime) |
| `BRUTE_FORCE_THRESHOLD` / `BRUTE_FORCE_WINDOW_SECONDS` / `PORT_SCAN_THRESHOLD` / `PORT_SCAN_WINDOW_SECONDS` / `ALERT_COOLDOWN_SECONDS` | `5` / `300` / `5` / `60` / `3600` | Chỉ dùng để seed `detection_rules` lần đầu |
| `APP_ENV` | `production` | `development` mới hiện chi tiết lỗi |
| `LOG_LEVEL` | `info` | Mức log tối thiểu |

## Chạy local

Cần PHP 8.3 + Composer 2 + PostgreSQL thật (hoặc chạy đủ stack bằng
compose ở root):

```bash
cd services/admin-php
composer install
ADMIN_USER=admin ADMIN_PASSWORD='doi-mat-khau-that' \
  php -S 127.0.0.1:8082 -t public
```

Mở `http://localhost:8082/login`, đăng nhập bằng tài khoản seed.
Với compose ở root: `docker compose up --build -d`, mở
`http://localhost:${ADMIN_PORT:-8082}`.

## Kiểm tra bằng curl

```bash
curl -s http://localhost:8082/healthz
curl -s -i http://localhost:8082/readyz   # 503 khi chưa có Postgres
curl -s -i http://localhost:8082/dashboard  # 302 về /login khi chưa đăng nhập
```

Đăng nhập bằng form (lấy CSRF token từ trang login rồi POST):

```bash
curl -s -c cookies.txt http://localhost:8082/login -o login.html
TOKEN=$(grep -o 'name="csrf_token" value="[^"]*"' login.html | cut -d'"' -f4)
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8082/login \
  -d "csrf_token=$TOKEN&username=admin&password=doi-mat-khau-that" -o /dev/null -w '%{http_code}\n'
curl -s -b cookies.txt http://localhost:8082/dashboard | head -c 400
```

Kết quả đúng: login trả 302 về `/dashboard`; dashboard hiển thị số đếm
khớp với `SELECT COUNT(*) FROM alerts;` trong Postgres.

## Log, shutdown, bảo mật

- Log JSON một dòng một object (`timestamp`, `level`, `msg`, `context`)
  ra stdout (info trở xuống) / stderr (error trở lên). Không log body
  request, không log mật khẩu/token/hash (key context trùng các từ đó bị
  thay bằng `[redacted]`).
- Graceful shutdown: entrypoint là PID 1, trap SIGTERM/SIGINT rồi gửi
  SIGTERM cho cả nginx (fast shutdown) và php-fpm (graceful: cho request
  đang chạy xong rồi thoát), chờ cả hai thoát mới kết thúc.
- Mật khẩu: `password_hash` (Argon2id khi có, ngược lại
  `PASSWORD_DEFAULT`) + `password_verify`; tự rehash khi thuật toán đổi.
- Session cookie: HttpOnly + SameSite=Lax (+ Secure khi
  `ADMIN_SESSION_SECURE=1`), `use_strict_mode`, `use_only_cookies`,
  regenerate id khi đăng nhập.
- Mọi query dùng prepared statement (PDO, `EMULATE_PREPARES=false`).
  Mọi form POST có token CSRF (so bằng `hash_equals`). Mọi giá trị hiển
  thị đều qua `htmlspecialchars`. Không lộ secret trong log/error.
- Chống dò mật khẩu cơ bản: sai 5 lần trong một session thì khóa đăng
  nhập 15 phút. Đây là khóa theo session (đổi cookie thì qua được), không
  phải rate limit hạ tầng — nếu cần chống dò thật thì đặt thêm rate limit
  ở reverse proxy / fail2ban trước service này.

## Test

```bash
composer install
vendor/bin/phpunit --testdox
```

Test gồm: hash/verify mật khẩu, validate username/password/role/rule/
setting key, CSRF token, route `/healthz` (200 không cần DB) và `/readyz`
(503 khi không có DB). Chưa có test cần DB thật (login, CRUD, rules):
cần Postgres thật để chạy các luồng đó, xem mục “Chưa kiểm chứng”.

## Dockerfile

Multi-stage: stage `composer:2` chạy `composer install --no-dev`
rồi copy `vendor/`; image cuối `php:8.3-fpm` + nginx (cài bằng apt) +
`pdo_pgsql` (build bằng `docker-php-ext-install`). Cả nginx và php-fpm
chạy dưới user non-root `admin` (uid 10001): nginx listen cổng 8080
(không bind được cổng < 1024 khi non-root), pid/log/temp path đều trỏ
`/tmp` hoặc stdout/stderr; session lưu ở `/tmp/php-sessions`.
HEALTHCHECK dùng chính binary `php` trong image để gọi `/healthz`
(image `php:8.3-fpm` không có sẵn curl/wget nên không dùng chúng).

### Về composer.lock

Repo hiện **chưa có** `composer.lock` vì máy phát triển không có
PHP/Composer để sinh lock thật (không bịa file lock giả). Các dependency
trực tiếp đã ghim version chính xác trong `composer.json` (kiểm chứng
trên Packagist ngày 2026-11-07: `slim/slim` 4.15.3, `slim/psr7` 1.8.0 —
lưu ý tên gói đúng là `slim/psr7`, không phải `slim/psr-7` —
`vlucas/phpdotenv` 5.8.0, `psr/log` 3.0.2, `phpunit/phpunit` 11.5.57).
Sinh lock thật trước khi build production, trên máy có PHP 8.3 +
Composer 2:

```bash
cd services/admin-php
composer update --lock && composer install
git add composer.lock
```

## Chưa kiểm chứng

- Chưa chạy `php -l` / PHPUnit (máy này không có PHP/Composer).
- Chưa sinh `composer.lock` thật (xem trên).
- Chưa chạy `docker compose up`, chưa build image Docker thật, chưa chạy
  admin với Postgres thật (máy này không có Docker/Postgres).
- Chưa kiểm tra luồng login/session/CRUD/rules trên trình duyệt thật.
- Login throttle theo session chưa được test tải thật.
