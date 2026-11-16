import { useState, useEffect, useCallback } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { colors as C, typography } from '../theme'

const CATEGORIES = [
 'All Categories', 'Antibiotics', 'Analgesics', 'Antihypertensives',
 'Antidiabetics', 'Antiparasitics', 'Antifungals', 'Antivirals',
 'Vitamins & Supplements', 'IV Fluids', 'Vaccines', 'Surgical Supplies', 'Other'
]

const WRITEOFF_REASONS = ['Expired', 'Damaged', 'Recalled', 'Contaminated', 'Other']

function getDaysLeft(expiryDate) {
 const today = new Date(); today.setHours(0, 0, 0, 0)
 const expiry = new Date(expiryDate); expiry.setHours(0, 0, 0, 0)
 return Math.floor((expiry - today) / (1000 * 60 * 60 * 24))
}

function getExpiryStatus(daysLeft) {
 if (daysLeft < 0) return 'Expired'
 if (daysLeft <= 30) return '< 30 days'
 if (daysLeft <= 60) return '< 60 days'
 if (daysLeft <= 90) return '< 90 days'
 return 'Active'
}

function formatDate(d) {
 if (!d) return '—'
 return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatKES(n) {
 return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

const STATUS_STYLE = {
 'Expired': { bg: '#FCEBEB', color: '#A32D2D', badge: '#E24B4A' },
 '< 30 days': { bg: '#FFF3DC', color: '#C07000', badge: '#E09B00' },
 '< 60 days': { bg: '#FFF8E1', color: '#A07000', badge: '#F0B429' },
 '< 90 days': { bg: '#E3F0FB', color: '#1a6fb5', badge: '#1a6fb5' },
 'Active': { bg: '#E1F5EE', color: '#0F6E56', badge: '#0F6E56' },
}

export default function Expiry() {
 const { hospitalId } = useHospital()

 const [activeTab, setActiveTab] = useState('expired')
 const [batches, setBatches] = useState([])
 const [writeoffs, setWriteoffs] = useState([])
 const [loading, setLoading] = useState(true)
 const [searchTerm, setSearchTerm] = useState('')
 const [categoryFilter, setCategoryFilter] = useState('All Categories')
 const [selectedBatch, setSelectedBatch] = useState(null)
 const [showAddBatch, setShowAddBatch] = useState(false)
 const [showWriteoff, setShowWriteoff] = useState(false)
 const [writeoffBatch, setWriteoffBatch] = useState(null)
 const [saving, setSaving] = useState(false)
 const [toast, setToast] = useState(null)

 const [batchForm, setBatchForm] = useState({
 drug_name: '', generic_name: '', category: 'Antibiotics',
 batch_number: '', supplier: '', quantity_received: '',
 quantity_remaining: '', unit_cost: '', selling_price: '',
 manufacture_date: '', expiry_date: '', location: 'Main Store'
 })

 const [writeoffForm, setWriteoffForm] = useState({
 quantity_written_off: '', reason: 'Expired', approved_by: '', notes: ''
 })

 // ── Fetch ──────────────────────────────────────────────────
 const fetchBatches = useCallback(async () => {
 if (!hospitalId) { setLoading(false); return }
 setLoading(true)
 const { data } = await supabase
 .from('drug_batches')
 .select('*')
 .eq('hospital_id', hospitalId)
 .neq('status', 'Written Off')
 .order('expiry_date', { ascending: true })
 setBatches(data || [])
 setLoading(false)
 }, [hospitalId])

 const fetchWriteoffs = useCallback(async () => {
 if (!hospitalId) return
 const { data } = await supabase
 .from('drug_writeoffs')
 .select('*')
 .eq('hospital_id', hospitalId)
 .order('written_off_at', { ascending: false })
 setWriteoffs(data || [])
 }, [hospitalId])

 useEffect(() => {
 fetchBatches()
 fetchWriteoffs()
 }, [fetchBatches, fetchWriteoffs])

 // ── Derived data ───────────────────────────────────────────
 const enriched = batches.map(b => ({
 ...b,
 daysLeft: getDaysLeft(b.expiry_date),
 expiryStatus: getExpiryStatus(getDaysLeft(b.expiry_date))
 }))

 const stats = {
 expired: enriched.filter(b => b.daysLeft < 0),
 lt30: enriched.filter(b => b.daysLeft >= 0 && b.daysLeft <= 30),
 lt60: enriched.filter(b => b.daysLeft > 30 && b.daysLeft <= 60),
 lt90: enriched.filter(b => b.daysLeft > 60 && b.daysLeft <= 90),
 totalLossValue: enriched.filter(b => b.daysLeft < 0)
 .reduce((sum, b) => sum + (b.quantity_remaining || 0) * (b.unit_cost || 0), 0),
 atRiskValue: enriched.filter(b => b.daysLeft >= 0 && b.daysLeft <= 90)
 .reduce((sum, b) => sum + (b.quantity_remaining || 0) * (b.unit_cost || 0), 0)
 }

 const applyFilters = list => list.filter(b => {
 const q = searchTerm.toLowerCase()
 const matchSearch = !q || b.drug_name?.toLowerCase().includes(q) ||
 b.batch_number?.toLowerCase().includes(q) || b.supplier?.toLowerCase().includes(q)
 const matchCat = categoryFilter === 'All Categories' || b.category === categoryFilter
 return matchSearch && matchCat
 })

 const tabData = {
 expired: applyFilters(enriched.filter(b => b.daysLeft < 0)),
 expiring: applyFilters(enriched.filter(b => b.daysLeft >= 0 && b.daysLeft <= 90)),
 all: applyFilters(enriched),
 writeoffs: writeoffs.filter(w => {
 const q = searchTerm.toLowerCase()
 return !q || w.drug_name?.toLowerCase().includes(q) || w.batch_number?.toLowerCase().includes(q)
 })
 }

 // ── Handlers ───────────────────────────────────────────────
 const handleAddBatch = async () => {
 if (!batchForm.drug_name || !batchForm.expiry_date || !batchForm.batch_number) {
 showToastMsg('Drug name, batch number and expiry date are required', 'error')
 return
 }
 setSaving(true)
 const qty = parseInt(batchForm.quantity_received) || 0
 const { error } = await supabase.from('drug_batches').insert({
 hospital_id: hospitalId,
 drug_name: batchForm.drug_name.trim(),
 generic_name: batchForm.generic_name.trim() || null,
 category: batchForm.category,
 batch_number: batchForm.batch_number.trim(),
 supplier: batchForm.supplier.trim() || null,
 quantity_received: qty,
 quantity_remaining: parseInt(batchForm.quantity_remaining) || qty,
 unit_cost: parseFloat(batchForm.unit_cost) || 0,
 selling_price: parseFloat(batchForm.selling_price) || 0,
 manufacture_date: batchForm.manufacture_date || null,
 expiry_date: batchForm.expiry_date,
 location: batchForm.location,
 status: 'Active'
 })
 setSaving(false)
 if (error) { showToastMsg('Failed: ' + error.message, 'error'); return }
 showToastMsg('Batch added')
 setShowAddBatch(false)
 setBatchForm({ drug_name: '', generic_name: '', category: 'Antibiotics', batch_number: '', supplier: '', quantity_received: '', quantity_remaining: '', unit_cost: '', selling_price: '', manufacture_date: '', expiry_date: '', location: 'Main Store' })
 fetchBatches()
 }

 const openWriteoff = (batch) => {
 setWriteoffBatch(batch)
 setWriteoffForm({
 quantity_written_off: String(batch.quantity_remaining || ''),
 reason: batch.daysLeft < 0 ? 'Expired' : 'Damaged',
 approved_by: '', notes: ''
 })
 setShowWriteoff(true)
 }

 async function adjustInventoryStock(drugName, qty) {
 if (!drugName || qty <= 0) return false
 const { data } = await supabase
 .from('pharmacy_inventory')
 .select('id, quantity_in_stock')
 .eq('hospital_id', hospitalId)
 .ilike('drug_name', drugName)
 .limit(1)
 const item = data?.[0]
 if (!item) return false
 const newQty = Math.max(0, Number(item.quantity_in_stock || 0) - qty)
 await supabase.from('pharmacy_inventory')
 .update({ quantity_in_stock: newQty, is_active: newQty > 0 })
 .eq('id', item.id)
 .eq('hospital_id', hospitalId)
 return true
 }

 const handleWriteoff = async () => {
 if (!writeoffForm.quantity_written_off || !writeoffForm.approved_by) {
 showToastMsg('Quantity and approver are required', 'error')
 return
 }
 const qty = parseInt(writeoffForm.quantity_written_off)
 if (qty > writeoffBatch.quantity_remaining) {
 showToastMsg('Cannot exceed remaining quantity', 'error')
 return
 }
 setSaving(true)
 const totalLoss = qty * (writeoffBatch.unit_cost || 0)
 const newQty = writeoffBatch.quantity_remaining - qty

 const { error: woErr } = await supabase.from('drug_writeoffs').insert({
 hospital_id: hospitalId,
 batch_id: writeoffBatch.id,
 drug_name: writeoffBatch.drug_name,
 batch_number: writeoffBatch.batch_number,
 quantity_written_off: qty,
 unit_cost: writeoffBatch.unit_cost,
 total_loss: totalLoss,
 reason: writeoffForm.reason,
 approved_by: writeoffForm.approved_by.trim(),
 notes: writeoffForm.notes.trim() || null
 })

 if (woErr) { setSaving(false); showToastMsg('Failed: ' + woErr.message, 'error'); return }

 await supabase.from('drug_batches')
 .update({ quantity_remaining: newQty, status: newQty <= 0 ? 'Written Off' : writeoffBatch.status, last_change_reason: 'write_off' })
 .eq('id', writeoffBatch.id)
 .eq('hospital_id', hospitalId)

 const matched = await adjustInventoryStock(writeoffBatch.drug_name, qty)
 if (!matched && writeoffBatch.generic_name) {
 await adjustInventoryStock(writeoffBatch.generic_name, qty)
 }

 setSaving(false)
 showToastMsg(`${qty} units written off`)
 setShowWriteoff(false)
 setWriteoffBatch(null)
 setSelectedBatch(null)
 fetchBatches()
 fetchWriteoffs()
 }

 const showToastMsg = (msg, type = 'success') => {
 setToast({ msg, type })
 setTimeout(() => setToast(null), 3500)
 }

 // ── Sub-components ─────────────────────────────────────────
 const tabs = [
 { key: 'expired', label: ` Expired (${stats.expired.length})` },
 { key: 'expiring', label: ` Expiring Soon (${stats.lt30.length + stats.lt60.length + stats.lt90.length})` },
 { key: 'all', label: ` All Batches (${enriched.length})` },
 { key: 'writeoffs', label: ` Write-offs (${writeoffs.length})` }
 ]

 const TABLE_HEADS = ['Drug Name', 'Batch No.', 'Category', 'Supplier', 'Qty Left', 'Expiry Date', 'Days Left', 'Unit Cost', 'Loss Value', 'Action']
 const WRITEOFF_HEADS = ['Drug Name', 'Batch No.', 'Qty Written Off', 'Unit Cost', 'Total Loss', 'Reason', 'Approved By', 'Date', 'Notes']

 if (loading) return (
 <div style={s.loadingWrap}>
 <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
 <div style={s.spinner} />
 <p style={{ color: '#0F6E56', marginTop: 12 }}>Loading expiry data...</p>
 </div>
 )

 return (
 <div style={s.page}>
 <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

 {/* HEADER */}
 <div style={s.header}>
 <div>
 <h1 style={s.title}>Expiry Management</h1>
 <p style={s.subtitle}>Track drug batches, expiry alerts and disposal actions</p>
 </div>
 <button style={s.primaryBtn} onClick={() => setShowAddBatch(true)}>Add Drug Batch</button>
 </div>

 {/* STAT CARDS */}
 <div style={s.statsGrid}>
 {[
 { label: 'Expired', value: stats.expired.length },
 { label: '< 30 Days', value: stats.lt30.length },
 { label: '< 60 Days', value: stats.lt60.length },
 { label: '< 90 Days', value: stats.lt90.length },
 { label: 'Loss (Expired)', value: formatKES(stats.totalLossValue), small: true },
 { label: 'At Risk Value', value: formatKES(stats.atRiskValue), small: true }
 ].map(c => (
 <div key={c.label} style={{ ...s.statCard, background: C.surface, border: `1px solid ${C.border}` }}>
 <div style={{ fontSize: c.small ? 14 : 26, fontWeight: 800, color: c.label === 'Expired' ? C.danger : C.text, marginTop: 4 }}>{c.value}</div>
 <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{c.label}</div>
 </div>
 ))}
 </div>

 {/* FILTERS */}
 <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
 <input
 placeholder='Search drug, batch, supplier...'
 value={searchTerm}
 onChange={e => setSearchTerm(e.target.value)}
 style={{ ...s.input, width: 260 }}
 />
 <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={s.select}>
 {CATEGORIES.map(c => <option key={c}>{c}</option>)}
 </select>
 </div>

 {/* TABS */}
 <div style={s.tabRow}>
 {tabs.map(t => (
 <button key={t.key} onClick={() => setActiveTab(t.key)}
 style={{ ...s.tabBtn, ...(activeTab === t.key ? s.tabBtnActive : {}) }}>
 {t.label}
 </button>
 ))}
 </div>

 {/* TABLE */}
 <div style={s.tableCard}>
 {activeTab !== 'writeoffs' ? (
 tabData[activeTab].length === 0 ? (
 <div style={s.empty}>
 <div style={{ fontSize: 40, marginBottom: 10 }}>No data</div>
 <div>{activeTab === 'expired' ? 'No expired drugs — great!' : 'No drugs expiring in this range'}</div>
 </div>
 ) : (
 <div style={{ overflowX: 'auto' }}>
 <table style={s.table}>
 <thead>
 <tr>{TABLE_HEADS.map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {tabData[activeTab].map(b => {
 const sc = STATUS_STYLE[b.expiryStatus] || STATUS_STYLE['Active']
 return (
 <tr key={b.id}
 style={{ borderBottom: '1px solid #f0f0f0', background: selectedBatch?.id === b.id ? '#f0faf6' : 'white', cursor: 'pointer' }}
 onClick={() => setSelectedBatch(selectedBatch?.id === b.id ? null : b)}>
 <td style={s.td}>
 <div style={{ fontWeight: 600, color: '#111' }}>{b.drug_name}</div>
 {b.generic_name && <div style={{ fontSize: 11, color: '#999' }}>{b.generic_name}</div>}
 </td>
 <td style={s.td}>{b.batch_number}</td>
 <td style={s.td}>{b.category || '—'}</td>
 <td style={s.td}>{b.supplier || '—'}</td>
 <td style={s.td}>
 <span style={{ ...s.pill, background: sc.bg, color: sc.color }}>{b.quantity_remaining}</span>
 </td>
 <td style={s.td}>{formatDate(b.expiry_date)}</td>
 <td style={s.td}>
 <span style={{ ...s.pill, background: sc.badge, color: '#fff', fontWeight: 700 }}>
 {b.daysLeft < 0 ? `${Math.abs(b.daysLeft)}d ago` : b.daysLeft === 0 ? 'TODAY' : `${b.daysLeft}d left`}
 </span>
 </td>
 <td style={s.td}>{formatKES(b.unit_cost)}</td>
 <td style={{ ...s.td, fontWeight: 700, color: '#A32D2D' }}>
 {formatKES((b.quantity_remaining || 0) * (b.unit_cost || 0))}
 </td>
 <td style={s.td}>
 <button style={s.dangerBtn}
 onClick={e => { e.stopPropagation(); openWriteoff(b) }}>
 Write Off
 </button>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 )
 ) : (
 /* WRITE-OFFS TAB */
 tabData.writeoffs.length === 0 ? (
 <div style={s.empty}>
 <div style={{ fontSize: 40, marginBottom: 10 }}>📝</div>
 <div>No write-offs recorded yet</div>
 </div>
 ) : (
 <div style={{ overflowX: 'auto' }}>
 <table style={s.table}>
 <thead>
 <tr>{WRITEOFF_HEADS.map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
 </thead>
 <tbody>
 {tabData.writeoffs.map(w => (
 <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
 <td style={{ ...s.td, fontWeight: 600, color: '#111' }}>{w.drug_name}</td>
 <td style={s.td}>{w.batch_number}</td>
 <td style={s.td}>
 <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>{w.quantity_written_off} units</span>
 </td>
 <td style={s.td}>{formatKES(w.unit_cost)}</td>
 <td style={{ ...s.td, fontWeight: 700, color: '#A32D2D' }}>{formatKES(w.total_loss)}</td>
 <td style={s.td}>
 <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000' }}>{w.reason}</span>
 </td>
 <td style={s.td}>{w.approved_by}</td>
 <td style={{ ...s.td, fontSize: 11, color: '#999' }}>{formatDate(w.written_off_at)}</td>
 <td style={{ ...s.td, fontSize: 11, color: '#bbb' }}>{w.notes || '—'}</td>
 </tr>
 ))}
 </tbody>
 <tfoot>
 <tr style={{ background: '#FCEBEB', borderTop: '2px solid #f5c6c6' }}>
 <td colSpan={4} style={{ ...s.td, fontWeight: 700, color: '#A32D2D' }}>Total Write-off Loss</td>
 <td style={{ ...s.td, fontWeight: 800, color: '#A32D2D', fontSize: 15 }}>
 {formatKES(writeoffs.reduce((sum, w) => sum + (w.total_loss || 0), 0))}
 </td>
 <td colSpan={4} />
 </tr>
 </tfoot>
 </table>
 </div>
 )
 )}
 </div>

 {/* ── SIDE PANEL ─────────────────────────────────────── */}
 {selectedBatch && (() => {
 const sc = STATUS_STYLE[selectedBatch.expiryStatus] || STATUS_STYLE['Active']
 return (
 <div style={s.sidePanel}>
 <div style={s.sidePanelHead}>
 <div>
 <div style={{ fontWeight: 700, color: '#111', fontSize: 15 }}>{selectedBatch.drug_name}</div>
 <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{selectedBatch.generic_name || 'No generic name'}</div>
 </div>
 <button style={s.closeBtn} onClick={() => setSelectedBatch(null)}>×</button>
 </div>
 <div style={{ padding: '16px 20px' }}>
 <div style={{ textAlign: 'center', marginBottom: 16 }}>
 <span style={{ ...s.pill, background: sc.badge, color: '#fff', fontSize: 13, padding: '6px 16px' }}>
 {selectedBatch.expiryStatus === 'Active' ? 'Active stock'
 : selectedBatch.expiryStatus === 'Expired' ? 'Expired'
 : `Expiring ${selectedBatch.expiryStatus}`}
 </span>
 </div>
 {[
 ['Batch Number', selectedBatch.batch_number],
 ['Category', selectedBatch.category],
 ['Supplier', selectedBatch.supplier || '—'],
 ['Location', selectedBatch.location || 'Main Store'],
 ['Qty Received', selectedBatch.quantity_received],
 ['Qty Remaining', <strong key='q'>{selectedBatch.quantity_remaining}</strong>],
 ['Unit Cost', formatKES(selectedBatch.unit_cost)],
 ['Selling Price', formatKES(selectedBatch.selling_price)],
 ['Manufacture Date',formatDate(selectedBatch.manufacture_date)],
 ['Expiry Date', <span key='e' style={{ color: selectedBatch.daysLeft < 0 ? '#A32D2D' : '#111', fontWeight: selectedBatch.daysLeft < 0 ? 700 : 400 }}>{formatDate(selectedBatch.expiry_date)}</span>],
 ['Days Left', <span key='d' style={{ ...s.pill, background: sc.badge, color: '#fff', fontWeight: 700 }}>{selectedBatch.daysLeft < 0 ? `${Math.abs(selectedBatch.daysLeft)}d ago` : `${selectedBatch.daysLeft}d left`}</span>],
 ['Potential Loss', <strong key='l' style={{ color: '#A32D2D' }}>{formatKES((selectedBatch.quantity_remaining || 0) * (selectedBatch.unit_cost || 0))}</strong>]
 ].map(([label, val]) => (
 <div key={label} style={s.detailRow}>
 <span style={{ fontSize: 11, color: '#999' }}>{label}</span>
 <span style={{ fontSize: 13 }}>{val}</span>
 </div>
 ))}
 <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
 <button style={s.dangerBtnFull} onClick={() => openWriteoff(selectedBatch)}>
 Write Off This Batch
 </button>
 </div>
 </div>
 </div>
 )
 })()}

 {/* ── MODAL: ADD BATCH ───────────────────────────────── */}
 {showAddBatch && (
 <div style={s.overlay}>
 <div style={s.modal}>
 <div style={s.modalHead}>
 <span style={{ fontWeight: 700, fontSize: 16 }}>Add Drug Batch</span>
 <button style={s.closeBtn} onClick={() => setShowAddBatch(false)}>×</button>
 </div>
 <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>
 {[
 { label: 'Drug Name *', key: 'drug_name', type: 'text', placeholder: 'e.g. Amoxicillin 500mg', full: true },
 { label: 'Generic Name', key: 'generic_name', type: 'text', placeholder: 'e.g. Amoxicillin' },
 { label: 'Batch Number *', key: 'batch_number', type: 'text', placeholder: 'e.g. B2025-001' },
 { label: 'Supplier', key: 'supplier', type: 'text', placeholder: 'Supplier name' },
 { label: 'Qty Received *', key: 'quantity_received', type: 'number', placeholder: '0' },
 { label: 'Qty Remaining', key: 'quantity_remaining', type: 'number', placeholder: 'Same as received' },
 { label: 'Unit Cost (KES)', key: 'unit_cost', type: 'number', placeholder: '0.00' },
 { label: 'Selling Price (KES)', key: 'selling_price', type: 'number', placeholder: '0.00' },
 { label: 'Manufacture Date', key: 'manufacture_date', type: 'date' },
 { label: 'Expiry Date *', key: 'expiry_date', type: 'date' },
 { label: 'Storage Location', key: 'location', type: 'text', placeholder: 'Main Store' }
 ].map(f => (
 <div key={f.key} style={{ gridColumn: f.full ? 'span 2' : 'span 1' }}>
 <label style={s.label}>{f.label}</label>
 <input type={f.type} value={batchForm[f.key]}
 onChange={e => setBatchForm({ ...batchForm, [f.key]: e.target.value })}
 placeholder={f.placeholder || ''} style={s.input} />
 </div>
 ))}
 <div>
 <label style={s.label}>Category</label>
 <select value={batchForm.category}
 onChange={e => setBatchForm({ ...batchForm, category: e.target.value })}
 style={{ ...s.select, width: '100%' }}>
 {CATEGORIES.filter(c => c !== 'All Categories').map(c => <option key={c}>{c}</option>)}
 </select>
 </div>
 </div>
 <div style={s.modalFoot}>
 <button style={s.cancelBtn} onClick={() => setShowAddBatch(false)}>Cancel</button>
 <button style={s.primaryBtn} onClick={handleAddBatch} disabled={saving}>
 {saving ? 'Saving...' : 'Add Batch'}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ── MODAL: WRITE OFF ───────────────────────────────── */}
 {showWriteoff && writeoffBatch && (
 <div style={s.overlay}>
 <div style={{ ...s.modal, maxWidth: 460 }}>
 <div style={{ ...s.modalHead, background: '#FCEBEB', borderRadius: '12px 12px 0 0' }}>
 <div>
 <div style={{ fontWeight: 700, fontSize: 16, color: '#A32D2D' }}>Write Off Batch</div>
 <div style={{ fontSize: 12, color: '#c05050', marginTop: 2 }}>
 {writeoffBatch.drug_name} · Batch {writeoffBatch.batch_number}
 </div>
 </div>
 <button style={s.closeBtn} onClick={() => { setShowWriteoff(false); setWriteoffBatch(null) }}>×</button>
 </div>
 <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
 <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '12px 14px' }}>
 {[
 ['Available Qty', `${writeoffBatch.quantity_remaining} units`],
 ['Unit Cost', formatKES(writeoffBatch.unit_cost)],
 ['Days Left', writeoffBatch.daysLeft < 0 ? `Expired ${Math.abs(writeoffBatch.daysLeft)} days ago` : `${writeoffBatch.daysLeft} days`]
 ].map(([k, v]) => (
 <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
 <span style={{ color: '#888' }}>{k}</span>
 <span style={{ fontWeight: 600, color: writeoffBatch.daysLeft < 0 && k === 'Days Left' ? '#A32D2D' : '#111' }}>{v}</span>
 </div>
 ))}
 </div>
 <div>
 <label style={s.label}>Quantity to Write Off *</label>
 <input type='number' value={writeoffForm.quantity_written_off}
 max={writeoffBatch.quantity_remaining}
 onChange={e => setWriteoffForm({ ...writeoffForm, quantity_written_off: e.target.value })}
 style={s.input} />
 {writeoffForm.quantity_written_off && (
 <div style={{ fontSize: 12, color: '#A32D2D', marginTop: 4 }}>
 Loss: {formatKES(parseInt(writeoffForm.quantity_written_off || 0) * (writeoffBatch.unit_cost || 0))}
 </div>
 )}
 </div>
 <div>
 <label style={s.label}>Reason *</label>
 <select value={writeoffForm.reason}
 onChange={e => setWriteoffForm({ ...writeoffForm, reason: e.target.value })}
 style={{ ...s.select, width: '100%' }}>
 {WRITEOFF_REASONS.map(r => <option key={r}>{r}</option>)}
 </select>
 </div>
 <div>
 <label style={s.label}>Approved By (Pharmacist) *</label>
 <input type='text' value={writeoffForm.approved_by}
 onChange={e => setWriteoffForm({ ...writeoffForm, approved_by: e.target.value })}
 placeholder='Pharmacist name' style={s.input} />
 </div>
 <div>
 <label style={s.label}>Notes</label>
 <textarea value={writeoffForm.notes}
 onChange={e => setWriteoffForm({ ...writeoffForm, notes: e.target.value })}
 rows={2} placeholder='Any additional notes...'
 style={{ ...s.input, resize: 'none', height: 64 }} />
 </div>
 </div>
 <div style={s.modalFoot}>
 <button style={s.cancelBtn} onClick={() => { setShowWriteoff(false); setWriteoffBatch(null) }}>Cancel</button>
 <button style={{ ...s.primaryBtn, background: '#E24B4A' }} onClick={handleWriteoff} disabled={saving}>
 {saving ? 'Processing...' : 'Confirm Write Off'}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* TOAST */}
 {toast && (
 <div style={{ ...s.toast, background: toast.type === 'error' ? '#E24B4A' : '#0F6E56' }}>
 {toast.msg}
 </div>
 )}
 </div>
 )
}

const s = {
 page: { padding: '20px 24px', flex: 1, overflowY: 'auto', background: C.bgAlt, fontFamily: typography.fontFamily, position: 'relative' },
 loadingWrap: { height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
 spinner: { width: 36, height: 36, border: '3px solid #e8ebe8', borderTop: '3px solid #0F6E56', borderRadius: '50%', animation: 'spin 0.9s linear infinite' },
 header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
 title: { fontSize: 26, fontWeight: 800, margin: 0, color: '#111' },
 subtitle: { color: '#777', margin: '4px 0 0 0', fontSize: 13 },
 statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 },
 statCard: { borderRadius: 8, padding: '14px 16px' },
 input: { border: '1px solid #e0e0e0', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', width: '100%' },
 select: { border: '1px solid #e0e0e0', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
 label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.3px' },
 tabRow: { display: 'flex', gap: 2, borderBottom: '2px solid #eee', marginBottom: 16 },
 tabBtn: { padding: '10px 18px', fontSize: 13, fontWeight: 500, background: 'none', border: 'none', borderBottom: '3px solid transparent', marginBottom: -2, cursor: 'pointer', color: '#888', fontFamily: 'inherit' },
 tabBtnActive: { borderBottomColor: '#0F6E56', color: '#0F6E56', fontWeight: 700 },
 tableCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: 24 },
 table: { width: '100%', borderCollapse: 'collapse' },
 th: { fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'left', padding: '12px 14px', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#fafafa', whiteSpace: 'nowrap' },
 td: { fontSize: 13, color: '#333', padding: '12px 14px', verticalAlign: 'middle' },
 pill: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, display: 'inline-block' },
 empty: { color: '#bbb', textAlign: 'center', padding: '60px 0', fontSize: 14 },
 primaryBtn: { background: '#0F6E56', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' },
 dangerBtn: { background: '#E24B4A', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
 dangerBtnFull:{ background: '#E24B4A', color: '#fff', border: 'none', padding: 10, borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, width: '100%', fontFamily: 'inherit' },
 warnBtnFull: { background: '#E09B00', color: '#fff', border: 'none', padding: 10, borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, width: '100%', fontFamily: 'inherit' },
 cancelBtn: { background: '#fff', color: '#555', border: '1px solid #e0e0e0', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' },
 overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
 modal: { background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto' },
 modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
 modalFoot: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #f0f0f0' },
 closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999', lineHeight: 1, padding: 0 },
 sidePanel: { position: 'fixed', right: 0, top: 0, bottom: 0, width: 300, background: '#fff', borderLeft: '1px solid #eee', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)', zIndex: 100, overflowY: 'auto' },
 sidePanelHead:{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 20px', borderBottom: '1px solid #f0f0f0' },
 detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9f9f9' },
 toast: { position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }
}
