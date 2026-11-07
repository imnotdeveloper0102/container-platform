<?php

declare(strict_types=1);

namespace Admin;

/** Token CSRF đơn giản, lưu trong session, so bằng hash_equals. */
final class Csrf
{
    public static function token(): string
    {
        if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    public static function validate(?string $token): bool
    {
        $stored = $_SESSION['csrf_token'] ?? '';
        if (!is_string($stored) || $stored === '' || $token === null || $token === '') {
            return false;
        }
        return hash_equals($stored, $token);
    }

    public static function field(): string
    {
        return '<input type="hidden" name="csrf_token" value="'
            . htmlspecialchars(self::token(), ENT_QUOTES, 'UTF-8') . '">';
    }
}
