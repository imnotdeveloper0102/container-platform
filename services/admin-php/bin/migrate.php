<?php

declare(strict_types=1);

// CLI: áp dụng migration + seed (bảng app_users, detection_rules, settings).
// Chạy khi container khởi động (docker-entrypoint.sh) và chạy tay khi cần:
//   php bin/migrate.php
// Thử kết nối Postgres tối đa 30s trước khi bỏ cuộc.
require __DIR__ . '/../vendor/autoload.php';

use Admin\Config;
use Admin\Database;
use Admin\JsonLogger;
use Admin\Migrations;

$config = Config::fromEnv();
$log = new JsonLogger($config->logLevel);
$db = new Database($config, $log);

$deadline = time() + 30;
while (true) {
    try {
        $pdo = $db->pdo();
        break;
    } catch (\PDOException $e) {
        if (time() >= $deadline) {
            $log->error('db_connect_failed', ['error' => $e->getMessage()]);
            exit(1);
        }
        sleep(2);
    }
}

try {
    Migrations::apply($pdo, $config, $log, true);
    $log->info('migrations_applied');
} catch (\Throwable $e) {
    $log->error('db_migration_failed', ['error' => $e->getMessage()]);
    exit(1);
}
