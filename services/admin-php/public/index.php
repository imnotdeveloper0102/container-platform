<?php

declare(strict_types=1);

use Admin\AdminApp;
use Admin\Config;
use Admin\Database;
use Admin\JsonLogger;

require __DIR__ . '/../vendor/autoload.php';

$root = dirname(__DIR__);
if (is_file($root . '/.env')) {
    // Chỉ dùng cho chạy local ngoài Docker; trong container env lấy từ compose.
    \Dotenv\Dotenv::createImmutable($root)->safeLoad();
}

$config = Config::fromEnv();
$log = new JsonLogger($config->logLevel);

$database = new Database($config, $log);
try {
    $pdo = $database->pdo();
} catch (\PDOException $e) {
    // Không có DB thì vẫn phục vụ /healthz (200); /readyz và các trang
    // quản trị sẽ trả 503 cho tới khi DB lên lại.
    $log->error('db_connect_failed', ['error' => $e->getMessage()]);
    $pdo = null;
}

$app = AdminApp::create($config, $pdo, $log);
$app->run();
