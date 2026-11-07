<?php

declare(strict_types=1);

namespace Admin;

/** Kết nối PostgreSQL qua PDO, chỉ dùng prepared statement ở các chỗ gọi. */
final class Database
{
    private ?\PDO $pdo = null;

    public function __construct(
        private readonly Config $config,
        private readonly JsonLogger $log,
    ) {
    }

    public function pdo(): \PDO
    {
        if ($this->pdo === null) {
            $this->pdo = $this->connect();
        }
        return $this->pdo;
    }

    public function ping(): bool
    {
        try {
            $this->pdo()->query('SELECT 1');
            return true;
        } catch (\PDOException $e) {
            $this->log->warning('db_ping_failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    private function connect(): \PDO
    {
        [$dsn, $user, $password] = $this->dsn();
        return new \PDO($dsn, $user, $password, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_TIMEOUT => 5,
        ]);
    }

    /** @return array{0: string, 1: string, 2: string} */
    private function dsn(): array
    {
        if ($this->config->databaseUrl !== '') {
            $parts = parse_url($this->config->databaseUrl);
            if ($parts === false || ($parts['scheme'] ?? '') !== 'postgresql') {
                throw new \InvalidArgumentException('DATABASE_URL must be a postgresql:// URL');
            }
            $dsn = sprintf(
                'pgsql:host=%s;port=%d;dbname=%s',
                $parts['host'] ?? 'localhost',
                (int) ($parts['port'] ?? 5432),
                ltrim((string) ($parts['path'] ?? '/sec_events'), '/'),
            );
            return [$dsn, rawurldecode((string) ($parts['user'] ?? '')), rawurldecode((string) ($parts['pass'] ?? ''))];
        }
        $dsn = sprintf(
            'pgsql:host=%s;port=%d;dbname=%s',
            $this->config->dbHost,
            $this->config->dbPort,
            $this->config->dbName,
        );
        return [$dsn, $this->config->dbUser, $this->config->dbPassword];
    }
}
