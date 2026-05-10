import React from 'react'
import { colors, typography } from '../theme'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Screen render failed:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: colors.bg,
          fontFamily: typography.fontFamily,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '560px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 18px 40px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ color: colors.danger, fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
            Screen crashed
          </div>
          <h2 style={{ margin: 0, color: colors.text, fontSize: '22px' }}>
            Something went wrong in {this.props.label || 'this screen'}.
          </h2>
          <p style={{ color: colors.sub, lineHeight: 1.6, marginTop: '12px', marginBottom: '18px' }}>
            {this.state.error?.message || 'An unexpected render error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              border: 'none',
              borderRadius: '10px',
              padding: '11px 18px',
              background: colors.primaryDark,
              color: colors.white,
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
