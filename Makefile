GO := $(shell command -v go 2>/dev/null || echo $(HOME)/workspace/.local/go/bin/go)
COLLECTOR_DIR := services/collector-go
ANALYZER_DIR := services/analyzer-python
API_DIR := services/api-node
DASHBOARD_DIR := services/dashboard-ts
ADMIN_DIR := services/admin-php

# K8s: overlay dev (namespace container-platform-dev) mặc định,
# prod dùng K8S_OVERLAY=prod (namespace container-platform).
K8S_OVERLAY ?= dev
ifeq ($(K8S_OVERLAY),dev)
K8S_NAMESPACE ?= container-platform-dev
else
K8S_NAMESPACE ?= container-platform
endif

.PHONY: build up down test test-collector test-analyzer test-api test-dashboard test-admin logs logs-analyzer logs-api logs-dashboard logs-admin vet clean k8s-deploy k8s-delete k8s-status k8s-logs

build:
	docker compose build

up:
	docker compose up --build -d

down:
	docker compose down

test: test-collector test-analyzer test-api test-dashboard test-admin

test-collector:
	cd $(COLLECTOR_DIR) && $(GO) vet ./... && $(GO) test ./...

test-analyzer:
	cd $(ANALYZER_DIR) && python3 -m pytest -q

test-api:
	cd $(API_DIR) && npm ci && npm test

test-dashboard:
	cd $(DASHBOARD_DIR) && npm ci && npm test && npm run build

# Fail rõ ràng khi máy không có php/composer, không báo pass giả.
test-admin:
	@if ! command -v php >/dev/null 2>&1; then echo "FAIL: test-admin needs php (>= 8.3) but php is not installed on this machine. Install PHP 8.3 + Composer 2, then run: cd services/admin-php && composer install && vendor/bin/phpunit"; exit 1; fi
	@if ! command -v composer >/dev/null 2>&1; then echo "FAIL: test-admin needs composer but composer is not installed on this machine. Install Composer 2, then run: cd services/admin-php && composer install && vendor/bin/phpunit"; exit 1; fi
	cd $(ADMIN_DIR) && composer install --no-interaction && vendor/bin/phpunit

logs:
	docker compose logs -f collector-go

logs-analyzer:
	docker compose logs -f analyzer-python

logs-api:
	docker compose logs -f api-node

logs-dashboard:
	docker compose logs -f dashboard-ts

logs-admin:
	docker compose logs -f admin-php

vet:
	cd $(COLLECTOR_DIR) && $(GO) vet ./...

clean:
	docker compose down -v

# --- Kubernetes (phần 6) ---
# Fail rõ ràng khi máy không có kubectl, không báo lỗi khó hiểu.
# K8S_OVERLAY=dev (mặc định, namespace container-platform-dev) hoặc
# K8S_OVERLAY=prod (namespace container-platform).
# Cần cluster kind/minikube đã chạy + image đã load vào cluster
# (xem scripts/kind-cluster.sh, scripts/minikube-cluster.sh).
k8s-deploy:
	@if ! command -v kubectl >/dev/null 2>&1; then echo "FAIL: k8s-deploy needs kubectl but kubectl is not installed on this machine. Install kubectl + kind/minikube, create/load the cluster first (bash scripts/kind-cluster.sh), then run: make k8s-deploy"; exit 1; fi
	kubectl apply -k k8s/overlays/$(K8S_OVERLAY)

k8s-delete:
	@if ! command -v kubectl >/dev/null 2>&1; then echo "FAIL: k8s-delete needs kubectl but kubectl is not installed on this machine. Install kubectl, then run: make k8s-delete"; exit 1; fi
	kubectl delete -k k8s/overlays/$(K8S_OVERLAY)

k8s-status:
	@if ! command -v kubectl >/dev/null 2>&1; then echo "FAIL: k8s-status needs kubectl but kubectl is not installed on this machine. Install kubectl, then run: make k8s-status"; exit 1; fi
	kubectl -n $(K8S_NAMESPACE) get pods,svc,ingress,pvc,hpa,pdb

# K8S_SERVICE=collector-go (mặc định) hoặc analyzer-python, api-node,
# dashboard-ts, admin-php, postgres, redis.
k8s-logs:
	@if ! command -v kubectl >/dev/null 2>&1; then echo "FAIL: k8s-logs needs kubectl but kubectl is not installed on this machine. Install kubectl, then run: make k8s-logs K8S_SERVICE=api-node"; exit 1; fi
	kubectl -n $(K8S_NAMESPACE) logs -f -l app=$(K8S_SERVICE)

