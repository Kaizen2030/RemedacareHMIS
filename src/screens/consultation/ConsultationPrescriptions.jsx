import { findInventoryMatch } from '../../utils/pharmacy'

function getDrugAvailability(drugName, quantity, inventory) {
  const match = findInventoryMatch(drugName, inventory)
  const needed = Number(quantity || 1)
  if (!match) return { label: 'No matching inventory found', color: '#B91C1C' }
  const balance = Number(match.quantity_in_stock || 0)
  if (balance <= 0) return { label: 'Out of stock', color: '#B91C1C' }
  if (balance < needed) return { label: `Low stock — ${balance} available`, color: '#C2410C' }
  return { label: `In stock — ${balance} available`, color: '#16A34A' }
}

export default function ConsultationPrescriptions({
  showRx,
  setShowRx,
  rxList = [],
  updateRxField = () => {},
  inventory = [],
  setRxList = () => {},
  styles = {},
}) {
  return (
    <>
      <div style={{ ...styles.sectionLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Prescriptions</span>
        <button style={styles.toggleBtn} onClick={() => setShowRx(!showRx)}>
          {showRx ? '− Hide' : '+ Add Prescription'}
        </button>
      </div>

      {showRx && (
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              marginBottom: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: inventory.length > 0 ? '#ECFDF3' : '#FFFBEB',
              border: inventory.length > 0 ? '1px solid #BBF7D0' : '1px solid #FDE68A',
              color: inventory.length > 0 ? '#166534' : '#92400E',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {inventory.length > 0
              ? `${inventory.length} active pharmacy drugs loaded. Pick from stock-backed names so pharmacy release and receipts can flow cleanly.`
              : 'No active pharmacy inventory is loaded for this hospital yet. Prescriptions can still be sent, but release and receipt creation will stay blocked until stock is added in Drug Inventory.'}
          </div>

          {rxList.map((rx, index) => (
            <div key={index} style={styles.rxRow}>
              <div style={styles.formGrid2}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Drug Name</label>
                  <input
                    list={`rx-drug-options-${index}`}
                    style={styles.input}
                    placeholder="e.g. Amoxicillin 500mg"
                    value={rx.drug_name}
                    onChange={e => updateRxField(index, 'drug_name', e.target.value)}
                  />
                  <datalist id={`rx-drug-options-${index}`}>
                    {inventory.slice(0, 250).map(item => (
                      <option key={item.id} value={item.drug_name}>
                        {item.generic_name ? `${item.generic_name} - ${item.quantity_in_stock || 0} in stock` : `${item.quantity_in_stock || 0} in stock`}
                      </option>
                    ))}
                  </datalist>
                  {rx.drug_name && (
                    <>
                      <div style={{ marginTop: 6, fontSize: 12, color: getDrugAvailability(rx.drug_name, rx.quantity, inventory).color }}>
                        {getDrugAvailability(rx.drug_name, rx.quantity, inventory).label}
                      </div>
                      {findInventoryMatch(rx.drug_name, inventory)?.drug_name && findInventoryMatch(rx.drug_name, inventory)?.drug_name !== rx.drug_name && (
                        <div style={{ marginTop: 4, fontSize: 11, color: '#475569' }}>
                          Will save as inventory item: {findInventoryMatch(rx.drug_name, inventory)?.drug_name}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Dosage</label>
                  <input
                    style={styles.input}
                    placeholder="e.g. 500mg"
                    value={rx.dosage}
                    onChange={e => updateRxField(index, 'dosage', e.target.value)}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Frequency</label>
                  <select
                    style={styles.input}
                    value={rx.frequency}
                    onChange={e => updateRxField(index, 'frequency', e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 8 hours', 'Every 6 hours', 'At night', 'As needed', 'Stat (once)'].map(f => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Duration</label>
                  <input
                    style={styles.input}
                    placeholder="e.g. 5 days, 2 weeks"
                    value={rx.duration}
                    onChange={e => updateRxField(index, 'duration', e.target.value)}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Quantity</label>
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="e.g. 30"
                    value={rx.quantity}
                    onChange={e => updateRxField(index, 'quantity', e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '14px' }}>
                  {rxList.length > 1 && (
                    <button style={styles.removeBtn} onClick={() => setRxList(rxList.filter((_, j) => j !== index))}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button
            style={styles.addRowBtn}
            onClick={() => setRxList([...rxList, { drug_name: '', dosage: '', frequency: '', duration: '', quantity: '' }])}
          >
            + Add Another Drug
          </button>
        </div>
      )}
    </>
  )
}
