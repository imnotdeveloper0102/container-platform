<?php

declare(strict_types=1);

namespace Admin;

/**
 * Áp dụng schema SQL + seed. Chạy khi container khởi động (bin/migrate.php)
 * và lần đầu mỗi php-fpm worker tạo app (guard tĩnh). Tất cả đều
 * idempotent (CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING,
 * seed admin chỉ khi bảng app_users còn trống).
 */
final class Migrations
{
    private static bool $applied = false;

    /** @var array<string,string> Mô tả từng luật, hiển thị trên trang rules. */
    public const RULE_DESCRIPTIONS = [
        'BRUTE_FORCE_THRESHOLD' => 'Số lần đăng nhập sai từ một IP thì báo brute_force.',
        'BRUTE_FORCE_WINDOW_SECONDS' => 'Cửa sổ thời gian (giây) đếm lần đăng nhập sai.',
        'PORT_SCAN_THRESHOLD' => 'Số cổng đích khác nhau từ một IP thì báo port_scan.',
        'PORT_SCAN_WINDOW_SECONDS' => 'Cửa sổ thời gian (giây) đếm cổng đã thấy.',
        'ALERT_COOLDOWN_SECONDS' => 'Trong khoảng này, alert open cùng ip+type chỉ tăng count, không tạo dòng mới.',
    ];

    /** @var array<string,string> Setting seed mà code thật sự đọc. */
    public const SETTING_SEEDS = [
        'site.title' => 'Tiêu đề hiển thị trên trang quản trị.',
        'alerts.page_size' => 'Số alert gần nhất hiển thị trên trang tổng quan (5–50).',
    ];

    public static function apply(\PDO $pdo, Config $config, JsonLogger $log, bool $force = false): void
    {
        if (self::$applied && !$force) {
            return;
        }
        $sqlFile = __DIR__ . '/../migrations/001_admin_schema.sql';
        $sql = file_get_contents($sqlFile);
        if ($sql === false) {
            throw new \RuntimeException("Cannot read {$sqlFile}");
        }
        $pdo->exec($sql);

        $ruleStmt = $pdo->prepare(
            'INSERT INTO detection_rules (key, value, description) VALUES (:key, :value, :description) '
            . 'ON CONFLICT (key) DO NOTHING',
        );
        foreach ($config->ruleDefaults as $key => $value) {
            $ruleStmt->execute([
                'key' => $key,
                'value' => $value,
                'description' => self::RULE_DESCRIPTIONS[$key] ?? '',
            ]);
        }

        $settingStmt = $pdo->prepare(
            'INSERT INTO settings (key, value, description) VALUES (:key, :value, :description) '
            . 'ON CONFLICT (key) DO NOTHING',
        );
        $settingStmt->execute(['key' => 'site.title', 'value' => 'container-platform — quản trị', 'description' => self::SETTING_SEEDS['site.title']]);
        $settingStmt->execute(['key' => 'alerts.page_size', 'value' => '10', 'description' => self::SETTING_SEEDS['alerts.page_size']]);

        // Tài khoản seed CHỈ tạo khi bảng còn trống, và CHỈ từ env
        // ADMIN_USER/ADMIN_PASSWORD. Không có env thì không tạo gì cả và
        // ghi warning — khi đó chưa ai đăng nhập được cho tới khi đặt env
        // rồi restart container.
        $count = (int) $pdo->query('SELECT COUNT(*) FROM app_users')->fetchColumn();
        if ($count === 0) {
            if ($config->adminUser !== '' && $config->adminPassword !== '') {
                $insert = $pdo->prepare(
                    "INSERT INTO app_users (username, password_hash, role) VALUES (:username, :hash, 'admin')",
                );
                $insert->execute([
                    'username' => $config->adminUser,
                    'hash' => Auth::hashPassword($config->adminPassword),
                ]);
                $log->info('admin_seed_created', ['username' => $config->adminUser]);
            } else {
                $log->warning('admin_seed_missing', ['msg' => 'ADMIN_USER/ADMIN_PASSWORD not set and app_users is empty; no one can log in until env is set and container restarts']);
            }
        }
        self::$applied = true;
    }
}
