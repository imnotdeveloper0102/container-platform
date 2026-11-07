#!/usr/bin/env bash
# Tạo cluster minikube, build + load image từng service, deploy overlay dev.
#
# CHƯA CHẠY ĐƯỢC trên máy phát triển hiện tại (không có docker / minikube /
# kubectl trên máy đó) nên script này chưa được kiểm chứng bằng chạy thật.
# Chạy trên máy có đủ docker + minikube + kubectl:
#   bash scripts/minikube-cluster.sh            # overlay dev
#   K8S_OVERLAY=prod bash scripts/minikube-cluster.sh
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-container-platform}"
K8S_OVERLAY="${K8S_OVERLAY:-dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for tool in docker minikube kubectl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FAIL: scripts/minikube-cluster.sh needs '$tool' but it is not installed on this machine." >&2
    echo "Install Docker + minikube + kubectl, then run: bash scripts/minikube-cluster.sh" >&2
    exit 1
  fi
done

if minikube profile list 2>/dev/null | grep -qx "$PROFILE"; then
  echo "minikube profile '$PROFILE' already exists, reusing it."
else
  minikube start -p "$PROFILE"
fi

# Build image từng service (tag khớp manifest k8s/base/*.yaml) rồi load
# vào minikube. Image local nên phải load tay.
for svc in collector-go analyzer-python api-node dashboard-ts admin-php; do
  docker build -t "container-platform/${svc}:0.1.0" "$ROOT/services/$svc"
  minikube image load "container-platform/${svc}:0.1.0" -p "$PROFILE"
done

kubectl apply -k "$ROOT/k8s/overlays/$K8S_OVERLAY"

NS=container-platform
[ "$K8S_OVERLAY" = "dev" ] && NS=container-platform-dev
kubectl -n "$NS" wait --for=condition=ready pod --all --timeout=180s || true
kubectl get pods,svc,ingress -n "$NS"
echo "Done. Namespace: $NS (overlay: $K8S_OVERLAY)"
echo "NOTE: ingress host is sec-events.local (placeholder) — add it to /etc/hosts and enable ingress addon (minikube addons enable ingress -p $PROFILE) + metrics-server if needed (see k8s/README.md)."
