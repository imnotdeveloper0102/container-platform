<?php

declare(strict_types=1);

namespace Admin;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

/**
 * Logger JSON có cấu trúc, mỗi dòng một JSON object ra stdout (info trở
 * xuống) hoặc stderr (error trở lên). Không bao giờ ghi secret: mọi key
 * context trùng password/secret/token/hash đều bị thay bằng [redacted].
 */
final class JsonLogger extends AbstractLogger
{
    private const LEVELS = [
        LogLevel::DEBUG => 0,
        LogLevel::INFO => 1,
        LogLevel::NOTICE => 2,
        LogLevel::WARNING => 3,
        LogLevel::ERROR => 4,
        LogLevel::CRITICAL => 5,
        LogLevel::ALERT => 6,
        LogLevel::EMERGENCY => 7,
    ];

    private readonly int $minLevel;

    public function __construct(string $minLevel = 'info')
    {
        $this->minLevel = self::LEVELS[strtolower($minLevel)] ?? self::LEVELS[LogLevel::INFO];
    }

    public function log($level, string|\Stringable $message, array $context = []): void
    {
        $level = strtolower((string) $level);
        if ((self::LEVELS[$level] ?? 1) < $this->minLevel) {
            return;
        }
        $record = [
            'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
            'level' => $level,
            'msg' => (string) $message,
        ];
        $clean = $this->scrub($context);
        if ($clean !== []) {
            $record['context'] = $clean;
        }
        $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($line === false) {
            $line = '{"timestamp":"' . gmdate('Y-m-d\TH:i:s\Z') . '","level":"error","msg":"log_encode_failed"}';
        }
        $stream = in_array($level, ['error', 'critical', 'alert', 'emergency'], true)
            ? 'php://stderr' : 'php://stdout';
        file_put_contents($stream, $line . "\n");
    }

    /** @param array<mixed> $context @return array<mixed> */
    private function scrub(array $context): array
    {
        $out = [];
        foreach ($context as $key => $value) {
            if (is_string($key) && preg_match('/password|secret|token|hash|authorization/i', $key)) {
                $out[$key] = '[redacted]';
            } elseif (is_array($value)) {
                $out[$key] = $this->scrub($value);
            } else {
                $out[$key] = $value;
            }
        }
        return $out;
    }
}
