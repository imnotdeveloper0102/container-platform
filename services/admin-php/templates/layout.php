<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $e($title ?? 'Quản trị') ?> — container-platform</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; color: #1a1a1a; background: #f6f6f6; }
  header { background: #1f2937; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  header a { color: #fff; text-decoration: none; }
  nav { background: #374151; padding: 8px 20px; }
  nav a { color: #e5e7eb; margin-right: 16px; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  main { max-width: 960px; margin: 20px auto; padding: 0 16px 40px; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin: 12px 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
  th { background: #e5e7eb; }
  .card { background: #fff; border: 1px solid #d1d5db; padding: 16px; margin: 12px 0; }
  .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; margin: 12px 0; }
  .flash { padding: 10px 12px; margin: 12px 0; border: 1px solid; }
  .flash.ok { background: #dcfce7; border-color: #16a34a; }
  .flash.error { background: #fee2e2; border-color: #dc2626; }
  .error-list { color: #b91c1c; }
  label { display: block; margin: 10px 0 4px; font-weight: 600; }
  input[type=text], input[type=password], input[type=number], select { padding: 8px; width: 100%; max-width: 420px; box-sizing: border-box; }
  button, .btn { background: #1f2937; color: #fff; border: none; padding: 8px 16px; cursor: pointer; text-decoration: none; display: inline-block; font-size: 14px; }
  button.danger { background: #b91c1c; }
  form.inline { display: inline; }
  .muted { color: #6b7280; font-size: 14px; }
  footer { text-align: center; color: #6b7280; font-size: 13px; padding: 20px; }
</style>
</head>
<body>
<header>
  <a href="/dashboard"><strong>container-platform — trang quản trị</strong></a>
  <?php if (!empty($user)): ?>
    <span><?= $e($user['username']) ?> (<?= $e($user['role']) ?>)
      <form class="inline" method="post" action="/logout"><?= \Admin\Csrf::field() ?><button type="submit">Đăng xuất</button></form>
    </span>
  <?php endif; ?>
</header>
<?php if (!empty($user)): ?>
<nav>
  <a href="/dashboard">Tổng quan</a>
  <?php if (($user['role'] ?? '') === 'admin'): ?><a href="/users">Người dùng</a><?php endif; ?>
  <?php if (in_array($user['role'] ?? '', ['admin', 'operator'], true)): ?><a href="/rules">Luật phát hiện</a><a href="/settings">Cấu hình hệ thống</a><?php endif; ?>
</nav>
<?php endif; ?>
<main>
  <?php if (!empty($flash)): ?>
    <p class="flash <?= $e($flash['type']) ?>"><?= $e($flash['msg']) ?></p>
  <?php endif; ?>
  <?= $content ?>
</main>
<footer>admin-php — đăng nhập bằng session riêng, không dùng JWT của api-node.</footer>
</body>
</html>
