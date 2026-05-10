import { useEffect, useRef } from 'react'
import { notifyWarning, notifyInfo } from '../notifications'

export default function useSessionTimeout({ onTimeout, timeoutMinutes = 30, warningMinutes = 5 } = {}) {
  const timeoutRef = useRef(null)
  const warningRef = useRef(null)
  const lastActivityRef = useRef(Date.now())

  const clearTimers = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (warningRef.current) {
      window.clearTimeout(warningRef.current)
      warningRef.current = null
    }
  }

  const resetTimers = () => {
    clearTimers()
    lastActivityRef.current = Date.now()

    const timeoutMs = timeoutMinutes * 60 * 1000
    const warningMs = Math.max(0, (timeoutMinutes - warningMinutes) * 60 * 1000)

    warningRef.current = window.setTimeout(() => {
      notifyWarning(`Your session will expire in ${warningMinutes} minutes due to inactivity.`)
    }, warningMs)

    timeoutRef.current = window.setTimeout(() => {
      notifyInfo('Signing out due to inactivity. Please log in again to continue.')
      if (typeof onTimeout === 'function') {
        onTimeout()
      }
    }, timeoutMs)
  }

  useEffect(() => {
    if (typeof onTimeout !== 'function') return undefined

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'scroll']
    const handleActivity = () => resetTimers()

    resetTimers()
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, true))

    return () => {
      clearTimers()
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity, true))
    }
  }, [onTimeout, timeoutMinutes, warningMinutes])
}
