<?php

declare(strict_types=1);

namespace Admin;

/**
 * Đăng nhập bằng session PHP (không dùng JWT của api-node — đây là hệ
 * quản trị riêng). Mật khẩu hash bằng password_hash (Argon2id khi có,
 * ngược lại PASSWORD_DEFAULT) và kiểm tra bằng password_verify.
 */
final class Auth
{
    public const ROLES = ['admin', 'operator', 'viewer'];

    public static function hashPassword(string $password): string
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        $hash = password_hash($password, $algo);
        if ($hash === false) {
            throw new \RuntimeException('password_hash failed');
        }
        return $hash;
    }

    public static function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function startSession(Config $config): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $config->sessionSecure,
        ]);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) ($config->sessionLifetimeMinutes * 60));
        session_start();
    }

    /**
     * Trả về ['id','username','role'] khi đúng, null khi sai. Không tiết lộ
     * user có tồn tại hay không (sai user và sai pass đều trả null).
     *
     * @return array{id: int, username: string, role: string}|null
     */
    public static function login(\PDO $pdo, string $username, string $password): ?array
    {
        $stmt = $pdo->prepare('SELECT id, username, password_hash, role FROM app_users WHERE username = :username');
        $stmt->execute(['username' => $username]);
        $user = $stmt->fetch();
        if ($user === false || !self::verifyPassword($password, (string) $user['password_hash'])) {
            return null;
        }
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        if (password_needs_rehash((string) $user['password_hash'], $algo)) {
            $update = $pdo->prepare('UPDATE app_users SET password_hash = :hash WHERE id = :id');
            $update->execute(['hash' => self::hashPassword($password), 'id' => $user['id']]);
        }
        return ['id' => (int) $user['id'], 'username' => (string) $user['username'], 'role' => (string) $user['role']];
    }

    /** @param array{id: int, username: string, role: string} $user */
    public static function setSessionUser(array $user): void
    {
        session_regenerate_id(true);
        $_SESSION['admin_user'] = $user;
    }

    /** @return array{id: int, username: string, role: string}|null */
    public static function currentUser(): ?array
    {
        $user = $_SESSION['admin_user'] ?? null;
        return is_array($user) && isset($user['id'], $user['username'], $user['role']) ? $user : null;
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                (string) session_name(),
                '',
                time() - 42000,
                (string) ($params['path'] ?? '/'),
                (string) ($params['domain'] ?? ''),
                (bool) ($params['secure'] ?? false),
                (bool) ($params['httponly'] ?? true),
            );
        }
        session_destroy();
    }

    // Chống dò mật khẩu cơ bản, theo session (kẻ tấn công đổi cookie thì
    // qua được — đây không phải rate limit hạ tầng, xem README).
    public static function isLockedOut(): bool
    {
        return (int) ($_SESSION['login_locked_until'] ?? 0) > time();
    }

    public static function recordFailedLogin(): void
    {
        $count = (int) ($_SESSION['login_failures'] ?? 0) + 1;
        $_SESSION['login_failures'] = $count;
        if ($count >= 5) {
            $_SESSION['login_locked_until'] = time() + 900;
            $_SESSION['login_failures'] = 0;
        }
    }

    public static function clearFailedLogins(): void
    {
        unset($_SESSION['login_failures'], $_SESSION['login_locked_until']);
    }
}
