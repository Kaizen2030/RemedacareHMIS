import { useEffect, useState } from 'react'
import { subscribeToNotifications } from '../notifications'
import { colors, typography } from '../theme'

const TOAST_STYLES = {
  success: { accent: colors.primary, bg: colors.successL, border: colors.accent, title: 'Success' },
  error: { accent: colors.danger, bg: colors.dangerL, border: colors.dangerSoft, title: 'Error' },
  warning: { accent: colors.warn, bg: colors.warnL, border: '#F6D88A', title: 'Warning' },
  info: { accent: colors.blue, bg: colors.blueL, border: '#BBD3FF', title: 'Info' },
}

export default function ToastViewport() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const unsubscribe = subscribeToNotifications((notification) => {
      setToasts((current) => [...current, notification])

      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== notification.id))
      }, notification.duration)
    })

    return unsubscribe
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={styles.viewport}>
      {toasts.map((toast) => {
        const palette = TOAST_STYLES[toast.type] || TOAST_STYLES.info
        return (
          <div key={toast.id} style={{ ...styles.toast, background: palette.bg, borderColor: palette.border }}>
            <div style={{ ...styles.accent, background: palette.accent }} />
            <div style={styles.content}>
              <div style={styles.title}>{toast.title || palette.title}</div>
              <div style={styles.message}>{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              style={styles.close}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

const styles = {
  viewport: {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: 3000,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: 'min(360px, calc(100vw - 32px))',
    pointerEvents: 'none',
  },
  toast: {
    position: 'relative',
    display: 'flex',
    alignItems: 'stretch',
    gap: '12px',
    border: `1px solid ${colors.border}`,
    borderRadius: '14px',
    boxShadow: '0 14px 32px rgba(15, 23, 42, 0.14)',
    overflow: 'hidden',
    pointerEvents: 'auto',
    fontFamily: typography.fontFamily,
  },
  accent: {
    width: '5px',
    flexShrink: 0,
  },
  content: {
    padding: '12px 0',
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: '12px',
    fontWeight: 800,
    color: colors.text,
    marginBottom: '4px',
  },
  message: {
    fontSize: '12px',
    color: colors.sub,
    lineHeight: 1.5,
    paddingRight: '8px',
    whiteSpace: 'pre-wrap',
  },
  close: {
    alignSelf: 'flex-start',
    margin: '8px 10px 0 0',
    border: 'none',
    background: 'transparent',
    color: colors.sub,
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
  },
}
