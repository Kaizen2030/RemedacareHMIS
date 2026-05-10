import { colors } from '../theme'

export default function SkeletonLoader({ rows = 3, height = 14, width = '100%' }) {
  return (
    <>
      <style>{'@keyframes remedacare-skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
      <div style={styles.wrap}>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={`${index}-${width}-${height}`}
            style={{
              ...styles.row,
              width: Array.isArray(width) ? width[index] || width[width.length - 1] || '100%' : width,
              height,
            }}
          />
        ))}
      </div>
    </>
  )
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  row: {
    borderRadius: '999px',
    background: `linear-gradient(90deg, ${colors.border} 0%, #f3f6fb 50%, ${colors.border} 100%)`,
    backgroundSize: '200% 100%',
    animation: 'remedacare-skeleton 1.4s ease-in-out infinite',
  },
}
