const listeners = new Set()

function emit(payload) {
  listeners.forEach((listener) => {
    listener(payload)
  })
}

export function subscribeToConfirmDialog(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openConfirmDialog(message, options = {}) {
  const text = String(message ?? '').trim()
  if (!text) return Promise.resolve(false)

  return new Promise((resolve) => {
    emit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: text,
      title: options.title || 'Please confirm',
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      tone: options.tone || 'danger',
      resolve,
    })
  })
}
