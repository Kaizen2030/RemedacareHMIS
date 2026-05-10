import { useNavigate } from 'react-router-dom'
import { colors, typography } from '../theme'
import { resolveRole } from '../access'

export default function AccessDenied({ role, screen }) {
  const navigate = useNavigate()
  const resolvedRole = resolveRole(role)

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>🔒</div>
        <h1 style={styles.title}>Access Restricted</h1>
        <p style={styles.message}>
          Your role ({resolvedRole}) does not have permission to access this screen.
          Contact your administrator if you need access.
        </p>
        <div style={styles.screenLabel}>Screen: {screen}</div>
        <button
          type="button"
          style={styles.button}
          onClick={() => navigate('/dashboard')}
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: 'calc(100vh - 32px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: colors.bgAlt,
    fontFamily: typography.fontFamily,
  },
  card: {
    width: '100%',
    maxWidth: '560px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: '20px',
    padding: '36px 32px',
    boxShadow: '0 18px 48px rgba(15, 110, 86, 0.08)',
    textAlign: 'center',
  },
  icon: {
    fontSize: '56px',
    lineHeight: 1,
    marginBottom: '18px',
  },
  title: {
    margin: 0,
    color: colors.textStrong,
    fontSize: '28px',
    fontWeight: 800,
  },
  message: {
    margin: '14px 0 0',
    color: colors.subStrong,
    fontSize: '15px',
    lineHeight: 1.7,
  },
  screenLabel: {
    marginTop: '16px',
    color: colors.mutedStrong,
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  button: {
    marginTop: '24px',
    padding: '12px 22px',
    borderRadius: '10px',
    border: 'none',
    background: colors.primaryDark,
    color: colors.white,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 700,
  },
}
