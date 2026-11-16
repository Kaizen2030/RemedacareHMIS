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

/** Ask for a line of text in the app's own dialog (replaces window.prompt). Resolves the text, or null if cancelled. */
export function openPromptDialog(message, options = {}) {
  const text = String(message ?? '').trim()
  return new Promise((resolve) => {
    emit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: text,
      title: options.title || 'Please enter',
      confirmLabel: options.confirmLabel || 'OK',
      cancelLabel: options.cancelLabel || 'Cancel',
      tone: options.tone || 'info',
      prompt: true,
      required: options.required !== false,
      defaultValue: options.defaultValue || '',
      placeholder: options.placeholder || '',
      resolve,
    })
  })
}
