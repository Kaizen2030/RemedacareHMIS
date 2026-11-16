// Dispensing through the database controls (20261208000000_pharmacy_controls.sql): stock leaves first-expiry-first-out
// in one transaction, and controlled medicines are checked against and posted to the controlled-drug register.
// Each helper reports `installed: false` when the SQL has not been run, so the pharmacy keeps working as before.

const missing = (error) => /could not find the function|does not exist|schema cache|PGRST202/i.test(error?.message || error?.code || '')

/** Issue one medicine FEFO. { installed, error, batches } */
export async function fefoIssue(db, inventoryId, qty, reference) {
  const { data, error } = await db.rpc('pharmacy_fefo_issue', { p_inventory: inventoryId, p_qty: qty, p_reference: reference })
  if (error) return missing(error) ? { installed: false } : { installed: true, error: error.message }
  return { installed: true, batches: data?.batches || [] }
}

/** Controlled items whose pharmacy register balance is too low. Returns problem strings (empty when fine / not installed). */
export async function controlledShortfalls(db, hospitalId, items) {
  const controlled = items.filter((i) => i.inventoryItem?.controlled_drug)
  if (!controlled.length) return []
  const { data, error } = await db.rpc('cd_balances', { p_hospital: hospitalId })
  if (error) return missing(error) ? [] : [`Controlled drug register unavailable: ${error.message}`]
  const need = new Map()
  for (const i of controlled) need.set(i.inventoryItem.id, (need.get(i.inventoryItem.id) || 0) + Number(i.quantity || 0))
  const problems = []
  for (const [id, qty] of need) {
    const bal = Number((data || []).find((b) => b.inventory_id === id && String(b.location).toLowerCase() === 'pharmacy')?.balance || 0)
    const name = controlled.find((i) => i.inventoryItem.id === id).inventoryItem.drug_name
    if (bal < qty) problems.push(`${name}: controlled drug register (pharmacy) shows ${bal}, need ${qty}. Record the receipt in Controlled drugs & ward stock first.`)
  }
  return problems
}

/** Post controlled items to the pharmacy register after dispensing. Returns problem strings. */
export async function recordControlledIssues(db, hospitalId, items, { patientId, recordedBy } = {}) {
  const problems = []
  for (const i of items.filter((x) => x.inventoryItem?.controlled_drug)) {
    const { error } = await db.from('cd_register').insert({
      hospital_id: hospitalId, inventory_id: i.inventoryItem.id, location: 'Pharmacy', entry_type: 'issue_patient', quantity: Number(i.quantity || 0),
      patient_id: i.rx?.patient_id || patientId || null, prescription_id: i.rx?.id ? String(i.rx.id) : null, prescriber: i.rx?.prescribed_by || 'See prescription',
      recorded_by_name: recordedBy || null,
    })
    if (error && !missing(error)) problems.push(`${i.inventoryItem.drug_name}: ${error.message}`)
  }
  return problems
}
