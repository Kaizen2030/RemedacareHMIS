export default function DepartmentMetrics({ css, stats }) {
  return (
    <div style={css.statRow}>
      {stats.map((stat) => (
        <div key={stat.label} style={css.statCard(stat.color)}>
          <div style={{ ...css.statNum, color: stat.color }}>{stat.value}</div>
          <div style={css.statLbl}>{stat.label}</div>
        </div>
      ))}
    </div>
  )
}
