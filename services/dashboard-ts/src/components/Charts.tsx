// Charts are hand-drawn SVG bars (no chart library dependency — fewer
// deps to audit, no version to pin, and the data sets here are small
// fixed series from /api/stats). All values come from the real API.
import type { Stats } from '../types';

function maxOf(values: number[]): number {
  return Math.max(1, ...values);
}

function BarChart(props: {
  title: string;
  data: { label: string; value: number }[];
  emptyText: string;
}): React.ReactElement {
  const { title, data, emptyText } = props;
  const max = maxOf(data.map((d) => d.value));
  const width = 560;
  const barHeight = 22;
  const gap = 8;
  const height = Math.max(40, data.length * (barHeight + gap) + 10);
  return (
    <section className="chart" aria-label={title}>
      <h3>{title}</h3>
      {data.length === 0 ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title}>
          {data.map((d, i) => {
            const y = 10 + i * (barHeight + gap);
            const barWidth = Math.max(d.value === 0 ? 0 : 4, (d.value / max) * 360);
            return (
              <g key={d.label}>
                <text x={0} y={y + 15} fontSize={12} fill="#333">{d.label}</text>
                <rect x={150} y={y} width={barWidth} height={barHeight} fill="#2563eb" rx={3} />
                <text x={150 + barWidth + 6} y={y + 15} fontSize={12} fill="#111">{d.value}</text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

export function StatsCharts(props: { stats: Stats }): React.ReactElement {
  const { stats } = props;
  const byType = Object.entries(stats.by_type)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const bySeverity = Object.entries(stats.by_severity)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  // by_day_last_7d comes DESC from the API; show oldest first.
  const byDay = [...stats.by_day_last_7d]
    .reverse()
    .map((d) => ({ label: d.day.slice(5), value: d.count }));
  // by_hour_last_24h comes DESC; show oldest first, label HH:00.
  const byHour = [...stats.by_hour_last_24h]
    .reverse()
    .map((d) => ({ label: new Date(d.hour).toISOString().slice(11, 13) + ':00', value: d.count }));
  return (
    <div className="charts">
      <BarChart title="Cảnh báo theo loại" data={byType} emptyText="Chưa có cảnh báo nào để thống kê theo loại." />
      <BarChart title="Cảnh báo theo mức độ" data={bySeverity} emptyText="Chưa có cảnh báo nào để thống kê theo mức độ." />
      <BarChart title="Cảnh báo theo ngày (7 ngày gần đây)" data={byDay} emptyText="Không có cảnh báo nào trong 7 ngày gần đây." />
      <BarChart title="Cảnh báo theo giờ (24 giờ gần đây)" data={byHour} emptyText="Không có cảnh báo nào trong 24 giờ gần đây." />
    </div>
  );
}
