<?php

declare(strict_types=1);

namespace Admin;

/**
 * Mọi cấu hình qua biến môi trường. Không có secret nào hardcode ở đây.
 * Các ngưỡng phát hiện (BRUTE_FORCE_*, PORT_SCAN_*, ALERT_COOLDOWN_*)
 * chỉ dùng để SEED bảng detection_rules lần đầu — analyzer-python vẫn
 * đọc env của chính nó khi khởi động, xem README.
 */
final class Config
{
    public readonly string $dbHost;
    public readonly int $dbPort;
    public readonly string $dbUser;
    public readonly string $dbPassword;
    public readonly string $dbName;
    public readonly string $databaseUrl;
    public readonly string $adminUser;
    public readonly string $adminPassword;
    public readonly bool $sessionSecure;
    public readonly int $sessionLifetimeMinutes;
    public readonly string $logLevel;
    public readonly string $appEnv;
    /** @var array<string,string> Giá trị mặc định để seed detection_rules. */
    public readonly array $ruleDefaults;

    public function __construct(array $env)
    {
        $get = static fn(string $key, string $default = ''): string => $env[$key] ?? $default;
        $getInt = static function (string $key, int $default) use ($env): int {
            $raw = $env[$key] ?? '';
            return $raw !== '' && is_numeric($raw) ? (int) $raw : $default;
        };

        $this->dbHost = $get('POSTGRES_HOST', 'localhost');
        $this->dbPort = $getInt('POSTGRES_PORT', 5432);
        $this->dbUser = $get('POSTGRES_USER', 'secuser');
        $this->dbPassword = $get('POSTGRES_PASSWORD', 'change-me');
        $this->dbName = $get('POSTGRES_DB', 'sec_events');
        $this->databaseUrl = $get('DATABASE_URL', '');
        $this->adminUser = $get('ADMIN_USER', '');
        $this->adminPassword = $get('ADMIN_PASSWORD', '');
        $this->sessionSecure = $get('ADMIN_SESSION_SECURE', '0') === '1';
        $this->sessionLifetimeMinutes = $getInt('ADMIN_SESSION_LIFETIME_MINUTES', 60);
        $this->logLevel = $get('LOG_LEVEL', 'info');
        $this->appEnv = $get('APP_ENV', 'production');
        $this->ruleDefaults = [
            'BRUTE_FORCE_THRESHOLD' => (string) $getInt('BRUTE_FORCE_THRESHOLD', 5),
            'BRUTE_FORCE_WINDOW_SECONDS' => (string) $getInt('BRUTE_FORCE_WINDOW_SECONDS', 300),
            'PORT_SCAN_THRESHOLD' => (string) $getInt('PORT_SCAN_THRESHOLD', 5),
            'PORT_SCAN_WINDOW_SECONDS' => (string) $getInt('PORT_SCAN_WINDOW_SECONDS', 60),
            'ALERT_COOLDOWN_SECONDS' => (string) $getInt('ALERT_COOLDOWN_SECONDS', 3600),
        ];
    }

    public static function fromEnv(): self
    {
        $env = [];
        foreach ($_SERVER as $key => $value) {
            $env[(string) $key] = (string) $value;
        }
        foreach ($_ENV as $key => $value) {
            $env[(string) $key] = (string) $value;
        }
        return new self($env);
    }
}
