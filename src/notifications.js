const listeners = new Set()

function emit(notification) {
  listeners.forEach((listener) => {
    listener(notification)
  })
}

function createNotification(type, message, options = {}) {
  const text = String(message || '').trim()
  if (!text) return null

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    message: text,
    title: options.title || null,
    duration: options.duration ?? 4500,
  }
}

export function subscribeToNotifications(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notify(type, message, options) {
  const notification = createNotification(type, message, options)
  if (!notification) return null
  emit(notification)
  return notification.id
}

export function notifySuccess(message, options) {
  return notify('success', message, options)
}

export function notifyError(message, options) {
  return notify('error', message, options)
}

export function notifyWarning(message, options) {
  return notify('warning', message, options)
}

export function notifyInfo(message, options) {
  return notify('info', message, options)
}

function normalizeLegacyMessage(message) {
  return String(message ?? '').trim()
}

export function notifyFromLegacyAlert(message, options) {
  const text = normalizeLegacyMessage(message)
  if (!text) return null

  const lowered = text.toLowerCase()

  if (
    lowered.startsWith('error') ||
    lowered.startsWith('failed') ||
    lowered.startsWith('unexpected error') ||
    lowered.includes('could not') ||
    lowered.includes('cannot ') ||
    lowered.includes('blocked') ||
    lowered.includes('failed:')
  ) {
    return notifyError(text, options)
  }

  if (
    lowered.includes('warning') ||
    lowered.includes('only admin') ||
    lowered.includes('required') ||
    lowered.includes('please ') ||
    lowered.includes('already ') ||
    lowered.includes('pending') ||
    lowered.includes('unable to')
  ) {
    return notifyWarning(text, options)
  }

  if (
    lowered.includes('saved') ||
    lowered.includes('updated') ||
    lowered.includes('added') ||
    lowered.includes('sent') ||
    lowered.includes('created') ||
    lowered.includes('approved') ||
    lowered.includes('released') ||
    lowered.includes('loaded')
  ) {
    return notifySuccess(text, options)
  }

  return notifyInfo(text, options)
}
