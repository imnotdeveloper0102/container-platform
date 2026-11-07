<h1>Luật phát hiện</h1>
<div class="warning">
  <strong>Giới hạn quan trọng — đọc kỹ:</strong> lưu ở đây chỉ ghi vào bảng
  <code>detection_rules</code> để người vận hành xem/sửa. Analyzer-python hiện
  đọc ngưỡng từ biến môi trường (<code>BRUTE_FORCE_THRESHOLD</code>,
  <code>BRUTE_FORCE_WINDOW_SECONDS</code>, <code>PORT_SCAN_THRESHOLD</code>,
  <code>PORT_SCAN_WINDOW_SECONDS</code>, <code>ALERT_COOLDOWN_SECONDS</code>)
  <strong>khi khởi động</strong> và không tự reload khi DB đổi. Đổi rule trong
  trang này <strong>chưa tự áp dụng</strong> cho analyzer đang chạy — muốn áp
  dụng phải sửa env tương ứng rồi restart analyzer
  (<code>docker compose up -d --force-recreate analyzer-python</code> sau khi
  sửa <code>.env</code>).
</div>
<form method="post" action="/rules">
  <?= \Admin\Csrf::field() ?>
  <table>
    <tr><th>Key</th><th>Giá trị</th><th>Mô tả</th><th>Cập nhật lúc</th></tr>
    <?php foreach ($rules as $row): ?>
    <tr>
      <td><code><?= $e($row['key']) ?></code></td>
      <td><input type="number" name="rules[<?= $e($row['key']) ?>]" value="<?= $e($row['value']) ?>" required></td>
      <td><?= $e($row['description']) ?></td>
      <td><?= $e($row['updated_at']) ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
  <p><button type="submit">Lưu luật</button></p>
</form>
