<h1>Tổng quan</h1>
<p>Số liệu đếm từ bảng <code>alerts</code> thật trong PostgreSQL. Người dùng quản trị hiện có: <strong><?= $e($userCount) ?></strong>.</p>

<div class="card">
  <h2>Cảnh báo: <?= $e($total) ?></h2>
  <h3>Theo loại</h3>
  <?php if ($byType === []): ?><p class="muted">Chưa có cảnh báo nào.</p>
  <?php else: ?>
  <table><tr><th>Loại</th><th>Số lượng</th></tr>
    <?php foreach ($byType as $row): ?><tr><td><?= $e($row['type']) ?></td><td><?= $e($row['n']) ?></td></tr><?php endforeach; ?>
  </table>
  <?php endif; ?>
  <h3>Theo mức độ</h3>
  <?php if ($bySeverity === []): ?><p class="muted">Chưa có cảnh báo nào.</p>
  <?php else: ?>
  <table><tr><th>Mức độ</th><th>Số lượng</th></tr>
    <?php foreach ($bySeverity as $row): ?><tr><td><?= $e($row['severity']) ?></td><td><?= $e($row['n']) ?></td></tr><?php endforeach; ?>
  </table>
  <?php endif; ?>
  <h3>Theo trạng thái</h3>
  <?php if ($byStatus === []): ?><p class="muted">Chưa có cảnh báo nào.</p>
  <?php else: ?>
  <table><tr><th>Trạng thái</th><th>Số lượng</th></tr>
    <?php foreach ($byStatus as $row): ?><tr><td><?= $e($row['status']) ?></td><td><?= $e($row['n']) ?></td></tr><?php endforeach; ?>
  </table>
  <?php endif; ?>
</div>

<div class="card">
  <h2>Cảnh báo gần nhất</h2>
  <?php if ($recent === []): ?><p class="muted">Chưa có cảnh báo nào.</p>
  <?php else: ?>
  <table>
    <tr><th>ID</th><th>Thời gian</th><th>IP</th><th>Loại</th><th>Mức độ</th><th>Số lần</th><th>Trạng thái</th></tr>
    <?php foreach ($recent as $row): ?>
    <tr>
      <td><?= $e($row['id']) ?></td>
      <td><?= $e($row['created_at']) ?></td>
      <td><?= $e($row['ip']) ?></td>
      <td><?= $e($row['type']) ?></td>
      <td><?= $e($row['severity']) ?></td>
      <td><?= $e($row['count']) ?></td>
      <td><?= $e($row['status']) ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
  <?php endif; ?>
</div>

<div class="card">
  <h2>Luật phát hiện hiện tại (bảng detection_rules)</h2>
  <table><tr><th>Key</th><th>Giá trị</th></tr>
    <?php foreach ($rules as $row): ?><tr><td><?= $e($row['key']) ?></td><td><?= $e($row['value']) ?></td></tr><?php endforeach; ?>
  </table>
  <div class="warning"><strong>Lưu ý:</strong> analyzer-python đọc ngưỡng từ biến môi trường khi khởi động. Đổi rule trong trang quản trị chỉ lưu vào DB, <strong>chưa tự áp dụng</strong> cho analyzer đang chạy — cần restart analyzer với env mới. Xem mục “Luật phát hiện”.</div>
</div>
