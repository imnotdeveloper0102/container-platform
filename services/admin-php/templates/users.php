<h1>Người dùng</h1>
<p><a class="btn" href="/users/new">Thêm người dùng</a></p>
<table>
  <tr><th>ID</th><th>Tên đăng nhập</th><th>Quyền</th><th>Tạo lúc</th><th>Thao tác</th></tr>
  <?php foreach ($users as $u): ?>
  <tr>
    <td><?= $e($u['id']) ?></td>
    <td><?= $e($u['username']) ?></td>
    <td><?= $e($u['role']) ?></td>
    <td><?= $e($u['created_at']) ?></td>
    <td>
      <a href="/users/<?= $e($u['id']) ?>/edit">Sửa</a>
      <form class="inline" method="post" action="/users/<?= $e($u['id']) ?>/delete" onsubmit="return confirm('Xóa người dùng <?= $e($u['username']) ?>?');">
        <?= \Admin\Csrf::field() ?><button type="submit" class="danger">Xóa</button>
      </form>
    </td>
  </tr>
  <?php endforeach; ?>
</table>
<p class="muted">Quyền: admin (toàn quyền), operator (luật + cấu hình, không quản lý người dùng), viewer (chỉ xem).</p>
