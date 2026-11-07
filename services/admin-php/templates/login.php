<h1>Đăng nhập quản trị</h1>
<p class="muted">Tài khoản seed chỉ tạo từ biến môi trường ADMIN_USER / ADMIN_PASSWORD khi bảng người dùng còn trống. Trang này không dùng tài khoản của api-node.</p>
<?php if (!empty($error)): ?>
  <p class="flash error"><?= $e($error) ?></p>
<?php endif; ?>
<form method="post" action="/login">
  <?= \Admin\Csrf::field() ?>
  <label for="username">Tên đăng nhập</label>
  <input type="text" id="username" name="username" required autocomplete="username" autofocus>
  <label for="password">Mật khẩu</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">
  <p><button type="submit">Đăng nhập</button></p>
</form>
