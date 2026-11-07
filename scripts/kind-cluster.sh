#!/usr/bin/env bash
# Tạo cluster kind, build + load image từng service, deploy overlay dev.
#
# CHƯA CHẠY ĐƯỢC trên máy phát triển hiện tại (không có docker / kind /
# kubectl trên máy đó) nên script này chưa được kiểm chứng bằng chạy thật.
# Chạy trên máy có đủ docker + kind + kubectl:
#   bash scripts/kind-cluster.sh            # overlay dev
#   K8S_OVERLAY=prod bash scripts/kind-cluster.sh
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-container-platform}"
K8S_OVERLAY="${K8S_OVERLAY:-dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for tool in docker kind kubectl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FAIL: scripts/kind-cluster.sh needs '$tool' but it is not installed on this machine." >&2
    echo "Install Docker + kind + kubectl, then run: bash scripts/kind-cluster.sh" >&2
    exit 1
  fi
done

# Tạo cluster nếu chưa có (kindnet mặc định KHÔNG enforce NetworkPolicy;
# muốn kiểm tra NetworkPolicy thật thì cài Calico/Cilium sau bước này).
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "kind cluster '$CLUSTER_NAME' already exists, reusing it."
else
  kind create cluster --name "$CLUSTER_NAME"
fi

# Build image từng service (tag khớp manifest k8s/base/*.yaml) rồi load
# vào cluster. Image local nên phải load tay — kind không tự thấy image
# trên máy host.
for svc in collector-go analyzer-python api-node dashboard-ts admin-php; do
  docker build -t "container-platform/${svc}:0.1.0" "$ROOT/services/$svc"
  kind load docker-image "container-platform/${svc}:0.1.0" --name "$CLUSTER_NAME"
done

kubectl apply -k "$ROOT/k8s/overlays/$K8S_OVERLAY"

NS=container-platform
[ "$K8S_OVERLAY" = "dev" ] && NS=container-platform-dev
kubectl -n "$NS" wait --for=condition=ready pod --all --timeout=180s || true
kubectl get pods,svc,ingress -n "$NS"
echo "Done. Namespace: $NS (overlay: $K8S_OVERLAY)"
echo "NOTE: ingress host is sec-events.local (placeholder) — add it to /etc/hosts and install ingress-nginx + metrics-server if needed (see k8s/README.md)."
