<h1><?= $e($title) ?></h1>
<?php if (!empty($errors)): ?>
  <ul class="error-list"><?php foreach ($errors as $err): ?><li><?= $e($err) ?></li><?php endforeach; ?></ul>
<?php endif; ?>
<?php $isEdit = !empty($user['id']); ?>
<form method="post" action="<?= $isEdit ? '/users/' . $e($user['id']) . '/edit' : '/users' ?>">
  <?= \Admin\Csrf::field() ?>
  <label for="username">Tên đăng nhập</label>
  <input type="text" id="username" name="username" required value="<?= $e($user['username'] ?? '') ?>" autocomplete="username">
  <label for="password">Mật khẩu <?= $isEdit ? '(để trống để giữ mật khẩu cũ)' : '' ?></label>
  <input type="password" id="password" name="password" <?= $isEdit ? '' : 'required' ?> autocomplete="new-password">
  <p class="muted">Mật khẩu tối thiểu 8 ký tự, lưu dạng hash Argon2id (password_hash).</p>
  <label for="role">Quyền</label>
  <select id="role" name="role">
    <?php foreach (['admin', 'operator', 'viewer'] as $r): ?>
      <option value="<?= $e($r) ?>" <?= (($user['role'] ?? 'viewer') === $r) ? 'selected' : '' ?>><?= $e($r) ?></option>
    <?php endforeach; ?>
  </select>
  <p><button type="submit"><?= $isEdit ? 'Lưu thay đổi' : 'Tạo người dùng' ?></button>
  <a href="/users">Hủy</a></p>
</form>
