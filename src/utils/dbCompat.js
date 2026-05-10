const COMPAT_HINTS = [
  'could not find',
  'does not exist',
  'schema cache',
  'relation',
  'column',
]

function errorText(error) {
  return [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function isSchemaCompatError(error) {
  const text = errorText(error)
  if (!text) return false
  return COMPAT_HINTS.some(token => text.includes(token))
}

export function omitKeys(record, keys = []) {
  const copy = { ...(record || {}) }
  keys.forEach(key => {
    delete copy[key]
  })
  return copy
}

export async function executeWithFallback(primaryOperation, fallbackOperation = null) {
  const primaryResult = await primaryOperation()
  if (!fallbackOperation || !primaryResult?.error || !isSchemaCompatError(primaryResult.error)) {
    return primaryResult
  }
  return fallbackOperation(primaryResult.error)
}
