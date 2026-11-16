// Neutral count tiles; a number turns dark red only when it needs attention (stat.alert).
export default function DepartmentMetrics({ css, stats }) {
  return (
    <div style={css.statRow}>
      {stats.map((stat) => (
        <div key={stat.label} style={css.statCard()}>
          <div style={{ ...css.statNum, ...(stat.alert ? { color: '#912018' } : {}) }}>{stat.value}</div>
          <div style={css.statLbl}>{stat.label}</div>
          {stat.sub && <div style={css.statSub}>{stat.sub}</div>}
        </div>
      ))}
    </div>
  )
}
