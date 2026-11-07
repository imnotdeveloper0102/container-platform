<?php

declare(strict_types=1);

namespace Admin;

/**
 * Validate input phía server. Mọi hàm trả về null khi hợp lệ, hoặc chuỗi
 * lỗi (tiếng Việt) khi không hợp lệ. ruleValue() ném InvalidArgumentException.
 */
final class Validation
{
    /** @var array<string,array{0:int,1:int}> Khoảng cho phép của từng luật. */
    public const RULE_RANGES = [
        'BRUTE_FORCE_THRESHOLD' => [1, 1000],
        'BRUTE_FORCE_WINDOW_SECONDS' => [1, 86400],
        'PORT_SCAN_THRESHOLD' => [1, 1000],
        'PORT_SCAN_WINDOW_SECONDS' => [1, 86400],
        'ALERT_COOLDOWN_SECONDS' => [0, 604800],
    ];

    public static function username(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return 'Tên đăng nhập không được để trống.';
        }
        if (strlen($value) < 3 || strlen($value) > 64) {
            return 'Tên đăng nhập phải dài 3–64 ký tự.';
        }
        if (!preg_match('/^[A-Za-z0-9._-]+$/', $value)) {
            return 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang.';
        }
        return null;
    }

    public static function password(string $value): ?string
    {
        if (strlen($value) < 8) {
            return 'Mật khẩu phải dài ít nhất 8 ký tự.';
        }
        if (strlen($value) > 256) {
            return 'Mật khẩu quá dài (tối đa 256 ký tự).';
        }
        return null;
    }

    public static function role(string $value): ?string
    {
        return in_array($value, Auth::ROLES, true) ? null : 'Quyền không hợp lệ (admin, operator, viewer).';
    }

    /**
     * @throws \InvalidArgumentException khi key lạ hoặc giá trị ngoài khoảng.
     */
    public static function ruleValue(string $key, string $value): int
    {
        $range = self::RULE_RANGES[$key] ?? null;
        if ($range === null) {
            throw new \InvalidArgumentException("Luật không xác định: {$key}");
        }
        $value = trim($value);
        if ($value === '' || !ctype_digit($value)) {
            throw new \InvalidArgumentException("Giá trị của {$key} phải là số nguyên.");
        }
        $int = (int) $value;
        if ($int < $range[0] || $int > $range[1]) {
            throw new \InvalidArgumentException("Giá trị của {$key} phải trong khoảng {$range[0]}–{$range[1]}.");
        }
        return $int;
    }

    public static function settingKey(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return 'Key không được để trống.';
        }
        if (strlen($value) > 64) {
            return 'Key tối đa 64 ký tự.';
        }
        if (!preg_match('/^[a-z0-9][a-z0-9._-]*$/', $value)) {
            return 'Key chỉ gồm chữ thường, số, dấu chấm, gạch dưới, gạch ngang, bắt đầu bằng chữ hoặc số.';
        }
        return null;
    }

    public static function settingValue(string $value): ?string
    {
        return strlen($value) > 1000 ? 'Giá trị tối đa 1000 ký tự.' : null;
    }

    public static function id(string $value): ?int
    {
        $value = trim($value);
        if ($value === '' || !ctype_digit($value)) {
            return null;
        }
        $int = (int) $value;
        return $int > 0 ? $int : null;
    }
}
