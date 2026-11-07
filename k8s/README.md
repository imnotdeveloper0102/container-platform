# Kubernetes — container-platform (phần 6)

Kustomize base + overlays dev/prod. Chỉ deploy local (kind/minikube),
**không** dùng cho production thật khi chưa thay hết secret placeholder
và chưa xử lý các giới hạn ghi dưới đây.

## Cây thư mục

```text
k8s/
  README.md                  # file này
  base/
    kustomization.yaml       # liệt kê đủ resource
    namespace.yaml           # namespace container-platform
    serviceaccount.yaml      # 1 SA riêng cho mỗi workload (7 SA)
    collector.yaml           # ConfigMap + Secret + Deployment + Service
    analyzer.yaml            # ConfigMap + Secret + Deployment + Service
    api.yaml                 # ConfigMap + Secret + Deployment + Service
    dashboard.yaml           # ConfigMap + Deployment + Service (không Secret, xem dưới)
    admin.yaml               # ConfigMap + Secret + Deployment + Service
    postgres.yaml            # Secret + headless Service + StatefulSet + PVC
    redis.yaml               # headless Service + StatefulSet + PVC
    ingress.yaml             # 2 Ingress nginx (chính + admin, xem dưới)
    hpa.yaml                 # HPA collector-go + analyzer-python
    networkpolicy.yaml       # default deny + policy từng service
    pdb.yaml                 # PDB api-node, analyzer-python, collector-go
  overlays/
    dev/kustomization.yaml   # namespace container-platform-dev, ít resource/PVC/HPA
    prod/kustomization.yaml  # namespace container-platform, 2 replica, PVC/HPA lớn
```

## Secret — thay placeholder TRƯỚC khi dùng thật

Mọi Secret trong `base/` chỉ chứa placeholder (`change-me`, mật khẩu
Redis rỗng theo mặc định compose). Cách thay bằng secret thật (chọn 1):

```bash
# Cách 1: sửa trực tiếp các file Secret trong base/ rồi mới apply
# (chỉ làm trên máy của mình, KHÔNG commit secret thật).
# Cách 2: tạo Secret bằng kubectl SAU khi apply lần đầu (Secret tạo tay
# sẽ bị ghi đè nếu apply lại manifest base, nên cách 1 chắc hơn cho
# dùng lâu dài; cách tốt nhất cho production là sealed-secrets hoặc
# external-secrets — chưa có sẵn trong repo này).
kubectl -n container-platform create secret generic postgres \
  --from-literal=POSTGRES_USER=secuser \
  --from-literal=POSTGRES_PASSWORD='<mat-khau-that>' \
  --from-literal=POSTGRES_DB=sec_events --dry-run=client -o yaml
```

Quy tắc khớp nhau (sai là service không kết nối được):
- `POSTGRES_PASSWORD` phải GIỐNG nhau ở 4 Secret: `postgres`,
  `analyzer-python`, `api-node`, `admin-php`.
- `JWT_SECRET` (Secret `api-node`) phải đổi thành chuỗi ngẫu nhiên dài;
  giữ `change-me` thì ai cũng ký được token JWT.
- `API_ADMIN_PASSWORD` / `ADMIN_PASSWORD` là tài khoản seed; không đặt
  thì login tắt (api) / chưa ai đăng nhập được (admin).
- Đổi mật khẩu Postgres SAU khi PVC đã có data thì phải đổi luôn trong
  DB, Secret mới chỉ có tác dụng với DB mới tạo.

Ngoại lệ: **dashboard-ts không có Secret** — dashboard không có biến
môi trường nhạy cảm nào (VITE_API_URL/VITE_WS_URL là build-arg lúc build
image; token JWT nằm ở trình duyệt, không nằm trong pod). Tạo Secret
rỗng chỉ để đủ checklist là bịa nên không tạo; ConfigMap của dashboard
chỉ là ghi chú và không mount vào pod (cấu hình runtime nằm trong
nginx.conf đã build vào image).

## Deploy

Yêu cầu: `kubectl`, `kustomize` (hoặc kubectl >= 1.14 đã tích hợp
kustomize), cluster kind/minikube đã chạy, image đã build + load vào
cluster (xem `scripts/kind-cluster.sh`, `scripts/minikube-cluster.sh`).
Cần ingress-nginx controller trong cluster thì Ingress mới có tác dụng;
cần metrics-server thì HPA mới có số liệu.

```bash
# Xem manifest đã render (không apply):
kustomize build k8s/overlays/dev
kustomize build k8s/overlays/prod

# Deploy dev (mặc định) / prod:
make k8s-deploy                 # overlay dev, namespace container-platform-dev
K8S_OVERLAY=prod make k8s-deploy  # overlay prod, namespace container-platform

# Kiểm tra:
make k8s-status
kubectl get pods,svc,ingress -n container-platform-dev
kubectl get pvc,hpa,pdb -n container-platform-dev

# Gỡ:
make k8s-delete
```

## Kiểm tra từng service bằng curl

Ingress dùng host placeholder `sec-events.local` — thêm vào `/etc/hosts`
trên máy chạy trình duyệt/curl (IP là IP của ingress controller, với
kind/minikube thường là `127.0.0.1` sau port-forward, xem lệnh dưới):

```bash
echo "127.0.0.1 sec-events.local" | sudo tee -a /etc/hosts
# kind: expose ingress controller về localhost trước (tùy cách cài):
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80
curl -s http://sec-events.local:8080/healthz -H 'Host: sec-events.local'
```

Kiểm tra trực tiếp trong cluster (không cần Ingress, chắc chắn hơn):

```bash
NS=container-platform-dev
kubectl -n $NS port-forward svc/collector-go 8080:8080 &
kubectl -n $NS port-forward svc/analyzer-python 8000:8000 &
kubectl -n $NS port-forward svc/api-node 3000:3000 &
kubectl -n $NS port-forward svc/admin-php 8082:8080 &
kubectl -n $NS port-forward svc/dashboard-ts 8081:80 &

curl -s http://localhost:8080/healthz; curl -s http://localhost:8080/readyz
curl -s http://localhost:8000/healthz; curl -s http://localhost:8000/readyz
curl -s http://localhost:8000/stats
curl -s http://localhost:3000/healthz; curl -s http://localhost:3000/readyz
curl -s http://localhost:8082/healthz; curl -s -i http://localhost:8082/readyz
curl -s -i http://localhost:8082/dashboard   # 302 về /login khi chưa đăng nhập
curl -s http://localhost:8081/ | head -c 200  # trang dashboard (HTML)
```

Login api-node rồi gọi `/api/alerts` (như README root, chỉ đổi port
khi port-forward khác). Gửi log vào collector qua HTTP `:8080/ingest`
hoặc TCP `:9000` (port-forward thêm `9000:9000` cho svc/collector-go).

## Ingress — cách route và giới hạn đã biết

- `/api` -> api-node:3000, **không rewrite** (route api đã bắt đầu bằng
  `/api`: `/api/alerts`, `/api/stats`, `/api/auth/login`).
- `/` -> dashboard-ts:80 (SPA; `/api` và `/ws` từ trình duyệt đi thẳng
  tới api-node qua rule `/api`, hoặc qua nginx dashboard proxy sang
  api-node — cả hai đều tới api-node:3000).
- `/admin` -> admin-php:8080 với `rewrite-target: /$2`
  (`/admin/dashboard` -> `/dashboard`) vì admin định nghĩa route dưới
  root (`/login`, `/dashboard`, `/users...`, `/rules`, `/settings...`).

**Giới hạn admin dưới prefix /admin (đã ghi trong ingress.yaml):**
rewrite chỉ sửa path request đi vào; admin trả redirect/link bằng đường
dẫn tuyệt đối dưới root (`Location: /dashboard` sau login,
`Location: /login` khi chưa đăng nhập). Các URL đó không có prefix
`/admin` nên qua Ingress sẽ rơi vào rule `/` (dashboard SPA), luồng
đăng nhập bị gãy — `/admin` chỉ đủ để mở được trang (ví dụ form login),
không đủ cho luồng đầy đủ. Cách dùng thật: cho admin một host riêng,
ví dụ `admin.sec-events.local`, rule `/` -> admin-php:8080, không
rewrite. Khi đó mọi redirect/link tuyệt đối đều đúng.

## Những gì chưa kiểm chứng / giả định cần xác nhận trên cluster thật

- Toàn bộ manifest phần 6 **chưa chạy được trên máy phát triển**
  (không có Docker/kubectl/kustomize/kind/minikube) nên chưa có
  `kustomize build` hay `kubectl apply --dry-run` thật; chỉ validate
  bằng `python3 -c yaml.safe_load` + script kiểm tra chéo (Service
  selector khớp Deployment label, Secret/ConfigMap được tham chiếu có
  tồn tại, Ingress backend trỏ đúng Service/port). Xem báo cáo phần 6.
- Script `scripts/kind-cluster.sh` / `scripts/minikube-cluster.sh`
  **chưa chạy** (không có docker/kind/minikube trên máy này).
- uid user trong image: collector distroless nonroot = 65532 (chuẩn),
  admin = 10001 (ghi rõ trong Dockerfile), dashboard nginx = 101
  (nginx:alpine). analyzer/api: Dockerfile tạo user bằng `useradd -r`
  KHÔNG ghim uid nên manifest không đặt runAsUser, chỉ ép runAsNonRoot.
  postgres uid 70, redis uid 999 là uid thường gặp trong image alpine
  tương ứng — nếu pod báo permission denied trên PVC, kiểm tra bằng
  `kubectl exec ... -- id postgres|redis` rồi sửa runAsUser/fsGroup.
- NetworkPolicy chỉ có tác dụng khi CNI enforce nó (Calico/Cilium...);
  CNI mặc định của kind (kindnet) KHÔNG enforce nên trên kind các
  policy chỉ là khai báo. Namespace của ingress controller được giả
  định là `ingress-nginx` — nếu khác, sửa namespaceSelector trong
  networkpolicy.yaml.
- HPA cần metrics-server; không có thì HPA báo `unknown`, không scale.
- Postgres/Redis là StatefulSet 1 replica, không có replication hay
  failover — mất node thì mất service cho tới khi pod chạy lại (data
  còn trên PVC). Đây là mức đủ cho local, không phải HA production.
- Image `container-platform/*:0.1.0` phải được build + load vào cluster
  trước (script làm việc này); `imagePullPolicy: IfNotPresent` nên
  cluster không tự pull image local từ registry nào.
