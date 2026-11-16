export function buildBilingualWhatsAppMessage({ english = '', swahili = '' } = {}) {
  return [english, swahili].filter(Boolean).join(swahili && english ? '\n\n' : '')
}

export function generateWhatsAppLink(phone, message = '') {
  const recipient = String(phone || '').replace(/[^0-9]/g, '')
  return `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`
}
