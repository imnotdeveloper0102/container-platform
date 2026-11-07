# syntax=docker/dockerfile:1
# admin-php 0.1.0 — mot container duy nhat: nginx + php:8.3-fpm.
# Chon 1 container thay vi 2 vi: trang quan tri nho, chi co 1 cong, 1 vong
# doi; php-fpm chi duoc goi qua loopback 127.0.0.1:9000, khong lo ra ngoai.
# Chon Slim 4 thay vi Laravel vi: chi can vai route + form, khong can ORM/
# queue/queue-worker cua Laravel; Slim nhe, de kiem chung, it be mat tan cong.
#
# Luu y ve composer.lock: repo hien CHUA co file nay vi may phat trien khong
# co PHP/Composer de sinh lock that. Dockerfile chay `composer install` tu
# composer.json; cac dependency truc tiep da ghim version chinh xac
# (slim/slim 4.15.3, slim/psr7 1.8.0, vlucas/phpdotenv 5.8.0, psr/log 3.0.2)
# nen viec resolve la xac dinh o muc truc tiep. Sinh lock that truoc khi
# build production: tren may co PHP 8.3 + Composer 2, chay
#   composer update --lock && composer install
# roi commit composer.lock (xem README).
FROM composer:2 AS vendor

WORKDIR /src

COPY composer.json ./
RUN composer install --no-dev --prefer-dist --no-progress \
    --optimize-autoloader --no-scripts

FROM php:8.3-fpm

# nginx + libpq-dev (de build pdo_pgsql). Khong cai curl/wget: HEALTHCHECK
# dung chinh php de goi /healthz.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx libpq-dev \
    && docker-php-ext-install -j"$(nproc)" pdo_pgsql \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/local/etc/php-fpm.d/www.conf \
    && groupadd -r -g 10001 admin && useradd -r -u 10001 -g admin admin \
    && mkdir -p /app /tmp/php-sessions /tmp/nginx-body /tmp/nginx-proxy \
        /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi \
    && chown -R admin:admin /app /tmp/php-sessions /tmp/nginx-body \
        /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi

WORKDIR /app

COPY --from=vendor /src/vendor ./vendor
COPY composer.json ./
COPY public ./public
COPY src ./src
COPY templates ./templates
COPY migrations ./migrations
COPY bin ./bin
COPY nginx.conf /etc/nginx/nginx.conf
COPY php-fpm.conf /usr/local/etc/php-fpm.d/admin.conf
COPY php.ini /usr/local/etc/php/conf.d/admin.ini
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chown -R admin:admin /app \
    && chmod +x /usr/local/bin/docker-entrypoint.sh /app/bin/migrate.php

# Ca nginx (listen 8080, xem nginx.conf) va php-fpm deu chay duoi user admin.
USER admin:admin

EXPOSE 8080

# php:8.3-fpm co san binary php nen dung no de kiem tra /healthz qua nginx.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["php", "-r", "exit(@file_get_contents('http://127.0.0.1:8080/healthz') === false ? 1 : 0);"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
