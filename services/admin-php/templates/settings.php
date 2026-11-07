<h1>Cấu hình hệ thống</h1>
<p class="muted">Phạm vi: bảng <code>settings</code> chỉ chứa cấu hình chung mà trang quản trị này đọc
(<code>site.title</code>, <code>alerts.page_size</code>) và các key vận hành tự thêm.
Nó <strong>không</strong> điều khiển collector-go, analyzer-python hay api-node — các service đó vẫn đọc env của chính chúng.</p>
<form method="post" action="/settings">
  <?= \Admin\Csrf::field() ?>
  <table>
    <tr><th>Key</th><th>Giá trị</th><th>Mô tả</th><th>Cập nhật lúc</th></tr>
    <?php foreach ($settings as $row): ?>
    <tr>
      <td><code><?= $e($row['key']) ?></code></td>
      <td><input type="text" name="settings[<?= $e($row['key']) ?>]" value="<?= $e($row['value']) ?>" required></td>
      <td><?= $e($row['description']) ?></td>
      <td><?= $e($row['updated_at']) ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
  <p><button type="submit">Lưu cấu hình</button></p>
</form>

<div class="card">
  <h2>Thêm key mới</h2>
  <form method="post" action="/settings/new">
    <?= \Admin\Csrf::field() ?>
    <label for="key">Key</label>
    <input type="text" id="key" name="key" required>
    <label for="value">Giá trị</label>
    <input type="text" id="value" name="value" required>
    <label for="description">Mô tả</label>
    <input type="text" id="description" name="description">
    <p><button type="submit">Thêm</button></p>
  </form>
  <p class="muted">Lưu ý: thêm key mới chỉ lưu vào DB; chỉ các key mà code đọc (<code>site.title</code>, <code>alerts.page_size</code>) mới có tác dụng thật.</p>
</div>
