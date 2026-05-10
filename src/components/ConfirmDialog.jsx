import { useEffect, useState } from 'react'
import { subscribeToConfirmDialog } from '../confirmDialog'
import { colors, typography } from '../theme'

const TONES = {
  danger: {
    accent: colors.danger,
    bg: colors.dangerL,
    border: colors.dangerSoft,
  },
  warning: {
    accent: colors.warn,
    bg: colors.warnL,
    border: '#F6D88A',
  },
  info: {
    accent: colors.blue,
    bg: colors.blueL,
    border: '#BBD3FF',
  },
}

export default function ConfirmDialog() {
  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    return subscribeToConfirmDialog(setDialog)
  }, [])

  useEffect(() => {
    if (!dialog) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        dialog.resolve(false)
        setDialog(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dialog])

  if (!dialog) return null

  const palette = TONES[dialog.tone] || TONES.danger

  const closeWith = (value) => {
    dialog.resolve(value)
    setDialog(null)
  }

  return (
    <div style={styles.overlay} onClick={() => closeWith(false)}>
      <div style={{ ...styles.dialog, borderColor: palette.border }} onClick={(event) => event.stopPropagation()}>
        <div style={{ ...styles.accent, background: palette.accent }} />
        <div style={styles.body}>
          <div style={styles.title}>{dialog.title}</div>
          <div style={styles.message}>{dialog.message}</div>
          <div style={styles.actions}>
            <button type="button" style={styles.cancelButton} onClick={() => closeWith(false)}>
              {dialog.cancelLabel}
            </button>
            <button
              type="button"
              style={{ ...styles.confirmButton, background: palette.accent, boxShadow: `0 10px 24px ${palette.accent}30` }}
              onClick={() => closeWith(true)}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.48)',
    display: 'grid',
    placeItems: 'center',
    zIndex: 3200,
    padding: '20px',
  },
  dialog: {
    width: 'min(460px, 100%)',
    background: '#FFFFFF',
    borderRadius: '20px',
    border: `1px solid ${colors.border}`,
    boxShadow: '0 26px 60px rgba(15, 23, 42, 0.28)',
    overflow: 'hidden',
    display: 'flex',
    fontFamily: typography.fontFamily,
  },
  accent: {
    width: '6px',
    flexShrink: 0,
  },
  body: {
    padding: '22px 22px 18px',
    width: '100%',
  },
  title: {
    fontSize: '16px',
    fontWeight: 800,
    color: colors.text,
  },
  message: {
    fontSize: '13px',
    color: colors.sub,
    lineHeight: 1.6,
    marginTop: '10px',
    whiteSpace: 'pre-wrap',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '20px',
  },
  cancelButton: {
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    borderRadius: '12px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  confirmButton: {
    border: 'none',
    color: '#FFFFFF',
    borderRadius: '12px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 800,
    cursor: 'pointer',
  },
}
