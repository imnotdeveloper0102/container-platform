<?php

declare(strict_types=1);

namespace Admin;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\App;
use Slim\Factory\AppFactory;
use Slim\Psr7\Response as Psr7Response;

/** Tạo Slim app. $pdo = null khi chưa kết nối được DB (readyz sẽ 503). */
final class AdminApp
{
    public static function create(Config $config, ?\PDO $pdo, JsonLogger $log): App
    {
        if ($pdo !== null) {
            try {
                Migrations::apply($pdo, $config, $log);
            } catch (\Throwable $e) {
                $log->error('db_migration_failed', ['error' => $e->getMessage()]);
            }
        }

        $app = AppFactory::create();
        $app->addBodyParsingMiddleware();
        $app->addRoutingMiddleware();
        $app->addErrorMiddleware($config->appEnv === 'development', false, false);

        $view = new View(__DIR__ . '/../templates');

        // Log request JSON một dòng (không log body, không log secret).
        $app->add(function (Request $request, Handler $handler) use ($log): Response {
            $response = $handler->handle($request);
            $log->info('http_request', [
                'method' => $request->getMethod(),
                'path' => $request->getUri()->getPath(),
                'status' => $response->getStatusCode(),
            ]);
            return $response;
        });

        // Session chỉ mở cho route không phải health (healthz/readyz không
        // cần cookie session).
        $app->add(function (Request $request, Handler $handler) use ($config): Response {
            $path = $request->getUri()->getPath();
            if ($path !== '/healthz' && $path !== '/readyz') {
                Auth::startSession($config);
            }
            return $handler->handle($request);
        });

        $json = static function (Response $response, array $data, int $status = 200): Response {
            $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $response->getBody()->write($body === false ? '{}' : $body);
            return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
        };
        $redirect = static fn(string $to): Response => (new Psr7Response())->withHeader('Location', $to)->withStatus(302);
        $html = static function (Response $response, string $body, int $status = 200): Response {
            $response->getBody()->write($body);
            return $response->withHeader('Content-Type', 'text/html; charset=utf-8')->withStatus($status);
        };
        // Trang HTML đầy đủ (layout + nội dung), kèm user + flash hiện tại.
        $page = static function (Response $response, string $template, array $data = [], int $status = 200) use ($view, $html): Response {
            $data['user'] = Auth::currentUser();
            $data['flash'] = View::takeFlash();
            $content = $view->render($template, $data);
            $full = $view->render('layout.php', array_merge($data, [
                'title' => $data['title'] ?? 'Quản trị',
                'content' => $content,
            ]));
            return $html($response, $full, $status);
        };
        // Chưa có DB thì trang quản trị trả 503 thay vì lỗi 500 khó hiểu.
        $requireDb = static function (Request $request, Handler $handler) use ($pdo, $page): Response {
            if ($pdo === null) {
                return $page(new Psr7Response(), 'error.php', [
                    'title' => 'Cơ sở dữ liệu chưa sẵn sàng',
                    'message' => 'Chưa kết nối được PostgreSQL. Kiểm tra lại service postgres rồi tải lại trang.',
                ], 503);
            }
            return $handler->handle($request);
        };
        $requireAuth = static function (Request $request, Handler $handler) use ($redirect): Response {
            if (Auth::currentUser() === null) {
                return $redirect('/login');
            }
            return $handler->handle($request);
        };
        $requireRole = static function (string ...$roles) use ($page): callable {
            return static function (Request $request, Handler $handler) use ($roles, $page): Response {
                $user = Auth::currentUser();
                if ($user === null) {
                    return (new Psr7Response())->withHeader('Location', '/login')->withStatus(302);
                }
                if (!in_array($user['role'], $roles, true)) {
                    return $page(new Psr7Response(), 'error.php', [
                        'title' => 'Không có quyền',
                        'message' => 'Tài khoản của bạn không có quyền thực hiện thao tác này.',
                    ], 403);
                }
                return $handler->handle($request);
            };
        };

        // ---- Health / readiness: không yêu cầu đăng nhập. ----
        $app->get('/healthz', function (Request $request, Response $response) use ($json): Response {
            return $json($response, ['status' => 'ok', 'service' => 'admin-php']);
        });
        $app->get('/readyz', function (Request $request, Response $response) use ($json, $pdo): Response {
            if ($pdo === null) {
                return $json($response, ['status' => 'not_ready', 'reason' => 'no_db_connection'], 503);
            }
            try {
                $pdo->query('SELECT 1');
                return $json($response, ['status' => 'ready']);
            } catch (\PDOException) {
                return $json($response, ['status' => 'not_ready', 'reason' => 'db_ping_failed'], 503);
            }
        });

        $app->get('/', function (Request $request, Response $response) use ($redirect): Response {
            return $redirect('/dashboard');
        });

        // ---- Đăng nhập / đăng xuất ----
        $app->get('/login', function (Request $request, Response $response) use ($page): Response {
            if (Auth::currentUser() !== null) {
                return (new Psr7Response())->withHeader('Location', '/dashboard')->withStatus(302);
            }
            return $page($response, 'login.php', ['title' => 'Đăng nhập']);
        });
        $app->post('/login', function (Request $request, Response $response) use ($pdo, $page, $log): Response {
            if ($pdo === null) {
                return $page($response, 'error.php', [
                    'title' => 'Cơ sở dữ liệu chưa sẵn sàng',
                    'message' => 'Chưa kết nối được PostgreSQL nên chưa đăng nhập được. Kiểm tra lại service postgres rồi thử lại.',
                ], 503);
            }
            $body = (array) $request->getParsedBody();
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                return $page($response, 'login.php', ['title' => 'Đăng nhập', 'error' => 'Phiên đã hết hạn, vui lòng tải lại trang.'], 400);
            }
            if (Auth::isLockedOut()) {
                return $page($response, 'login.php', ['title' => 'Đăng nhập', 'error' => 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.'], 429);
            }
            $username = trim((string) ($body['username'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $user = $pdo !== null ? Auth::login($pdo, $username, $password) : null;
            if ($user === null) {
                Auth::recordFailedLogin();
                $log->warning('login_failed', ['username' => $username]);
                return $page($response, 'login.php', ['title' => 'Đăng nhập', 'error' => 'Tên đăng nhập hoặc mật khẩu không đúng.'], 401);
            }
            Auth::clearFailedLogins();
            Auth::setSessionUser($user);
            $log->info('login_ok', ['username' => $user['username'], 'role' => $user['role']]);
            return (new Psr7Response())->withHeader('Location', '/dashboard')->withStatus(302);
        });
        $app->post('/logout', function (Request $request, Response $response) use ($log): Response {
            $user = Auth::currentUser();
            if ($user !== null) {
                $log->info('logout', ['username' => $user['username']]);
            }
            Auth::logout();
            return (new Psr7Response())->withHeader('Location', '/login')->withStatus(302);
        })->add($requireAuth);

        // ---- Trang tổng quan: đếm alerts từ DB thật. ----
        $app->get('/dashboard', function (Request $request, Response $response) use ($pdo, $page): Response {
            $total = (int) $pdo->query('SELECT COUNT(*) FROM alerts')->fetchColumn();
            $byType = $pdo->query('SELECT type, COUNT(*) AS n FROM alerts GROUP BY type ORDER BY n DESC')->fetchAll();
            $bySeverity = $pdo->query('SELECT severity, COUNT(*) AS n FROM alerts GROUP BY severity ORDER BY n DESC')->fetchAll();
            $byStatus = $pdo->query("SELECT status, COUNT(*) AS n FROM alerts GROUP BY status ORDER BY n DESC")->fetchAll();
            $pageSize = self::pageSize($pdo);
            $recentStmt = $pdo->prepare(
                'SELECT id, created_at, ip, type, severity, count, status FROM alerts '
                . 'ORDER BY created_at DESC LIMIT :limit',
            );
            $recentStmt->bindValue('limit', $pageSize, \PDO::PARAM_INT);
            $recentStmt->execute();
            $recent = $recentStmt->fetchAll();
            $rules = $pdo->query('SELECT key, value FROM detection_rules ORDER BY key')->fetchAll();
            $userCount = (int) $pdo->query('SELECT COUNT(*) FROM app_users')->fetchColumn();
            return $page($response, 'dashboard.php', [
                'title' => 'Tổng quan',
                'total' => $total,
                'byType' => $byType,
                'bySeverity' => $bySeverity,
                'byStatus' => $byStatus,
                'recent' => $recent,
                'rules' => $rules,
                'userCount' => $userCount,
            ]);
        })->add($requireDb)->add($requireAuth);

        // ---- Quản trị người dùng (chỉ admin). ----
        $app->get('/users', function (Request $request, Response $response) use ($pdo, $page): Response {
            $users = $pdo->query('SELECT id, username, role, created_at FROM app_users ORDER BY id')->fetchAll();
            return $page($response, 'users.php', ['title' => 'Người dùng', 'users' => $users]);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin'));

        $app->get('/users/new', function (Request $request, Response $response) use ($page): Response {
            return $page($response, 'user_form.php', ['title' => 'Thêm người dùng', 'user' => null, 'errors' => []]);
        })->add($requireAuth)->add($requireRole('admin'));

        $app->post('/users', function (Request $request, Response $response) use ($pdo, $page, $log): Response {
            $body = (array) $request->getParsedBody();
            $username = trim((string) ($body['username'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $role = (string) ($body['role'] ?? 'viewer');
            $errors = self::collectUserErrors($username, $password, $role);
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                $errors[] = 'Phiên đã hết hạn, vui lòng tải lại trang.';
            }
            if ($errors !== []) {
                return $page($response, 'user_form.php', ['title' => 'Thêm người dùng', 'user' => ['username' => $username, 'role' => $role], 'errors' => $errors], 400);
            }
            try {
                $stmt = $pdo->prepare('INSERT INTO app_users (username, password_hash, role) VALUES (:username, :hash, :role)');
                $stmt->execute(['username' => $username, 'hash' => Auth::hashPassword($password), 'role' => $role]);
            } catch (\PDOException $e) {
                if ($e->getCode() === '23505') {
                    return $page($response, 'user_form.php', ['title' => 'Thêm người dùng', 'user' => ['username' => $username, 'role' => $role], 'errors' => ['Tên đăng nhập đã tồn tại.']], 400);
                }
                throw $e;
            }
            $log->info('user_created', ['username' => $username, 'role' => $role]);
            View::setFlash('ok', "Đã tạo người dùng {$username}.");
            return (new Psr7Response())->withHeader('Location', '/users')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin'));

        $app->get('/users/{id}/edit', function (Request $request, Response $response, array $args) use ($pdo, $page): Response {
            $id = Validation::id((string) ($args['id'] ?? ''));
            $user = $id !== null ? self::findUser($pdo, $id) : null;
            if ($user === null) {
                return $page($response, 'error.php', ['title' => 'Không tìm thấy', 'message' => 'Không có người dùng này.'], 404);
            }
            return $page($response, 'user_form.php', ['title' => 'Sửa người dùng', 'user' => $user, 'errors' => []]);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin'));

        $app->post('/users/{id}/edit', function (Request $request, Response $response, array $args) use ($pdo, $page, $log): Response {
            $id = Validation::id((string) ($args['id'] ?? ''));
            $user = $id !== null ? self::findUser($pdo, $id) : null;
            if ($user === null) {
                return $page($response, 'error.php', ['title' => 'Không tìm thấy', 'message' => 'Không có người dùng này.'], 404);
            }
            $body = (array) $request->getParsedBody();
            $username = trim((string) ($body['username'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $role = (string) ($body['role'] ?? $user['role']);
            $errors = [];
            if (($e = Validation::username($username)) !== null) {
                $errors[] = $e;
            }
            if ($password !== '' && ($e = Validation::password($password)) !== null) {
                $errors[] = $e;
            }
            if (($e = Validation::role($role)) !== null) {
                $errors[] = $e;
            }
            $me = Auth::currentUser();
            if ($me !== null && (int) $me['id'] === (int) $user['id'] && $role !== $user['role']) {
                $errors[] = 'Không được tự đổi quyền của chính mình.';
            }
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                $errors[] = 'Phiên đã hết hạn, vui lòng tải lại trang.';
            }
            if ($errors !== []) {
                $formUser = ['id' => $user['id'], 'username' => $username, 'role' => $role, 'created_at' => $user['created_at']];
                return $page($response, 'user_form.php', ['title' => 'Sửa người dùng', 'user' => $formUser, 'errors' => $errors], 400);
            }
            try {
                if ($password !== '') {
                    $stmt = $pdo->prepare('UPDATE app_users SET username = :username, password_hash = :hash, role = :role WHERE id = :id');
                    $stmt->execute(['username' => $username, 'hash' => Auth::hashPassword($password), 'role' => $role, 'id' => $id]);
                } else {
                    $stmt = $pdo->prepare('UPDATE app_users SET username = :username, role = :role WHERE id = :id');
                    $stmt->execute(['username' => $username, 'role' => $role, 'id' => $id]);
                }
            } catch (\PDOException $e) {
                if ($e->getCode() === '23505') {
                    $formUser = ['id' => $user['id'], 'username' => $username, 'role' => $role, 'created_at' => $user['created_at']];
                    return $page($response, 'user_form.php', ['title' => 'Sửa người dùng', 'user' => $formUser, 'errors' => ['Tên đăng nhập đã tồn tại.']], 400);
                }
                throw $e;
            }
            $log->info('user_updated', ['username' => $username, 'role' => $role]);
            View::setFlash('ok', "Đã cập nhật người dùng {$username}.");
            return (new Psr7Response())->withHeader('Location', '/users')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin'));

        $app->post('/users/{id}/delete', function (Request $request, Response $response, array $args) use ($pdo, $log): Response {
            $body = (array) $request->getParsedBody();
            $id = Validation::id((string) ($args['id'] ?? ''));
            $user = $id !== null ? self::findUser($pdo, $id) : null;
            $me = Auth::currentUser();
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                View::setFlash('error', 'Phiên đã hết hạn, vui lòng tải lại trang.');
            } elseif ($user === null) {
                View::setFlash('error', 'Không có người dùng này.');
            } elseif ($me !== null && (int) $me['id'] === (int) $user['id']) {
                View::setFlash('error', 'Không được tự xóa tài khoản của chính mình.');
            } else {
                $adminCount = (int) $pdo->query("SELECT COUNT(*) FROM app_users WHERE role = 'admin'")->fetchColumn();
                if ($user['role'] === 'admin' && $adminCount <= 1) {
                    View::setFlash('error', 'Không được xóa admin cuối cùng.');
                } else {
                    $stmt = $pdo->prepare('DELETE FROM app_users WHERE id = :id');
                    $stmt->execute(['id' => $id]);
                    $log->info('user_deleted', ['username' => $user['username']]);
                    View::setFlash('ok', "Đã xóa người dùng {$user['username']}.");
                }
            }
            return (new Psr7Response())->withHeader('Location', '/users')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin'));

        // ---- Luật phát hiện (admin + operator). ----
        // LƯU Ý QUAN TRỌNG: bảng detection_rules chỉ là nơi vận hành xem/sửa
        // cấu hình. analyzer-python hiện đọc ngưỡng từ biến môi trường khi
        // khởi động, nên đổi rule ở đây CHƯA tự áp dụng cho analyzer đang
        // chạy — cần restart analyzer với env mới (xem README).
        $app->get('/rules', function (Request $request, Response $response) use ($pdo, $page): Response {
            $rules = $pdo->query('SELECT key, value, description, updated_at FROM detection_rules ORDER BY key')->fetchAll();
            return $page($response, 'rules.php', ['title' => 'Luật phát hiện', 'rules' => $rules]);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin', 'operator'));

        $app->post('/rules', function (Request $request, Response $response) use ($pdo, $log): Response {
            $body = (array) $request->getParsedBody();
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                View::setFlash('error', 'Phiên đã hết hạn, vui lòng tải lại trang.');
                return (new Psr7Response())->withHeader('Location', '/rules')->withStatus(302);
            }
            $values = $body['rules'] ?? [];
            if (!is_array($values)) {
                View::setFlash('error', 'Dữ liệu gửi lên không hợp lệ.');
                return (new Psr7Response())->withHeader('Location', '/rules')->withStatus(302);
            }
            $validated = [];
            foreach ($values as $key => $value) {
                try {
                    $validated[(string) $key] = Validation::ruleValue((string) $key, (string) $value);
                } catch (\InvalidArgumentException $e) {
                    View::setFlash('error', $e->getMessage());
                    return (new Psr7Response())->withHeader('Location', '/rules')->withStatus(302);
                }
            }
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('UPDATE detection_rules SET value = :value, updated_at = now() WHERE key = :key');
            foreach ($validated as $key => $value) {
                $stmt->execute(['value' => (string) $value, 'key' => $key]);
            }
            $pdo->commit();
            $log->info('rules_updated', ['keys' => array_keys($validated)]);
            View::setFlash('ok', 'Đã lưu luật phát hiện. Nhắc lại: analyzer đang chạy chưa tự áp dụng — cần restart analyzer với env mới.');
            return (new Psr7Response())->withHeader('Location', '/rules')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin', 'operator'));

        // ---- Cấu hình hệ thống (admin + operator). ----
        // Phạm vi: bảng settings chỉ chứa key/value chung mà trang quản trị
        // này đọc (site.title, alerts.page_size) và các key vận hành tự thêm.
        // Nó KHÔNG điều khiển collector-go, analyzer-python hay api-node —
        // các service đó vẫn đọc env của chính chúng.
        $app->get('/settings', function (Request $request, Response $response) use ($pdo, $page): Response {
            $settings = $pdo->query('SELECT key, value, description, updated_at FROM settings ORDER BY key')->fetchAll();
            return $page($response, 'settings.php', ['title' => 'Cấu hình hệ thống', 'settings' => $settings]);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin', 'operator'));

        $app->post('/settings', function (Request $request, Response $response) use ($pdo, $log): Response {
            $body = (array) $request->getParsedBody();
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                View::setFlash('error', 'Phiên đã hết hạn, vui lòng tải lại trang.');
                return (new Psr7Response())->withHeader('Location', '/settings')->withStatus(302);
            }
            $values = $body['settings'] ?? [];
            if (!is_array($values)) {
                View::setFlash('error', 'Dữ liệu gửi lên không hợp lệ.');
                return (new Psr7Response())->withHeader('Location', '/settings')->withStatus(302);
            }
            foreach ($values as $key => $value) {
                if (($e = Validation::settingValue((string) $value)) !== null) {
                    View::setFlash('error', "Key {$key}: {$e}");
                    return (new Psr7Response())->withHeader('Location', '/settings')->withStatus(302);
                }
            }
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('UPDATE settings SET value = :value, updated_at = now() WHERE key = :key');
            foreach ($values as $key => $value) {
                $stmt->execute(['value' => (string) $value, 'key' => (string) $key]);
            }
            $pdo->commit();
            $log->info('settings_updated', ['keys' => array_keys($values)]);
            View::setFlash('ok', 'Đã lưu cấu hình hệ thống.');
            return (new Psr7Response())->withHeader('Location', '/settings')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin', 'operator'));

        $app->post('/settings/new', function (Request $request, Response $response) use ($pdo, $log): Response {
            $body = (array) $request->getParsedBody();
            $key = trim((string) ($body['key'] ?? ''));
            $value = (string) ($body['value'] ?? '');
            $description = trim((string) ($body['description'] ?? ''));
            if (!Csrf::validate(isset($body['csrf_token']) ? (string) $body['csrf_token'] : null)) {
                View::setFlash('error', 'Phiên đã hết hạn, vui lòng tải lại trang.');
            } elseif (($e = Validation::settingKey($key)) !== null) {
                View::setFlash('error', $e);
            } elseif (($e = Validation::settingValue($value)) !== null) {
                View::setFlash('error', $e);
            } else {
                try {
                    $stmt = $pdo->prepare('INSERT INTO settings (key, value, description) VALUES (:key, :value, :description)');
                    $stmt->execute(['key' => $key, 'value' => $value, 'description' => $description]);
                    $log->info('setting_created', ['key' => $key]);
                    View::setFlash('ok', "Đã thêm setting {$key}.");
                } catch (\PDOException $e) {
                    if ($e->getCode() === '23505') {
                        View::setFlash('error', "Key {$key} đã tồn tại.");
                    } else {
                        throw $e;
                    }
                }
            }
            return (new Psr7Response())->withHeader('Location', '/settings')->withStatus(302);
        })->add($requireDb)->add($requireAuth)->add($requireRole('admin', 'operator'));

        return $app;
    }

    /** @return array{id: int, username: string, role: string, created_at: string}|null */
    private static function findUser(\PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare('SELECT id, username, role, created_at FROM app_users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $user = $stmt->fetch();
        return $user === false ? null : $user;
    }

    /** @return string[] */
    private static function collectUserErrors(string $username, string $password, string $role): array
    {
        $errors = [];
        if (($e = Validation::username($username)) !== null) {
            $errors[] = $e;
        }
        if (($e = Validation::password($password)) !== null) {
            $errors[] = $e;
        }
        if (($e = Validation::role($role)) !== null) {
            $errors[] = $e;
        }
        return $errors;
    }

    private static function pageSize(\PDO $pdo): int
    {
        try {
            $stmt = $pdo->prepare("SELECT value FROM settings WHERE key = 'alerts.page_size'");
            $stmt->execute();
            $raw = $stmt->fetchColumn();
            $size = $raw === false ? 10 : (int) $raw;
            return min(50, max(5, $size));
        } catch (\PDOException) {
            return 10;
        }
    }
}
