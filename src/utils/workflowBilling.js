export const SERVICE_SOURCES = {
  CONSULTATION: 'Consultation',
  LABORATORY: 'Laboratory',
  PHARMACY: 'Pharmacy',
  WARD: 'Ward',
  PROCEDURE: 'Procedure',
}

export function createServiceLine({
  label,
  qty = 1,
  unitPrice = 0,
  total,
  source,
  sourceId = null,
  visitId = null,
  meta = {},
}) {
  const numericQty = Math.max(1, Number(qty || 1))
  const numericUnitPrice = Number(unitPrice || 0)
  const numericTotal = total === undefined ? numericQty * numericUnitPrice : Number(total || 0)

  return {
    label,
    qty: numericQty,
    unit_price: numericUnitPrice,
    total: numericTotal,
    source: source || null,
    source_id: sourceId,
    visit_id: visitId,
    ...meta,
  }
}

export function stringifyServiceLines(lines) {
  return JSON.stringify((lines || []).filter(Boolean))
}

export function buildWorkflowInvoiceNote({ source, sourceId = null, visitId = null, summary = '' }) {
  return ['WF', source || 'Unknown', sourceId || '', visitId || '', summary || '']
    .map(part => String(part))
    .join('|')
}

export function parseWorkflowInvoiceNote(note) {
  const parts = String(note || '').split('|')
  if (parts[0] !== 'WF') return null
  return {
    source: parts[1] || null,
    sourceId: parts[2] || null,
    visitId: parts[3] || null,
    summary: parts.slice(4).join('|') || null,
  }
}

export function inferInvoiceSource(invoice) {
  const fromNote = parseWorkflowInvoiceNote(invoice?.notes)
  if (fromNote?.source) return fromNote.source

  try {
    const parsed = JSON.parse(invoice?.services || '[]')
    if (Array.isArray(parsed)) {
      const explicit = parsed.find(item => item?.source)
      if (explicit?.source) return explicit.source
    }
  } catch (_) {}

  const haystack = `${invoice?.services || ''} ${invoice?.notes || ''}`.toLowerCase()
  if (haystack.includes('consultation')) return SERVICE_SOURCES.CONSULTATION
  if (haystack.includes('lab')) return SERVICE_SOURCES.LABORATORY
  if (haystack.includes('pharmacy')) return SERVICE_SOURCES.PHARMACY
  if (haystack.includes('ward')) return SERVICE_SOURCES.WARD
  if (haystack.includes('procedure')) return SERVICE_SOURCES.PROCEDURE
  return 'Other'
}
