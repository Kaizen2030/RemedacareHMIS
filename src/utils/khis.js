// KHIS (DHIS2) export: turn MOH report rows into a DHIS2 dataValueSet (JSON) and the DHIS2 CSV import format.
// Every hospital maps its own indicators to KHIS data element / category option combo UIDs once.

/** DHIS2 period for a date range: whole month → YYYYMM, ISO week → YYYYWn, otherwise YYYYMMDD of the start. */
export function dhis2Period(from, to) {
  const [y, m, d] = String(from).split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d === 1 && String(to) === `${y}-${String(m).padStart(2, '0')}-${String(end).padStart(2, '0')}`) return `${y}${String(m).padStart(2, '0')}`
  return String(from).replace(/-/g, '')
}

export const mappingKey = (form, indicator, disaggregation = 'all') => `${form}|${indicator}|${disaggregation}`

/**
 * rows: [{ section, indicator, disaggregation, value }]; mappings: [{ form, indicator, disaggregation, data_element_uid,
 * category_option_combo_uid, data_set_uid }]. Returns { json, csv, mapped, unmapped }.
 */
export function buildDataValueSet({ form, rows = [], mappings = [], orgUnit, from, to }) {
  const map = new Map(mappings.filter((m) => m.form === form).map((m) => [mappingKey(m.form, m.indicator, m.disaggregation), m]))
  const period = dhis2Period(from, to)
  const dataValues = []
  const unmapped = []
  for (const r of rows) {
    const m = map.get(mappingKey(form, r.indicator, r.disaggregation))
    if (!m?.data_element_uid) { unmapped.push(r); continue }
    dataValues.push({ dataElement: m.data_element_uid, ...(m.category_option_combo_uid ? { categoryOptionCombo: m.category_option_combo_uid } : {}), period, orgUnit, value: String(r.value) })
  }
  const dataSet = mappings.find((m) => m.form === form && m.data_set_uid)?.data_set_uid
  const json = { ...(dataSet ? { dataSet } : {}), period, orgUnit, completeDate: new Date().toISOString().slice(0, 10), dataValues }
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
  const csv = ['dataelement,period,orgunit,categoryoptioncombo,attributeoptioncombo,value',
    ...dataValues.map((v) => [v.dataElement, v.period, v.orgUnit, v.categoryOptionCombo || '', '', v.value].map(esc).join(','))].join('\n')
  return { json, csv, mapped: dataValues.length, unmapped }
}

export function rowsToCsv(rows = []) {
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
  return ['section,indicator,disaggregation,value', ...rows.map((r) => [r.section, r.indicator, r.disaggregation, r.value].map(esc).join(','))].join('\n')
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
