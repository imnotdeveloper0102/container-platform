# container-platform

Chỉ quét/chặn tài sản của mình hoặc được phép, đừng để lọt secret hay tài khoản thật vào project

Tên chính thức của project là `container-platform`.
Đây là project RIÊNG, không sửa `logbanner` và không sửa `secscan`.

Nền tảng thu thập và phân tích sự kiện bảo mật. Dữ liệu lấy từ log thật
(nginx/auth log) và các sự kiện hệ thống tự sinh khi chạy. Tuyệt đối không
hardcode dữ liệu giả, không mock, không TODO, không code giả.

## Trạng thái: xong PHẦN 1 + PHẦN 2 + PHẦN 3 + PHẦN 4 + PHẦN 5 + PHẦN 6

Phần 6 gồm: `k8s/` (Kustomize base + overlays dev/prod: Deployment/
Service/ConfigMap/Secret cho 5 service, StatefulSet Postgres + Redis,
Ingress nginx, HPA, NetworkPolicy, PDB; xem `k8s/README.md`).

Phần 1 gồm: `collector-go` + PostgreSQL + Redis + docker-compose + Makefile.
Phần 2 gồm: `analyzer-python` (đọc queue Redis, phát hiện brute force /
scan port / SQLi, ghi cảnh báo vào PostgreSQL).
Phần 3 gồm: `api-node` (REST API + WebSocket realtime đọc bảng alerts,
JWT, port 3000; xem `services/api-node/README.md`). WebSocket dùng
**poll bảng alerts** (mặc định 2s), không phải Redis pub/sub — analyzer
không publish gì lên Redis.
Phần 4 gồm: `dashboard-ts` (React + Vite + TypeScript, bảng alerts +
filter/phân trang, biểu đồ từ `/api/stats`, timeline realtime qua WS,
login JWT; xem `services/dashboard-ts/README.md`). Biểu đồ tự vẽ SVG,
không dùng thư viện biểu đồ. Dashboard phục vụ qua nginx, proxy `/api`
và `/ws` tới api-node.
Phần 5 gồm: `admin-php` (PHP 8.3 + Slim 4, nginx + php-fpm trong cùng
một container, trang quản trị riêng: tổng quan alerts, quản trị người
dùng, luật phát hiện, cấu hình hệ thống; đăng nhập session riêng, không
dùng JWT của api-node; xem `services/admin-php/README.md`).
**Giới hạn:** đổi luật phát hiện trong trang quản trị chỉ lưu vào bảng
`detection_rules`, analyzer-python vẫn đọc ngưỡng từ biến môi trường khi
khởi động nên chưa tự áp dụng cho analyzer đang chạy — cần sửa `.env`
rồi restart analyzer.
Các phần sau CHƯA LÀM: không còn — đã xong 6 phần. Giới hạn của phần 6:
manifest chưa chạy được trên máy phát triển (không có Docker/kubectl/
kustomize/kind/minikube) nên chỉ validate YAML bằng python + kiểm tra
chéo, chưa có `kustomize build` hay `kubectl apply --dry-run` thật;
script tạo cluster chưa chạy; Secret chỉ là placeholder `change-me`,
phải thay bằng secret thật trước khi dùng thật; admin dưới prefix
`/admin` chỉ mở được trang, luồng đăng nhập bị gãy do redirect tuyệt
đối của app — dùng thật thì cho admin một host riêng (xem
`k8s/README.md`).

## Cây thư mục (toàn project)

```text
container-platform/
  README.md
  Makefile
  docker-compose.yml
  .env.example
  .dockerignore
  services/
    collector-go/            # PHẦN 1 — xong: Go 1.22, HTTP + TCP, Redis queue
      main.go
      config.go
      event.go
      publisher.go
      server.go
      *_test.go
      go.mod
      go.sum
      Dockerfile
      .dockerignore
    analyzer-python/         # PHẦN 2 — xong: Python 3.12 FastAPI, Redis
      app/                   #   consumer + detector + store, pytest 16 test
      tests/
      requirements.txt       #   + requirements.lock (pip freeze)
      Dockerfile
      .dockerignore
    api-node/                # PHẦN 3 — xong: Node 20 Express, REST + WS, JWT
      src/                   #   app.js / auth.js / ws.js (poll, không pub/sub)
      tests/                 #   Jest + Supertest, 28 test (test double)
      package.json           #   + package-lock.json, Dockerfile, README.md
    dashboard-ts/            # PHẦN 4 — xong: React + Vite + TS, nginx
      src/                   #   bảng alerts, biểu đồ SVG, timeline WS, login
      package.json           #   + package-lock.json, Dockerfile, README.md
    admin-php/               # PHẦN 5 — xong: PHP 8.3 + Slim 4, nginx + php-fpm
      public/index.php       #   1 container, session riêng (không dùng JWT api-node)
      src/                   #   Config/Database/Auth/Csrf/Validation/View/Migrations
      templates/             #   tổng quan, users, rules, settings (PHP thuần)
      migrations/            #   001_admin_schema.sql (app_users, detection_rules, settings)
      tests/                 #   PHPUnit: hash, validation, CSRF, health/readyz
      Dockerfile             #   + nginx.conf, php-fpm.conf, php.ini, composer.json
  k8s/                       # PHẦN 6 — xong: Kustomize base + overlays dev/prod
    README.md                #   cách deploy, secret, giới hạn Ingress admin
    base/
      kustomization.yaml     #   namespace, serviceaccount, 5 service,
      namespace.yaml         #   postgres/redis StatefulSet, ingress,
      serviceaccount.yaml    #   hpa, networkpolicy, pdb
      collector.yaml analyzer.yaml api.yaml dashboard.yaml admin.yaml
      postgres.yaml redis.yaml ingress.yaml hpa.yaml
      networkpolicy.yaml pdb.yaml
    overlays/dev/            #   namespace container-platform-dev, ít replica/resource
      kustomization.yaml
    overlays/prod/           #   namespace container-platform, 2 replica, PVC/HPA lớn
      kustomization.yaml
  scripts/                   # PHẦN 6 — xong: tạo cluster + load image
    kind-cluster.sh          #   (CHƯA chạy được: máy này không có docker/kind)
    minikube-cluster.sh      #   (CHƯA chạy được: máy này không có docker/minikube)
```

## collector-go làm gì

- HTTP `POST /ingest` nhận một dòng log (JSON `{"raw": "..."}` hoặc text thuần).
- TCP `:9000` nhận log từng dòng, mỗi dòng một event.
- Chuẩn hoá mỗi dòng thành event JSON:
  `timestamp`, `source`, `source_ip`, `type`, `raw`.
  `type` chỉ là phân loại thô để định tuyến (`auth_failed`, `auth_success`,
  `http_access`, `sqli_suspect`, `generic`), không phải kết luận phát hiện.
- Đẩy event vào Redis list `events:queue` (mặc định), timeout 2s, retry 3 lần.
- `GET /healthz` luôn trả 200 khi process đang chạy.
  `GET /readyz` ping Redis, trả 200 khi Redis reachable, 503 khi không.
- Log JSON có cấu trúc (slog), config qua biến môi trường, graceful
  shutdown khi nhận SIGTERM/SIGINT (dừng HTTP/TCP, flush ngắn rồi thoát).
- Worker pool 8 worker (mặc định), channel đệm 1000 event.

## Biến môi trường (collector-go)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `HTTP_ADDR` | `:8080` | HTTP listen |
| `TCP_ADDR` | `:9000` | TCP listen |
| `REDIS_ADDR` | `localhost:6379` | Redis (trong compose: `redis:6379`) |
| `REDIS_PASSWORD` | `` | Mật khẩu Redis |
| `REDIS_DB` | `0` | Redis DB |
| `REDIS_QUEUE` | `events:queue` | Tên Redis list |
| `WORKER_COUNT` | `8` | Số worker đẩy Redis |
| `QUEUE_BUFFER` | `1000` | Độ dài channel đệm |
| `PUSH_TIMEOUT_MS` | `2000` | Timeout mỗi lần đẩy Redis |

## Chạy local (phần 1)

Yêu cầu: Go 1.22, Docker + Docker Compose (để chạy đủ stack).

```bash
cp .env.example .env
# Sửa mật khẩu trong .env trước khi dùng thật.
docker compose up --build
```

Chỉ chạy collector với Redis local (không cần Docker cho collector):

```bash
# Terminal 1: chạy Redis local (cần redis-server)
# Terminal 2:
cd services/collector-go
go run .
```

## Kiểm tra collector hoạt động

Health / readiness:

```bash
curl -s http://localhost:8080/healthz
curl -s http://localhost:8080/readyz
```

Gửi log qua HTTP (JSON):

```bash
curl -s -X POST http://localhost:8080/ingest \
  -H 'Content-Type: application/json' \
  -d '{"raw":"Failed password for root from 1.2.3.4 port 22 ssh2","source":"http","source_ip":"1.2.3.4"}'
```

Gửi log qua HTTP (text thuần, ví dụ một dòng nginx log thật):

```bash
curl -s -X POST http://localhost:8080/ingest \
  --data-binary '192.168.1.10 - - [07/Nov/2026:10:00:00 +0700] "GET /index.html HTTP/1.1" 200 1234'
```

Gửi log qua TCP (`nc` trên một số máy không tự thoát, nên dùng `timeout`):

```bash
printf 'Failed password for root from 1.2.3.4 port 22 ssh2\n' | timeout 2 nc localhost 9000
# Hoặc bằng Python (không cần nc):
python3 -c "import socket; s=socket.create_connection(('127.0.0.1',9000)); s.sendall(b'Failed password for root from 1.2.3.4 port 22 ssh2\n'); s.close()"
```

Kiểm tra Redis (event đã vào queue):

```bash
docker compose exec redis redis-cli LLEN events:queue
docker compose exec redis redis-cli LRANGE events:queue 0 0
```

Kết quả đúng: `LLEN` tăng lên sau mỗi lần gửi, `LRANGE` trả về một event
JSON có đủ `timestamp`, `source`, `source_ip`, `type`, `raw`.

## analyzer-python làm gì (phần 2)

- Đọc event từ Redis list `events:queue` bằng `BRPOPLPUSH` sang list
  `events:processing`: event chỉ bị xóa khỏi processing sau khi phát
  hiện + ghi DB xong; lỗi tạm thời thì event được đẩy lại queue để
  retry; process chết giữa chừng thì event còn nằm trong processing và
  được requeue khi khởi động lại — không mất event vì lỗi tạm thời.
- Phát hiện: brute force (mặc định 5 lần `auth_failed` từ một IP trong
  300s), scan port (5 cổng đích khác nhau từ một IP trong 60s), SQLi
  (pattern `UNION SELECT`, `OR '1'='1'`, ... — severity `high`).
  Ngưỡng cấu hình qua biến môi trường (xem
  `services/analyzer-python/README.md`).
- Cảnh báo chỉ tạo khi đủ ngưỡng; một cảnh báo `open` cho cùng ip+type
  được upsert (tăng `count`, dời `last_seen`) trong
  `ALERT_COOLDOWN_SECONDS=3600`, không spam mỗi event một cảnh báo.
- Ghi bảng `alerts` trong PostgreSQL
  (`id, created_at, ip, type, severity, count, first_seen, last_seen,
  evidence JSONB, status`), schema ở `app/schema.sql`, tự tạo bảng khi
  khởi động.
- `GET /healthz` (200 khi process sống), `GET /readyz` (200 chỉ khi
  ping được cả Redis và PostgreSQL, 503 khi không), `GET /stats`
  (số event đã xử lý, số cảnh báo).
- Log JSON, config qua biến môi trường, graceful shutdown khi nhận
  SIGTERM/SIGINT (dừng consumer, đóng DB, log `analyzer stopped`).

## Kiểm tra analyzer hoạt động

Chạy local (cần Redis + PostgreSQL, hoặc chạy đủ stack bằng compose):

```bash
cd services/analyzer-python
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Health / readiness / stats:

```bash
curl -s http://localhost:8000/healthz
curl -s http://localhost:8000/readyz   # 503 khi chưa có Redis/Postgres
curl -s http://localhost:8000/stats
```

Kiểm tra end-to-end (đủ stack compose đang chạy): gửi 5 dòng log
`Failed password` từ cùng một IP qua collector (xem mục kiểm tra
collector ở trên), rồi kiểm tra bảng alerts:

```bash
docker compose exec postgres psql -U secuser -d sec_events \
  -c "SELECT ip, type, severity, count FROM alerts ORDER BY created_at DESC LIMIT 5;"
```

Kết quả đúng: một dòng `brute_force` cho IP đó, `count` >= 5. Gửi thêm
5 lần nữa trong vòng 1 giờ không tạo thêm dòng mới mà chỉ tăng `count`.

## api-node làm gì (phần 3)

- REST API đọc bảng `alerts` từ PostgreSQL thật: `GET /api/alerts`
  (phân trang `limit`/`offset`, filter `type`/`severity`/`status`/`ip`,
  `created_at DESC`), `GET /api/alerts/:id` (404 khi không có),
  `GET /api/stats` (tổng số, theo type, theo severity, theo ngày 7 ngày
  gần đây, theo giờ 24 giờ gần đây — tính từ DB thật),
  `PATCH /api/alerts/:id/status` (`open`/`acknowledged`/`resolved`).
- WebSocket realtime tại `/ws?token=<jwt>`: snapshot 50 alert mới nhất
  khi kết nối, sau đó poll bảng alerts mỗi `WS_POLL_INTERVAL_MS`
  (mặc định 2000 ms) và chỉ broadcast dòng mới/cập nhật. Đây là poll,
  **không phải Redis pub/sub** — analyzer không publish gì lên Redis.
- JWT: `POST /api/auth/login` với user seed chỉ qua env
  `API_ADMIN_USER`/`API_ADMIN_PASSWORD` (không đặt → login tắt, 503);
  `JWT_SECRET` chỉ qua env (không đặt → server từ chối khởi động);
  token hết hạn theo `JWT_EXPIRES_IN` (mặc định `1h`). Mọi route
  `/api/alerts`, `/api/stats`, `/ws` yêu cầu Bearer JWT; `/healthz`,
  `/readyz`, `/api/auth/login` không yêu cầu. Login rate limit mặc
  định 10 lần / 15 phút / IP.
- `GET /healthz` (200 khi process sống), `GET /readyz` (200 chỉ khi
  ping được cả Postgres và Redis, 503 khi không). Log JSON, config qua
  env, graceful shutdown SIGTERM/SIGINT. Chi tiết + bảng env đầy đủ:
  xem `services/api-node/README.md`.

## Kiểm tra api-node hoạt động

Chạy local (cần Postgres + Redis thật, hoặc chạy đủ stack bằng compose):

```bash
cd services/api-node
npm ci && npm test   # 28 test, dùng test double, không cần DB thật
JWT_SECRET='doi-secret-that-truoc-khi-dung-that' \
API_ADMIN_USER=admin API_ADMIN_PASSWORD='doi-mat-khau-that' \
node src/server.js
```

Health / readiness / login / alerts:

```bash
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/readyz   # 503 khi chưa có Postgres/Redis

TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"doi-mat-khau-that"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -s "http://localhost:3000/api/alerts?limit=10&type=brute_force" \
  -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/stats -H "Authorization: Bearer $TOKEN"
```

Kết quả đúng: `/api/alerts` trả `total` + danh sách alert do analyzer
đã ghi (xem mục kiểm tra analyzer ở trên); không có alert thì `total`
bằng 0 và danh sách rỗng — không có dữ liệu mẫu.

## dashboard-ts làm gì (phần 4)

- Trang login gọi `POST /api/auth/login`, token lưu ở sessionStorage
  (mất khi đóng tab), không hardcode tài khoản hay token; 401 thì quay
  lại login kèm thông báo.
- Bảng alerts từ `GET /api/alerts` thật: filter `type`/`severity`/
  `status`/`ip` đúng query param của API, phân trang 20/trang; bấm vào
  dòng xem chi tiết (`GET /api/alerts/:id`, evidence dạng JSON) và đổi
  status qua `PATCH /api/alerts/:id/status`.
- Biểu đồ từ `GET /api/stats` thật (`by_type`, `by_severity`,
  `by_day_last_7d`, `by_hour_last_24h`), tự vẽ SVG, không dùng thư
  viện biểu đồ.
- Timeline realtime qua WebSocket `/ws?token=<jwt>`: snapshot 50 alert
  mới nhất rồi merge delta (upsert theo id), không reload toàn trang.
- Không có dữ liệu mẫu trong UI: chưa có alert thật thì hiển thị
  "Chưa có cảnh báo nào"; API chết hoặc trả lỗi thì hiển thị thông báo
  lỗi + nút "Thử lại". Dữ liệu mẫu chỉ có trong test (`src/test/`).
- Config qua env Vite `VITE_API_URL` / `VITE_WS_URL` (trong compose để
  trống, nginx proxy `/api` và `/ws` tới `api-node:3000`).

## Kiểm tra dashboard hoạt động

Chạy local (cần api-node thật đang chạy ở :3000, hoặc đủ stack compose):

```bash
cd services/dashboard-ts
npm ci && npm test && npm run build   # vitest 14 test + tsc + vite build
npm run dev                            # http://localhost:5173
```

Mở trình duyệt tại `http://localhost:${DASHBOARD_PORT:-8081}` (khi chạy
đủ stack bằng compose) hoặc `http://localhost:5173` (khi chạy `npm run
dev`): đăng nhập bằng tài khoản seed của api-node
(`API_ADMIN_USER`/`API_ADMIN_PASSWORD` trong `.env`), kiểm tra bảng
alerts khớp với `GET /api/alerts` bằng curl, bấm vào một dòng để xem
evidence và đổi status, xem biểu đồ khớp với `GET /api/stats`.

Kết quả đúng: chưa có alert thì bảng hiển thị "Chưa có cảnh báo nào";
có alert thì bảng/biểu đồ/timeline hiển thị đúng số liệu từ DB thật —
không có dữ liệu mẫu.

## admin-php làm gì (phần 5)

- Trang quản trị riêng (PHP 8.3 + Slim 4, không phải Laravel): đăng nhập
  bằng **session riêng, không dùng JWT của api-node**; mọi route quản
  trị yêu cầu đăng nhập, `/healthz` và `/readyz` không yêu cầu
  (readyz ping Postgres, 503 khi không).
- Trang tổng quan đếm alerts từ DB thật (tổng, theo type/severity/
  status, alert gần nhất). Quản trị người dùng (CRUD bảng `app_users`
  riêng trong cùng DB `sec_events`: username unique, mật khẩu hash
  Argon2id qua `password_hash`, role admin/operator/viewer; tài khoản
  seed chỉ qua env `ADMIN_USER`/`ADMIN_PASSWORD` và chỉ tạo khi bảng
  còn trống — không hardcode user/pass).
- Luật phát hiện: đọc/ghi bảng `detection_rules` với đúng 5 key khớp
  analyzer (`BRUTE_FORCE_THRESHOLD`, `BRUTE_FORCE_WINDOW_SECONDS`,
  `PORT_SCAN_THRESHOLD`, `PORT_SCAN_WINDOW_SECONDS`,
  `ALERT_COOLDOWN_SECONDS`). **Giới hạn: đổi rule trong trang quản trị
  chỉ lưu vào DB, analyzer-python vẫn đọc ngưỡng từ biến môi trường khi
  khởi động nên chưa tự áp dụng cho analyzer đang chạy — cần sửa giá trị
  tương ứng trong `.env` rồi restart analyzer**
  (`docker compose up -d --force-recreate analyzer-python`).
- Cấu hình hệ thống: xem/sửa bảng `settings` (`site.title`,
  `alerts.page_size` là hai key code thật sự đọc; thêm key khác chỉ lưu
  vào DB). `settings` không điều khiển collector/analyzer/api-node.
- Một container duy nhất: nginx + php-fpm, cả hai chạy dưới user
  non-root `admin`, nginx listen 8080 trong container (map ra
  `ADMIN_PORT`, mặc định 8082). Log JSON ra stdout/stderr. Chi tiết +
  bảng env đầy đủ: xem `services/admin-php/README.md`.

## Kiểm tra admin-php hoạt động

Chạy local (cần PHP 8.3 + Composer 2 + Postgres thật, hoặc đủ stack
bằng compose):

```bash
cd services/admin-php
composer install && vendor/bin/phpunit   # PHPUnit: hash, validation, CSRF, health/readyz
ADMIN_USER=admin ADMIN_PASSWORD='doi-mat-khau-that' \
  php -S 127.0.0.1:8082 -t public
```

Health / readiness / trang quản trị:

```bash
curl -s http://localhost:8082/healthz
curl -s -i http://localhost:8082/readyz   # 503 khi chưa có Postgres
curl -s -i http://localhost:8082/dashboard  # 302 về /login khi chưa đăng nhập
```

Mở trình duyệt tại `http://localhost:${ADMIN_PORT:-8082}` (khi chạy đủ
stack bằng compose): đăng nhập bằng tài khoản seed
(`ADMIN_USER`/`ADMIN_PASSWORD` trong `.env`), kiểm tra số đếm trên tổng
quan khớp với `SELECT COUNT(*) FROM alerts;` trong Postgres.

Kết quả đúng: chưa có alert thì tổng quan hiển thị "Chưa có cảnh báo
nào"; có alert thì số đếm khớp DB thật — không có dữ liệu mẫu.

## Makefile

```bash
make build          # docker compose build
make up             # docker compose up --build -d
make down           # docker compose down
make test           # collector (go vet + go test) + analyzer (pytest) + api-node (npm ci + npm test) + dashboard-ts (npm ci + npm test + npm run build) + admin-php (composer install + phpunit)
make test-analyzer  # pytest trong services/analyzer-python
make test-api       # npm ci + npm test trong services/api-node
make test-dashboard # npm ci + npm test + npm run build trong services/dashboard-ts
make test-admin     # composer install + phpunit trong services/admin-php (fail rõ ràng khi máy không có php/composer)
make logs           # docker compose logs -f collector-go
make logs-analyzer  # docker compose logs -f analyzer-python
make logs-api       # docker compose logs -f api-node
make logs-dashboard # docker compose logs -f dashboard-ts
make logs-admin     # docker compose logs -f admin-php
make k8s-deploy     # kubectl apply -k overlays/dev (K8S_OVERLAY=prod cho prod)
make k8s-delete     # kubectl delete -k overlays/dev (hoặc prod)
make k8s-status     # kubectl get pods,svc,ingress,pvc,hpa,pdb trong namespace overlay
make k8s-logs       # kubectl logs -f -l app=<service> (K8S_SERVICE=api-node...)
```

## Deploy Kubernetes (phần 6)

Chi tiết đầy đủ: xem `k8s/README.md`. Tóm tắt: cần cluster kind/
minikube đã chạy, image đã build + load vào cluster, ingress-nginx
controller (cho Ingress) và metrics-server (cho HPA). Secret trong
`k8s/base/` chỉ là placeholder `change-me` — thay bằng secret thật
trước khi dùng thật, `POSTGRES_PASSWORD` phải giống nhau ở 4 Secret
(postgres, analyzer-python, api-node, admin-php), `JWT_SECRET` phải
đổi thành chuỗi ngẫu nhiên dài.

```bash
bash scripts/kind-cluster.sh              # tạo cluster kind + build/load image + deploy dev
# hoặc: K8S_OVERLAY=prod bash scripts/kind-cluster.sh
make k8s-deploy                            # kubectl apply -k k8s/overlays/dev
K8S_OVERLAY=prod make k8s-deploy           # kubectl apply -k k8s/overlays/prod
make k8s-status
```

Kiểm tra từng service bằng curl (port-forward, không cần Ingress):

```bash
NS=container-platform-dev
kubectl -n $NS port-forward svc/collector-go 8080:8080 &
kubectl -n $NS port-forward svc/analyzer-python 8000:8000 &
kubectl -n $NS port-forward svc/api-node 3000:3000 &
kubectl -n $NS port-forward svc/admin-php 8082:8080 &
kubectl -n $NS port-forward svc/dashboard-ts 8081:80 &
curl -s http://localhost:8080/healthz; curl -s http://localhost:8080/readyz
curl -s http://localhost:8000/healthz; curl -s http://localhost:8000/readyz
curl -s http://localhost:3000/healthz; curl -s http://localhost:3000/readyz
curl -s http://localhost:8082/healthz; curl -s -i http://localhost:8082/dashboard
curl -s http://localhost:8081/ | head -c 200
```

Qua Ingress (host placeholder `sec-events.local`, thêm vào
`/etc/hosts`): `http://sec-events.local/api/...` tới api-node,
`http://sec-events.local/` tới dashboard, `http://sec-events.local/admin`
tới admin-php (chỉ mở được trang — xem giới hạn admin ở `k8s/README.md`).

## Phần còn thiếu (phần sau)

- Không còn phần nào chưa làm — đã xong 6 phần. Phần 6 chưa kiểm chứng
  bằng cluster thật (xem `k8s/README.md` mục "Những gì chưa kiểm chứng").
