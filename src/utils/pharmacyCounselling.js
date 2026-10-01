export function formatKenyanPhoneForWhatsApp(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)

  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`
  }

  if (/^254[17]\d{8}$/.test(digits)) return digits
  if (/^[1-9]\d{9,14}$/.test(digits)) return digits
  return ''
}

export function getDrugCounselling(drugName, genericName, prescription = {}) {
  const displayName = String(drugName || genericName || 'your medicine').trim()
  const generic = String(genericName || '').trim()
  const directions = [prescription.dosage, prescription.frequency, prescription.duration]
    .map(value => String(value || '').trim())
    .filter(Boolean)
  const directionText = directions.length ? ` Follow the prescribed directions: ${directions.join(', ')}.` : ''

  return {
    english: `Use ${displayName}${generic && generic.toLowerCase() !== displayName.toLowerCase() ? ` (${generic})` : ''} as directed by your clinician.${directionText} Ask your pharmacist if the label is unclear.`,
    swahili: `Tumia ${displayName} kulingana na maelekezo ya daktari au mfamasia. Uliza mfamasia ikiwa maelekezo hayako wazi.`,
    instructions: {
      dosage: prescription.dosage || '',
      frequency: prescription.frequency || '',
      duration: prescription.duration || '',
      route: prescription.route || '',
    },
  }
}