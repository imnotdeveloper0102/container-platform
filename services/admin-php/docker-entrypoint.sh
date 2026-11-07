#!/bin/bash
# admin-php entrypoint (PID 1). Chay php-fpm va nginx trong cung container.
# Graceful shutdown: trap SIGTERM/SIGINT roi gui SIGTERM cho ca hai tien
# trinh con — nginx dung nhanh (fast shutdown), php-fpm dung graceful
# (cho request dang chay xong roi moi thoat). Cho ca hai thoat roi moi ket thuc.
set -euo pipefail

mkdir -p /tmp/php-sessions /tmp/nginx-body /tmp/nginx-proxy \
    /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi

# Migration + seed (thu toi da 30s cho Postgres len). Neu that bai thi van
# khoi dong server de /healthz tra 200 va /readyz tra 503 thay vi crash-loop;
# xem lai log roi restart container sau khi DB san sang.
php /app/bin/migrate.php || echo "admin-php: migrate failed at boot, continuing (see logs)" >&2

php-fpm -F &
FPM_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
    kill -TERM "$NGINX_PID" "$FPM_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    wait "$FPM_PID" 2>/dev/null || true
}

trap shutdown TERM INT

# Cho mot trong hai tien trinh thoat (loi hoac bi kill), roi dung cai con lai.
wait -n "$NGINX_PID" "$FPM_PID" || true
shutdown
exit 0
