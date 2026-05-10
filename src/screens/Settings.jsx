import { Fragment, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { notifySuccess } from '../notifications'
import { DEPARTMENT_CONFIG } from './department'
import { logAudit } from '../utils/audit'
import { broadcastWorkflowChanged } from '../utils/workflowEvents'

const CURRENCIES = ['KES — Kenyan Shilling','UGX — Ugandan Shilling','TZS — Tanzanian Shilling','USD — US Dollar','GBP — British Pound','EUR — Euro']
const ROLES = ['Admin','Doctor','Nurse','Pharmacist','Lab Technician','Receptionist','Radiologist','Accountant']
const ROLE_COLORS = {
 Admin: { bg:'#FCEBEB', color:'#A32D2D' },
 Doctor: { bg:'#E3F0FB', color:'#1a6fb5' },
 Nurse: { bg:'#E1F5EE', color:'#0F6E56' },
 Pharmacist: { bg:'#FFF3DC', color:'#C07000' },
 'Lab Technician': { bg:'#F0EAFC', color:'#7B5EA7' },
 Receptionist: { bg:'#f0f0f0', color:'#555' },
 Radiologist: { bg:'#E3F0FB', color:'#1a6fb5' },
 Accountant: { bg:'#FFF9E6', color:'#8A6A00' },
}

const DEPARTMENT_TYPE_OPTIONS = [
 { value:'clinical', label:'Clinical' },
 { value:'diagnostic', label:'Diagnostic' },
 { value:'pharmacy', label:'Pharmacy' },
 { value:'admin', label:'Admin' },
 { value:'support', label:'Support' },
]

const DEPARTMENT_TYPE_LABELS = DEPARTMENT_TYPE_OPTIONS.reduce((acc, option) => {
 acc[option.value] = option.label
 return acc
}, {})

const DEPARTMENT_TYPE_COLORS = {
 clinical: '#2563EB',
 diagnostic: '#D97706',
 pharmacy: '#16A34A',
 admin: '#374151',
 support: '#0891B2',
}

const DEPARTMENT_TYPE_BACKGROUNDS = {
 clinical: '#EFF6FF',
 diagnostic: '#FFFBEB',
 pharmacy: '#F0FDF4',
 admin: '#F9FAFB',
 support: '#ECFEFF',
}

function buildDepartmentForm(template = null) {
 return {
  name: template?.name || '',
  dept_type: template?.type || 'clinical',
  icon: template?.icon || '',
  description: template?.description || '',
  bed_count: template?.bed_count ?? 0,
  can_refer: template?.canRefer ?? true,
  can_order_lab: template?.canOrderLab ?? true,
  can_prescribe: template?.canPrescribe ?? true,
 }
}

function getDepartmentLayout(deptType) {
 if (deptType === 'diagnostic') {
  return {
   data_sources: ['lab_tests', 'staff'],
   ui_sections: ['lab_queue', 'completed_tests', 'staff'],
  }
 }
 if (deptType === 'pharmacy') {
  return {
   data_sources: ['prescriptions', 'staff'],
   ui_sections: ['prescription_queue', 'dispensed', 'staff'],
  }
 }
 if (deptType === 'clinical') {
  return {
   data_sources: ['visits', 'consultations', 'staff'],
   ui_sections: ['visit_queue', 'consultations', 'staff'],
  }
 }
 return {
  data_sources: ['staff'],
  ui_sections: ['staff_full'],
 }
}

const INTEGRATION_DEFS = [
 {
 key: 'kra_etims',
 label: 'KRA eTIMS Auto-Submit',
 desc: 'Submit every transaction to eTIMS automatically',
 icon: '🏛',
 fields: [
 { key:'etims_pin', label:'KRA PIN', placeholder:'P051234567X' },
 { key:'etims_secret', label:'eTIMS API Secret', placeholder:'Enter API secret key' },
 { key:'etims_env', label:'Environment', type:'select', options:['Sandbox','Production'] },
 ]
 },
 {
 key: 'sha_hie',
 label: 'SHA HIE Connection',
 desc: 'Health Information Exchange — real-time patient data',
 icon: '',
 fields: [
 { key:'sha_facility_code', label:'SHA Facility Code', placeholder:'e.g. 001234' },
 { key:'sha_api_key', label:'SHA API Key', placeholder:'Enter API key from SHA portal' },
 ]
 },
 {
 key: 'mpesa_stk',
 label: 'M-Pesa STK Push',
 desc: "Send payment requests to patients' phones",
 icon: '📱',
 fields: [
 { key:'mpesa_shortcode', label:'Business Shortcode / Paybill', placeholder:'e.g. 522522' },
 { key:'mpesa_consumer_key', label:'Consumer Key', placeholder:'From Safaricom Developer Portal' },
 { key:'mpesa_consumer_sec', label:'Consumer Secret', placeholder:'From Safaricom Developer Portal' },
 { key:'mpesa_passkey', label:'Lipa na M-Pesa Passkey', placeholder:'Enter passkey' },
 { key:'mpesa_env', label:'Environment', type:'select', options:['Sandbox','Production'] },
 ]
 },
 {
 key: 'dicom_hl7',
 label: 'DICOM HL7 Feed',
 desc: 'Connect radiology equipment to the system',
 icon: '',
 fields: [
 { key:'dicom_host', label:'DICOM Server Host / IP', placeholder:'e.g. 192.168.1.100' },
 { key:'dicom_port', label:'Port', placeholder:'e.g. 4242' },
 { key:'dicom_aet', label:'AE Title', placeholder:'e.g. NEXUS_HMS' },
 ]
 },
 {
 key: 'bulk_sms',
 label: 'Bulk SMS Alerts',
 desc: 'Send appointment reminders and results via SMS',
 icon: '💬',
 fields: [
 { key:'sms_provider', label:'SMS Provider', type:'select', options:["Africa's Talking",'Twilio','Vonage','TextSMS Kenya'] },
 { key:'sms_api_key', label:'API Key', placeholder:'Enter API key' },
 { key:'sms_sender_id', label:'Sender ID', placeholder:'e.g. NEXUSHMS' },
 ]
 },
 {
 key: 'nhif_online',
 label: 'NHIF / SHA Online Claims',
 desc: 'Submit insurance claims directly to NHIF/SHA portal',
 icon: '',
 fields: [
 { key:'nhif_code', label:'NHIF Facility Code', placeholder:'e.g. 001234' },
 { key:'nhif_username', label:'Portal Username', placeholder:'NHIF portal login' },
 { key:'nhif_password', label:'Portal Password', placeholder:'••••••••', type:'password' },
 ]
 },
]

const TABS = [
 { key:'profile', label:' Hospital Profile', adminOnly: false },
 { key:'pricelist', label:'💰 Price List', adminOnly: true },
 { key:'staff', label:'👥 Staff & Users', adminOnly: true },
 { key:'audit', label:'📝 Audit Log', adminOnly: true },
 { key:'integrations', label:'🔗 Integrations', adminOnly: true },
 { key:'system', label:'⚙ System Settings', adminOnly: true },
]

export default function Settings() {
 const { hospitalId, userRole, departments = [], refreshDepartments } = useHospital()
 const [loading, setLoading] = useState(true)
 const [loadError, setLoadError] = useState(null)
 const [saving, setSaving] = useState(false)
 const [saved, setSaved] = useState(false)
 const [activeTab, setActiveTab] = useState('profile')

 const [currentUser, setCurrentUser] = useState(null)
 const [pinInput, setPinInput] = useState('')
 const [pinError, setPinError] = useState('')
 const [adminUnlocked, setAdminUnlocked] = useState(false)
 const [showPinModal, setShowPinModal] = useState(false)
 const [pendingTab, setPendingTab] = useState(null)
 const [showAdminPin, setShowAdminPin] = useState(false)

 const [profile, setProfile] = useState({
 name:'', location:'', ppb_license:'', kra_pin:'', nhif_code:'', mpesa_paybill:'', owner_email:''
 })

 const [sysSettings, setSysSettings] = useState({
 low_stock_threshold: 20,
 expiry_warning_days: 90,
 currency: 'KES — Kenyan Shilling',
 auto_morning_report: true,
 receipt_footer: 'Thank you for choosing our services. Get well soon!',
 default_opd_fee: 500,
 default_ipd_fee: 1000,
 default_emergency_fee:1500,
 admin_pin: '',
 })

 const [integrations, setIntegrations] = useState(() => {
 const init = {}
 INTEGRATION_DEFS.forEach(d => { init[d.key] = false })
 return init
 })
 const [intgConfig, setIntgConfig] = useState({})
 const [configModal, setConfigModal] = useState(null)

 const [staff, setStaff] = useState([])
 const [receiptMonitor, setReceiptMonitor] = useState({ receipts: [], payMix: [] })
 const [showAddUser, setShowAddUser] = useState(false)
 const [editUser, setEditUser] = useState(null)
 const [userForm, setUserForm] = useState({ full_name:'', email:'', role:'Doctor', phone:'', speciality:'', status:'Active' })
 const [savingUser, setSavingUser] = useState(false)
 const STAFF_STATUS_OPTIONS = ['Pending Approval','Active','On Leave','Suspended','Rejected','Terminated']
 const [showDepartmentModal, setShowDepartmentModal] = useState(false)
 const [editDepartment, setEditDepartment] = useState(null)
 const [departmentForm, setDepartmentForm] = useState(() => buildDepartmentForm())
 const [savingDepartment, setSavingDepartment] = useState(false)

 const [chargeCodes, setChargeCodes] = useState([])
 const [ccEdits, setCcEdits] = useState({})
 const [ccSaving, setCcSaving] = useState(false)
 const [ccSaved, setCcSaved] = useState(false)
 const [ccFilter, setCcFilter] = useState('All')
 const [showAddCode, setShowAddCode] = useState(false)
 const [newCode, setNewCode] = useState({ code:'', name:'', department:'', category:'Consultation', unit_price_kes:'' })
 const CC_CATEGORIES = ['Consultation','Lab','Imaging','Procedure','Bed','Drug','Other']
 const [auditEntries, setAuditEntries] = useState([])
 const [auditPage, setAuditPage] = useState(1)
 const [auditPageSize] = useState(30)
 const [auditTotal, setAuditTotal] = useState(0)
 const [auditLoading, setAuditLoading] = useState(false)
 const [auditSearch, setAuditSearch] = useState('')
 const [auditDateRange, setAuditDateRange] = useState('30d')
 const [auditSelectedId, setAuditSelectedId] = useState(null)

 const isAdmin = ['admin','Admin'].includes(currentUser?.role) || adminUnlocked
 const standardDepartmentNames = useMemo(
  () => Object.keys(DEPARTMENT_CONFIG).sort((a, b) => a.localeCompare(b)),
  []
 )

 useEffect(() => {
  if (!isAdmin && activeTab !== 'profile') {
   setActiveTab('profile')
  }
 }, [isAdmin, activeTab])

 async function ensureHospitalUserLink(email, role) {
  if (!email || !hospitalId || !role) return false
  const { data: authUser, error: authErr } = await supabase
    .from('auth.users')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (authErr || !authUser?.id) {
    if (authErr) console.warn('Could not resolve auth user for hospital_users link:', authErr.message)
    return false
  }

  const { error } = await supabase.from('hospital_users').upsert([
    { user_id: authUser.id, hospital_id: hospitalId, role }
  ], { onConflict: ['user_id', 'hospital_id'] })
  if (error) console.warn('Hospital user link upsert failed:', error.message)
  return !error
 }

 async function fetchChargeCodes() {
  try {
   const { data } = await supabase
    .from('charge_codes')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('category')
    .order('name')
   setChargeCodes(data || [])
   setCcEdits({})
  } catch (e) {
   console.error('fetchChargeCodes error:', e)
  }
 }

 function getAuditStartDate(range) {
  const now = new Date()
  const start = new Date()
  if (range === '7d') start.setDate(now.getDate() - 7)
  else if (range === '30d') start.setDate(now.getDate() - 30)
  else if (range === '90d') start.setDate(now.getDate() - 90)
  else return null
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
 }

 function serializeCsvCell(value) {
  const cell = value === null || value === undefined ? '' : String(value)
  return `"${cell.replace(/"/g, '""')}"`
 }

 function exportAuditCsv(entries) {
  if (!entries.length) return
  const headers = ['Timestamp', 'User Role', 'Action', 'Target Table', 'Target Id', 'Details']
  const rows = entries.map((entry) => [
   entry.performed_at || '',
   entry.user_role || '',
   entry.action || '',
   entry.target_table || '',
   entry.target_id || '',
   entry.details || '',
  ])
  const csv = [headers.map(serializeCsvCell).join(','), ...rows.map(row => row.map(serializeCsvCell).join(','))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `remedacare-audit-${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  notifySuccess('Audit log exported to CSV.')
 }

 async function fetchAuditEntries(page = 1) {
  if (!hospitalId) return
  setAuditLoading(true)
  try {
   const from = (page - 1) * auditPageSize
   const to = page * auditPageSize - 1
   const query = supabase
    .from('audit_log')
    .select('id,user_role,action,target_table,target_id,details,performed_at', { count: 'exact' })
    .eq('hospital_id', hospitalId)
    .order('performed_at', { ascending: false })
    .range(from, to)

   const searchTerm = auditSearch.trim()
   if (searchTerm) {
    query.or(`action.ilike.%${searchTerm}%,target_table.ilike.%${searchTerm}%,details.ilike.%${searchTerm}%`)
   }
   const startDate = getAuditStartDate(auditDateRange)
   if (startDate) {
    query.gte('performed_at', startDate)
   }

   const { data, count, error } = await query
   if (error) {
    console.error('fetchAuditEntries error:', error.message)
    setAuditEntries([])
    setAuditTotal(0)
   } else {
    setAuditEntries(data || [])
    setAuditTotal(count || 0)
   }
  } catch (e) {
   console.error('fetchAuditEntries error:', e.message)
   setAuditEntries([])
   setAuditTotal(0)
  }
  setAuditLoading(false)
 }

 async function refreshAuditEntries() {
  setAuditPage(1)
  await fetchAuditEntries(1)
 }

 async function handleAuditPageChange(page) {
  setAuditPage(page)
  await fetchAuditEntries(page)
 }

 async function handleAuditSearch(value) {
  setAuditSearch(value)
  setAuditPage(1)
 }

 async function handleAuditRange(value) {
  setAuditDateRange(value)
  setAuditPage(1)
 }

 async function saveChargeCodes() {
  const dirty = Object.entries(ccEdits)
  if (!dirty.length) return
  setCcSaving(true)
  try {
   for (const [id, changes] of dirty) {
    await supabase.from('charge_codes').update(changes).eq('id', id).eq('hospital_id', hospitalId)
   }
   setCcSaved(true)
   setTimeout(() => setCcSaved(false), 2500)
   await fetchChargeCodes()
  } catch (e) {
   console.error('saveChargeCodes error:', e)
  }
  setCcSaving(false)
 }

 async function addChargeCode() {
  if (!newCode.code || !newCode.name || !newCode.department) {
   window.notifyFromLegacyAlert('Code, name and department are required.')
   return
  }
  const { error } = await supabase.from('charge_codes').insert({
   hospital_id: hospitalId,
   code: newCode.code.toUpperCase().replace(/\s+/g, '-'),
   name: newCode.name,
   department: newCode.department,
   category: newCode.category,
   unit_price_kes: parseFloat(newCode.unit_price_kes) || 0,
   is_active: true,
  })
  if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); return }
  setShowAddCode(false)
  setNewCode({ code:'', name:'', department:'', category:'Consultation', unit_price_kes:'' })
  await fetchChargeCodes()
 }

 function editCc(id, field, value) {
  setCcEdits(prev => ({
   ...prev,
   [id]: { ...(prev[id] || {}), [field]: value },
  }))
 }

 async function fetchAll() {
  setLoading(true)
  setLoadError(null)
  try {
   // Fetch hospital data
   const { data: h, error: hError } = await supabase
    .from('hospitals')
    .select('*')
    .eq('id', hospitalId)
    .single()

   if (hError) {
    console.error('Hospital fetch error:', hError)
    // Don't throw — still render with defaults
   }

   if (h) {
    setProfile({
     name: h.name || '',
     location: h.location || '',
     ppb_license: h.ppb_license || '',
     kra_pin: h.kra_pin || '',
     nhif_code: h.nhif_code || '',
     mpesa_paybill: h.mpesa_paybill || '',
     owner_email: h.owner_email || '',
    })
    if (h.system_settings) {
     const ss = h.system_settings
     setSysSettings(prev => ({ ...prev, ...ss }))
     if (ss.integrations_enabled) setIntegrations(prev => ({ ...prev, ...ss.integrations_enabled }))
     if (ss.integrations_config) setIntgConfig(ss.integrations_config)
    }
   }

   // Fetch staff — safe fallback to []
   const { data: s } = await supabase
    .from('staff')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('created_at')
   setStaff(s || [])

   // Fetch sales — safe fallback to []
   const { data: sales } = await supabase
    .from('sales_ledger')
    .select('id,receipt_number,customer_name,total_kes,payment_method,sold_at')
    .eq('hospital_id', hospitalId)
    .order('sold_at', { ascending: false })
    .limit(60)

   const salesData = sales || []
   const groupedReceipts = Object.values(salesData.reduce((acc, row) => {
    const key = row.receipt_number || row.id
    if (!acc[key]) {
     acc[key] = {
      receipt_number: row.receipt_number || '—',
      customer_name: row.customer_name || 'Walk-in',
      payment_method: row.payment_method || 'Cash',
      total_kes: 0,
      sold_at: row.sold_at || null,
     }
    }
    acc[key].total_kes += Number(row.total_kes || 0)
    if (!acc[key].sold_at || new Date(row.sold_at || 0) > new Date(acc[key].sold_at || 0)) {
     acc[key].sold_at = row.sold_at || acc[key].sold_at
    }
    return acc
   }, {}))
   .sort((a, b) => new Date(b.sold_at || 0) - new Date(a.sold_at || 0))
   .slice(0, 6)

   const payMix = Object.entries(salesData.reduce((acc, row) => {
    const key = row.payment_method || 'Cash'
    acc[key] = (acc[key] || 0) + Number(row.total_kes || 0)
    return acc
   }, {}))
   .sort((a, b) => b[1] - a[1])
   .slice(0, 5)
   .map(([method, amount]) => ({ method, amount }))
   setReceiptMonitor({ receipts: groupedReceipts, payMix })

   // Current user from context (not localStorage)
   setCurrentUser({ role: userRole || 'User', full_name: '' })

  } catch (err) {
   console.error('Settings fetchAll error:', err)
   setLoadError('Failed to load settings. Please refresh the page.')
   // Still set current user so the page isn't completely broken
   setCurrentUser({ role: userRole || 'User', full_name: '' })
  } finally {
   // ALWAYS stop loading, no matter what
   setLoading(false)
  }
 }

 useEffect(() => {
  if (hospitalId) {
   fetchAll()
   fetchChargeCodes()
  } else {
   // No hospitalId yet — still stop the spinner after a moment
   const t = setTimeout(() => setLoading(false), 3000)
   return () => clearTimeout(t)
  }
 }, [hospitalId])

 useEffect(() => {
  if (activeTab === 'audit' && hospitalId) {
   fetchAuditEntries(1)
  }
 }, [activeTab, hospitalId, auditSearch, auditDateRange])

 function handleTabClick(tab) {
  if (tab.adminOnly && !isAdmin) {
   setPendingTab(tab.key)
   setPinInput('')
   setPinError('')
   setShowPinModal(true)
   return
  }
  setActiveTab(tab.key)
 }

 function handlePinSubmit() {
  if (!sysSettings.admin_pin) {
   setPinError('No PIN set for this hospital yet. Go to System Settings → Admin Settings PIN to create one.')
   return
  }
  if (pinInput === sysSettings.admin_pin) {
   setAdminUnlocked(true)
   setShowPinModal(false)
   if (pendingTab) setActiveTab(pendingTab)
  } else {
   setPinError('Incorrect PIN. Try again.')
   setPinInput('')
  }
 }

 async function handleSave() {
  if (!hospitalId || hospitalId === 'null') {
   window.notifyFromLegacyAlert('Unable to save settings: invalid hospital identifier. Please refresh and try again.')
   return
  }
  setSaving(true)
  try {
   const { error } = await supabase.from('hospitals').update({
    name: profile.name,
    location: profile.location,
    ppb_license: profile.ppb_license,
    kra_pin: profile.kra_pin,
    nhif_code: profile.nhif_code,
    mpesa_paybill: profile.mpesa_paybill,
    owner_email: profile.owner_email,
    system_settings: {
     ...sysSettings,
     integrations_enabled: integrations,
     integrations_config: intgConfig,
    },
   }).eq('id', hospitalId)
   if (error) window.notifyFromLegacyAlert('Error saving: ' + error.message)
   else {
    setSaved(true); setTimeout(() => setSaved(false), 3000)
    broadcastWorkflowChanged({ source: 'settings-save' })
   }
  } catch (e) {
   window.notifyFromLegacyAlert('Error saving: ' + e.message)
  }
  setSaving(false)
 }

 async function handleSaveUser() {
  if (!userForm.full_name || !userForm.role) { window.notifyFromLegacyAlert('Name and role required'); return }
  if (!editUser && !userForm.email) { window.notifyFromLegacyAlert('Email is required to invite a new staff member'); return }
  setSavingUser(true)
  try {
   if (editUser) {
    // 1. Update staff table
    await supabase.from('staff').update({
     full_name: userForm.full_name,
     role: userForm.role,
     phone: userForm.phone,
     speciality: userForm.speciality,
     email: userForm.email,
     status: userForm.status,
    }).eq('id', editUser.id)

    // 2. Sync role to hospital_users so it takes effect on their next login
    const emailToSync = userForm.email || editUser.email
    if (emailToSync) {
     const huRole = userForm.role.toLowerCase() === 'admin' ? 'admin' : 'staff'
     const { error: rpcErr } = await supabase.rpc('set_staff_role', {
      p_hospital_id: hospitalId,
      p_email: emailToSync,
      p_role: huRole,
     })
     if (rpcErr) {
      console.warn('Role sync to hospital_users failed (run the SQL function in Supabase):', rpcErr.message)
      await ensureHospitalUserLink(emailToSync, huRole)
     }
    }
   } else {
    const { data: existingStaff } = await supabase
     .from('staff')
     .select('id')
     .eq('hospital_id', hospitalId)
     .eq('email', userForm.email)
     .maybeSingle()

    if (existingStaff?.id) {
     await supabase.from('staff').update({
      full_name: userForm.full_name,
      role: userForm.role,
      phone: userForm.phone,
      speciality: userForm.speciality,
      status: userForm.status || 'Active',
     }).eq('id', existingStaff.id)

     const huRole = userForm.role.toLowerCase() === 'admin' ? 'admin' : 'staff'
     const { error: rpcErr } = await supabase.rpc('set_staff_role', {
      p_hospital_id: hospitalId,
      p_email: userForm.email,
      p_role: huRole,
     })
     if (rpcErr) {
      console.warn('Role sync to hospital_users failed:', rpcErr.message)
      await ensureHospitalUserLink(userForm.email, huRole)
     }

     window.notifyFromLegacyAlert(`✅ ${userForm.full_name} already exists. Their staff record has been updated and their role has been synced.`)
    } else {
     // 1. Add to staff table
     await supabase.from('staff').insert({
      hospital_id: hospitalId,
      full_name: userForm.full_name,
      email: userForm.email,
      role: userForm.role,
      phone: userForm.phone,
      speciality: userForm.speciality,
      status: userForm.status || 'Active',
      current_shift: 'Day (07:00–19:00)',
     })

     const huRole = userForm.role.toLowerCase() === 'admin' ? 'admin' : 'staff'
     await ensureHospitalUserLink(userForm.email, huRole)

     // 2. Send Supabase magic link so they can set their own password
     const { error: inviteErr } = await supabase.auth.signInWithOtp({
      email: userForm.email,
      options: {
       shouldCreateUser: true,
       emailRedirectTo: window.location.origin,
       data: {
        full_name: userForm.full_name,
        hospital_id: hospitalId,
        role: userForm.role,
       }
      }
     })
     if (inviteErr) {
      console.warn('Could not send invite email:', inviteErr.message)
      window.notifyFromLegacyAlert(`Staff added! Note: Could not send invite email — ${inviteErr.message}. Share the app link manually.`)
     } else {
      window.notifyFromLegacyAlert(`✅ ${userForm.full_name} added! An invite link has been sent to ${userForm.email} so they can set their password and log in.`)
     }
    }
   }
   setShowAddUser(false)
   setEditUser(null)
   setUserForm({ full_name:'', email:'', role:'Doctor', phone:'', speciality:'', status:'Active' })
   await logAudit(supabase, {
    hospitalId,
    userRole,
    action: editUser ? 'staff_updated' : 'staff_added',
    targetTable: 'staff',
    targetId: editUser?.id || null,
    details: {
     name: userForm.full_name,
     role: userForm.role,
     email: userForm.email,
    },
   })
   fetchAll()
   broadcastWorkflowChanged({ source: editUser ? 'staff-update' : 'staff-create', full_name: userForm.full_name, role: userForm.role })
  } catch (e) {
   window.notifyFromLegacyAlert('Error: ' + e.message)
  }
  setSavingUser(false)
 }

 async function handleDeleteUser(id) {
  if (!await window.openConfirmDialog('Remove this staff member?')) return
  await supabase.from('staff').delete().eq('id', id)
  fetchAll()
  broadcastWorkflowChanged({ source: 'staff-delete', id })
 }

 async function handleUpdateUserShift(id, currentShift) {
  await supabase.from('staff').update({ current_shift: currentShift }).eq('id', id)
  fetchAll()
  broadcastWorkflowChanged({ source: 'staff-shift', id, current_shift: currentShift })
 }

 async function handleUpdateUserStatus(id, status) {
  await supabase.from('staff').update({ status }).eq('id', id)
  fetchAll()
  broadcastWorkflowChanged({ source: 'staff-status', id, status })
 }

 function openEdit(user) {
  setEditUser(user)
  setUserForm({ full_name:user.full_name||'', email:user.email||'', role:user.role||'Doctor', phone:user.phone||'', speciality:user.speciality||'', status:user.status||'Active' })
 }

 function applyDepartmentTemplate(name, currentForm = departmentForm) {
  const template = DEPARTMENT_CONFIG[name]
  if (!template) {
   return { ...currentForm, name }
  }
  return {
   ...currentForm,
   name,
   dept_type: template.type || currentForm.dept_type,
   icon: template.icon || currentForm.icon,
   description: template.description || currentForm.description,
   can_refer: template.canRefer ?? currentForm.can_refer,
   can_order_lab: template.canOrderLab ?? currentForm.can_order_lab,
   can_prescribe: template.canPrescribe ?? currentForm.can_prescribe,
  }
 }

 function handleDepartmentFieldChange(field, value) {
  if (field === 'name') {
   setDepartmentForm(prev => applyDepartmentTemplate(value, prev))
   return
  }
  if (field === 'bed_count') {
   setDepartmentForm(prev => ({ ...prev, bed_count: value }))
   return
  }
  setDepartmentForm(prev => ({ ...prev, [field]: value }))
 }

 function openDepartmentModal(department = null) {
  if (!department) {
   setEditDepartment(null)
   setDepartmentForm(buildDepartmentForm())
  } else {
   setEditDepartment(department)
   setDepartmentForm({
    name: department.name || '',
    dept_type: department.dept_type || 'clinical',
    icon: department.icon || '',
    description: department.description || '',
    bed_count: department.bed_count ?? 0,
    can_refer: department.can_refer ?? true,
    can_order_lab: department.can_order_lab ?? true,
    can_prescribe: department.can_prescribe ?? true,
   })
  }
  setShowDepartmentModal(true)
 }

 async function handleSaveDepartment() {
  if (!hospitalId || hospitalId === 'null') {
   window.notifyFromLegacyAlert('Unable to save department: invalid hospital identifier. Please refresh and try again.')
   return
  }
  const name = departmentForm.name.trim()
  if (!name) {
   window.notifyFromLegacyAlert('Department name is required.')
   return
  }

  const deptType = departmentForm.dept_type || 'clinical'
  const payload = {
   hospital_id: hospitalId,
   name,
   dept_type: deptType,
   icon: departmentForm.icon.trim() || null,
   description: departmentForm.description.trim() || null,
   bed_count: Math.max(0, parseInt(departmentForm.bed_count, 10) || 0),
   can_refer: !!departmentForm.can_refer,
   can_order_lab: !!departmentForm.can_order_lab,
   can_prescribe: !!departmentForm.can_prescribe,
   color_hex: DEPARTMENT_TYPE_COLORS[deptType] || DEPARTMENT_TYPE_COLORS.admin,
   bg: DEPARTMENT_TYPE_BACKGROUNDS[deptType] || DEPARTMENT_TYPE_BACKGROUNDS.admin,
   ...getDepartmentLayout(deptType),
  }

  setSavingDepartment(true)
  try {
   const action = editDepartment ? 'department_updated' : 'department_created'
   const query = editDepartment
    ? supabase.from('departments').update(payload).eq('hospital_id', hospitalId).eq('id', editDepartment.id)
    : supabase.from('departments').insert(payload)
   const { data, error } = await query.select('id,name').single()
   if (error) {
    window.notifyFromLegacyAlert(`Error: ${error.message}`)
    return
   }

   await logAudit(supabase, {
    hospitalId,
    userRole,
    action,
    targetTable: 'departments',
    targetId: data?.id || editDepartment?.id || null,
    details: {
     name,
     dept_type: deptType,
     bed_count: payload.bed_count,
    },
   })
   await refreshDepartments?.()
   notifySuccess('Department saved.')
   broadcastWorkflowChanged({ source: action, department: name })
   setShowDepartmentModal(false)
   setEditDepartment(null)
   setDepartmentForm(buildDepartmentForm())
  } catch (e) {
   window.notifyFromLegacyAlert(`Error: ${e.message}`)
  } finally {
   setSavingDepartment(false)
  }
 }

 async function handleDeleteDepartment(department) {
  if (!department?.id) return
  if (!await window.openConfirmDialog(`Delete '${department.name}'? Existing staff assignments will not be removed.`)) return

  try {
   const { error } = await supabase
    .from('departments')
    .delete()
    .eq('hospital_id', hospitalId)
    .eq('id', department.id)
   if (error) {
    window.notifyFromLegacyAlert(`Error: ${error.message}`)
    return
   }

   await logAudit(supabase, {
    hospitalId,
    userRole,
    action: 'department_deleted',
    targetTable: 'departments',
    targetId: department.id,
    details: {
     name: department.name,
     dept_type: department.dept_type || null,
    },
   })
   await refreshDepartments?.()
   notifySuccess('Department removed.')
   broadcastWorkflowChanged({ source: 'department_deleted', department: department.name })
  } catch (e) {
   window.notifyFromLegacyAlert(`Error: ${e.message}`)
  }
 }

 // ── Loading state ──────────────────────────────────────────────
 if (loading) return (
  <div style={s.loadWrap}>
   <div style={s.spinner}/>
   <p style={{color:'#0F6E56',marginTop:12}}>Loading Settings...</p>
  </div>
 )

 // ── Error state — still shows page skeleton ────────────────────
 if (loadError && !profile.name) return (
  <div style={s.loadWrap}>
   <div style={{fontSize:40}}>⚠️</div>
   <p style={{color:'#A32D2D',marginTop:12,fontWeight:600}}>{loadError}</p>
   <button style={{...s.saveBtn,marginTop:16}} onClick={() => { setLoading(true); fetchAll() }}>Retry</button>
  </div>
 )

 const tabsWithDepartments = TABS.some(t => t.key === 'departments')
  ? TABS
  : [
     ...TABS.slice(0, 3),
     { key:'departments', label:'Departments', adminOnly: true },
     ...TABS.slice(3),
    ]
 const visibleTabs = isAdmin ? tabsWithDepartments : tabsWithDepartments.filter(t => !t.adminOnly)

 function handleAdminSettingsClick() {
  setPendingTab('profile')
  setPinInput('')
  setPinError('')
  setShowPinModal(true)
 }

 return (
  <div style={s.page}>
  <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`}</style>

  {/* HEADER */}
  <div style={s.header}>
  <div>
  <h1 style={s.title}>Settings</h1>
  <p style={s.subtitle}>
  System configuration · REMEDACARE HMS
  {currentUser && (
  <span style={{marginLeft:10,background: isAdmin?'#FCEBEB':'#f0f0f0', color: isAdmin?'#A32D2D':'#555',
  padding:'2px 10px', borderRadius:99, fontSize:11, fontWeight:700}}>
  {isAdmin ? '🔓 Admin Access' : `🔒 ${currentUser.role}`}
  </span>
  )}
  </p>
  </div>
  <button style={{...s.saveBtn, background: saved?'#27ae60':'#0F6E56'}} onClick={handleSave} disabled={saving}>
  {saving?'⏳ Saving...': saved?'✅ Saved!':'💾 Save Changes'}
  </button>
  </div>

  {/* TABS */}
  <div style={s.tabRow}>
  {visibleTabs.map(t => (
  <button key={t.key}
  style={{...s.tab, ...(activeTab===t.key?s.tabActive:{})}}
  onClick={() => handleTabClick(t)}>
  {t.label}
  </button>
  ))}
  {!isAdmin && (
  <button
  key="admin-settings"
  style={{...s.tab, marginLeft:12, whiteSpace:'nowrap'}}
  onClick={handleAdminSettingsClick}
  >
  🔐 Admin Settings
  </button>
  )}
  </div>

  <div style={{animation:'fadeIn .2s ease'}}>

  {/* ══ HOSPITAL PROFILE ══════════════════════════════════════════ */}
  {activeTab==='profile' && (
  <div style={s.card}>
  <div style={s.cardHeader}> Hospital Profile</div>
  <div style={s.cardBody}>
  <div style={s.grid2}>
  <Fld label="Hospital Name *">
  <input style={s.input} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})} placeholder="e.g. Kenyatta National Hospital"/>
  </Fld>
  <Fld label="Location / Address">
  <input style={s.input} value={profile.location} onChange={e=>setProfile({...profile,location:e.target.value})} placeholder="e.g. Nairobi, Kenya"/>
  </Fld>
  <Fld label="PPB License No.">
  <input style={s.input} value={profile.ppb_license} onChange={e=>setProfile({...profile,ppb_license:e.target.value})} placeholder="PPB/PH/2024/00412"/>
  </Fld>
  <Fld label="KRA PIN">
  <input style={s.input} value={profile.kra_pin} onChange={e=>setProfile({...profile,kra_pin:e.target.value})} placeholder="P051234567X"/>
  </Fld>
  <Fld label="NHIF/SHA Facility Code">
  <input style={s.input} value={profile.nhif_code} onChange={e=>setProfile({...profile,nhif_code:e.target.value})} placeholder="e.g. 001234"/>
  </Fld>
  <Fld label="M-Pesa Paybill / Till No.">
  <input style={s.input} value={profile.mpesa_paybill} onChange={e=>setProfile({...profile,mpesa_paybill:e.target.value})} placeholder="e.g. 522522"/>
  </Fld>
  </div>
  <Fld label="Admin / Owner Email">
  <input style={s.input} value={profile.owner_email} onChange={e=>setProfile({...profile,owner_email:e.target.value})} placeholder="admin@hospital.co.ke"/>
  </Fld>
  <div style={{marginTop:16}}>
  <div style={s.sectionLabel}>Receipt Footer Message</div>
  <textarea style={{...s.input,height:72,resize:'vertical'}}
  value={sysSettings.receipt_footer}
  onChange={e=>setSysSettings({...sysSettings,receipt_footer:e.target.value})}
  placeholder="Thank you for choosing our services..."/>
  </div>
  <div style={{marginTop:18}}>
  <div style={s.sectionLabel}>POS Receipt Snapshot</div>
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:12}}>
  <div style={s.infoCard}>
  <div style={s.infoTitle}>Recent Pharmacy Payments</div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
  {receiptMonitor.payMix.length === 0 ? (
  <span style={{fontSize:12,color:'#888'}}>No pharmacy receipts yet</span>
  ) : receiptMonitor.payMix.map(item => (
  <span key={item.method} style={{...s.pill,background:item.method==='M-Pesa'?'#E1F5EE':item.method==='Credit'?'#F0EAFC':/sha/i.test(item.method)?'#FFF3DC':/insurance/i.test(item.method)?'#E3F0FB':'#f0f0f0',color:item.method==='M-Pesa'?'#0F6E56':item.method==='Credit'?'#7B5EA7':/sha/i.test(item.method)?'#C07000':/insurance/i.test(item.method)?'#1a6fb5':'#555'}}>
  {item.method}: KES {Number(item.amount || 0).toLocaleString()}
  </span>
  ))}
  </div>
  </div>
  <div style={s.infoCard}>
  <div style={s.infoTitle}>Receipt Visibility</div>
  <div style={{fontSize:12,color:'#555',lineHeight:1.6,marginTop:10}}>
  Pharmacy POS receipts now flow through shared billing data, so the chosen payment method appears in Dashboard, Reports, Billing, and this Settings snapshot.
  </div>
  </div>
  </div>
  <div style={{border:'1px solid #eee',borderRadius:10,overflow:'hidden'}}>
  <table style={s.table}>
  <thead>
  <tr style={{background:'#fafafa'}}>
  {['Receipt','Patient','Payment','Amount','Created'].map(h => <th key={h} style={s.th}>{h}</th>)}
  </tr>
  </thead>
  <tbody>
  {receiptMonitor.receipts.length===0 ? (
  <tr><td colSpan={5} style={{...s.td,textAlign:'center',color:'#888',padding:'18px'}}>No recent pharmacy receipts</td></tr>
  ) : receiptMonitor.receipts.map(item => (
  <tr key={item.receipt_number} style={{borderBottom:'1px solid #f5f5f5'}}>
  <td style={{...s.td,fontWeight:700}}>{item.receipt_number}</td>
  <td style={s.td}>{item.customer_name}</td>
  <td style={s.td}>{item.payment_method}</td>
  <td style={{...s.td,fontWeight:700,color:'#0F6E56'}}>KES {Number(item.total_kes || 0).toLocaleString()}</td>
  <td style={{...s.td,color:'#666'}}>{item.sold_at ? new Date(item.sold_at).toLocaleString('en-KE') : '—'}</td>
  </tr>
  ))}
  </tbody>
  </table>
  </div>
  </div>
  <div style={{marginTop:16}}>
  <div style={s.sectionLabel}>Default Consultation Fees (KES)</div>
  <div style={s.grid3}>
  <Fld label="OPD Fee">
  <input style={s.input} type="number" value={sysSettings.default_opd_fee}
  onChange={e=>setSysSettings({...sysSettings,default_opd_fee:parseInt(e.target.value)||0})}/>
  </Fld>
  <Fld label="IPD / Admission Fee">
  <input style={s.input} type="number" value={sysSettings.default_ipd_fee}
  onChange={e=>setSysSettings({...sysSettings,default_ipd_fee:parseInt(e.target.value)||0})}/>
  </Fld>
  <Fld label="Emergency Fee">
  <input style={s.input} type="number" value={sysSettings.default_emergency_fee}
  onChange={e=>setSysSettings({...sysSettings,default_emergency_fee:parseInt(e.target.value)||0})}/>
  </Fld>
  </div>
  </div>
  </div>
  </div>
  )}

  {/* ══ PRICE LIST / CHARGE CODES ══════════════════════════════════ */}
  {activeTab==='pricelist' && (() => {
   const categories = ['All', ...CC_CATEGORIES]
   const displayed = chargeCodes.filter(cc => ccFilter === 'All' || cc.category === ccFilter)
   const grouped = displayed.reduce((acc, cc) => {
    const cat = cc.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(cc)
    return acc
   }, {})
   const dirtyCount = Object.keys(ccEdits).length
   return (
    <div style={s.card}>
     <div style={{ ...s.cardHeader, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
      <span>💰 Price List — Charge Codes</span>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
       {ccSaved && <span style={{ fontSize:12, color:'#0F6E56', fontWeight:700 }}>✅ Saved</span>}
       {dirtyCount > 0 && <span style={{ fontSize:12, color:'#D97706', fontWeight:600 }}>{dirtyCount} unsaved change{dirtyCount>1?'s':''}</span>}
       <button style={s.addBtn} onClick={() => setShowAddCode(true)}>+ Add Code</button>
       <button
        style={{ ...s.addBtn, background: dirtyCount > 0 ? '#0F6E56' : '#ccc', cursor: dirtyCount > 0 ? 'pointer' : 'default' }}
        onClick={saveChargeCodes} disabled={ccSaving || dirtyCount === 0}>
        {ccSaving ? 'Saving…' : '💾 Save Changes'}
       </button>
      </div>
     </div>
     <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16, padding:'0 24px' }}>
      {categories.map(cat => (
       <button key={cat}
        style={{ padding:'5px 12px', borderRadius:20, border:'1px solid #ddd', background: ccFilter===cat ? '#0F6E56' : '#fff', color: ccFilter===cat ? '#fff' : '#555', fontSize:12, fontWeight:600, cursor:'pointer' }}
        onClick={() => setCcFilter(cat)}>{cat}</button>
      ))}
     </div>
     {showAddCode && (
      <div style={{ background:'#F0FDF4', border:'1px solid #9FE1CB', borderRadius:10, padding:16, marginBottom:16, margin:'0 24px 16px' }}>
       <div style={{ fontWeight:700, fontSize:13, color:'#0F6E56', marginBottom:12 }}>New Charge Code</div>
       <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:10 }}>
        {[
         ['Code', 'code', 'e.g. CONS-VIP'],
         ['Name', 'name', 'e.g. VIP Consultation'],
         ['Department', 'department', 'e.g. OPD / Outpatient'],
        ].map(([lbl, field, ph]) => (
         <div key={field}>
          <label style={{ fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:4, display:'block' }}>{lbl} *</label>
          <input style={s.input} placeholder={ph} value={newCode[field]}
           onChange={e => setNewCode(p => ({...p, [field]: e.target.value}))} />
         </div>
        ))}
        <div>
         <label style={{ fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:4, display:'block' }}>Category *</label>
         <select style={s.input} value={newCode.category} onChange={e => setNewCode(p => ({...p, category: e.target.value}))}>
          {CC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
         </select>
        </div>
        <div>
         <label style={{ fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:4, display:'block' }}>Unit Price (KES)</label>
         <input style={s.input} type="number" placeholder="0" value={newCode.unit_price_kes}
          onChange={e => setNewCode(p => ({...p, unit_price_kes: e.target.value}))} />
        </div>
       </div>
       <div style={{ display:'flex', gap:8 }}>
        <button style={{ ...s.addBtn, background:'#0F6E56' }} onClick={addChargeCode}>Add</button>
        <button style={{ ...s.addBtn, background:'#fff', color:'#555', border:'1px solid #ddd' }} onClick={() => setShowAddCode(false)}>Cancel</button>
       </div>
      </div>
     )}
     <div style={{padding:'0 24px 24px'}}>
      {Object.entries(grouped).map(([cat, codes]) => (
       <div key={cat} style={{ marginBottom:24 }}>
        <div style={s.sectionLabel}>{cat}</div>
        <table style={s.table}>
         <thead>
          <tr>
           {['Code','Name','Department','Price (KES)','Active',''].map(h => (
            <th key={h} style={{ ...s.th, textAlign: h==='Price (KES)'?'right':'left' }}>{h}</th>
           ))}
          </tr>
         </thead>
         <tbody>
          {codes.map(cc => {
           const edit = ccEdits[cc.id] || {}
           const price = edit.unit_price_kes !== undefined ? edit.unit_price_kes : cc.unit_price_kes
           const active = edit.is_active !== undefined ? edit.is_active : cc.is_active
           const isDirty = !!ccEdits[cc.id]
           return (
            <tr key={cc.id} style={{ background: isDirty ? '#FFFBEB' : 'transparent' }}>
             <td style={{ ...s.td, fontFamily:'monospace', fontSize:11, color:'#6B7280' }}>{cc.code}</td>
             <td style={s.td}><strong style={{ fontSize:13 }}>{cc.name}</strong></td>
             <td style={{ ...s.td, fontSize:12, color:'#6B7280' }}>{cc.department}</td>
             <td style={{ ...s.td, textAlign:'right' }}>
              <input type="number" value={price}
               onChange={e => editCc(cc.id, 'unit_price_kes', parseFloat(e.target.value) || 0)}
               style={{ width:100, padding:'5px 8px', border:`1px solid ${isDirty?'#D97706':'#ddd'}`, borderRadius:6, fontSize:13, fontWeight:700, textAlign:'right', outline:'none' }}
              />
             </td>
             <td style={{ ...s.td, textAlign:'center' }}>
              <input type="checkbox" checked={active}
               onChange={e => editCc(cc.id, 'is_active', e.target.checked)}
               style={{ width:16, height:16, cursor:'pointer', accentColor:'#0F6E56' }}
              />
             </td>
             <td style={{ ...s.td, fontSize:11, color: isDirty ? '#D97706' : '#ccc', fontWeight:600 }}>
              {isDirty ? '● unsaved' : ''}
             </td>
            </tr>
           )
          })}
         </tbody>
        </table>
       </div>
      ))}
      {displayed.length === 0 && (
       <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>
        No charge codes found. Add your first one above.
       </div>
      )}
     </div>
    </div>
   )
  })()}

  {/* ══ STAFF & USERS ═════════════════════════════════════════════ */}
  {activeTab==='staff' && (
  <div style={s.card}>
  <div style={{...s.cardHeader,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
  <span>👥 Staff & Users</span>
  <button style={s.addBtn} onClick={()=>{setEditUser(null);setUserForm({full_name:'',email:'',role:'Doctor',phone:'',speciality:'',status:'Active'});setShowAddUser(true)}}>
  + Add Staff
  </button>
  </div>
  <div style={s.cardBody}>
  <div style={{background:'#E3F0FB',borderRadius:10,padding:'12px 16px',marginBottom:16,fontSize:13,color:'#1a6fb5'}}>
  Staff added here will also appear in HR for shift and leave management.
  </div>
  {staff.length===0 ? (
  <div style={s.empty}><div style={{fontSize:40}}>👤</div><div style={{marginTop:8,color:'#888'}}>No staff added yet</div></div>
  ) : (
  <div style={{overflowX:'auto'}}>
  <table style={s.table}>
  <thead>
  <tr style={{background:'#f8f9fa'}}>
  {['Name','Role','Speciality','Phone','Email','Status','Current Shift','Actions'].map(h=>(
  <th key={h} style={s.th}>{h}</th>
  ))}
  </tr>
  </thead>
  <tbody>
  {staff.map(u=>{
  const rc = ROLE_COLORS[u.role] || ROLE_COLORS.Receptionist
  const onShift = u.current_shift && !u.current_shift.toLowerCase().includes('off')
  return (
  <tr key={u.id} style={{borderBottom:'1px solid #f5f5f5'}}>
  <td style={s.td}><div style={{fontWeight:600,color:'#111'}}>{u.full_name}</div></td>
  <td style={s.td}><span style={{...s.pill,background:rc.bg,color:rc.color}}>{u.role||'—'}</span></td>
  <td style={s.td}>{u.speciality||'—'}</td>
  <td style={s.td}>{u.phone||'—'}</td>
  <td style={s.td}>{u.email||'—'}</td>
  <td style={s.td}>{u.status||'Active'}</td>
  <td style={s.td}>{u.current_shift||'Off Duty'}</td>
  <td style={s.td}>
  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
  {u.status === 'Pending Approval' ? (
  <>
  <button style={{...s.editBtn,background:'#E1F5EE',borderColor:'#B7E4C7',color:'#0F6E56'}} onClick={()=>handleUpdateUserStatus(u.id, 'Active')}>Approve</button>
  <button style={{...s.editBtn,color:'#A32D2D',borderColor:'#f5c6cb'}} onClick={()=>handleUpdateUserStatus(u.id, 'Rejected')}>Reject</button>
  </>
  ) : (
  <>
  <button style={s.editBtn} onClick={()=>openEdit(u)}>Edit</button>
  <button style={{...s.editBtn,color:'#A32D2D',borderColor:'#f5c6cb'}} onClick={()=>handleDeleteUser(u.id)}>🗑</button>
  </>
  )}
  <button style={{...s.editBtn,background:onShift?'#E1F5EE':'#f0f0f0',color:onShift?'#0F6E56':'#999'}}
  onClick={()=>handleUpdateUserShift(u.id, onShift ? 'Off Duty' : 'Day (07:00–19:00)')}>
  {onShift ? 'Set Off' : 'Set On Shift'}
  </button>
  </div>
  </td>
  </tr>
  )
  })}
  </tbody>
  </table>
  </div>
  )}
  </div>
  </div>
  )}

  {/* ══ INTEGRATIONS ══════════════════════════════════════════════ */}
  {activeTab==='departments' && (
  <div style={s.card}>
  <div style={{...s.cardHeader,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
  <div>
  <div>Hospital Departments</div>
  <div style={{fontSize:12,color:'#777',fontWeight:500,marginTop:4}}>
  Departments appear in the sidebar. Staff are assigned to departments in HR. Only admins can add or remove.
  </div>
  </div>
  <button style={s.addBtn} onClick={()=>openDepartmentModal()}>+ Add Department</button>
  </div>
  <div style={s.cardBody}>
  {departments.length===0 ? (
  <div style={s.empty}>
  <div style={{fontSize:40}}>🏥</div>
  <div style={{marginTop:8,color:'#888'}}>No departments added yet</div>
  <div style={{marginTop:6,fontSize:12,color:'#999'}}>Create your first department here and it will appear in the sidebar instantly.</div>
  </div>
  ) : (
  <div style={{display:'flex',flexDirection:'column',gap:12}}>
  {departments.map(department => {
  const badgeColor = DEPARTMENT_TYPE_COLORS[department.dept_type] || DEPARTMENT_TYPE_COLORS.admin
  const badgeBg = DEPARTMENT_TYPE_BACKGROUNDS[department.dept_type] || DEPARTMENT_TYPE_BACKGROUNDS.admin
  return (
  <div key={department.id || department.name} style={s.departmentRow}>
  <div style={s.departmentInfo}>
  <div style={s.departmentIcon}>{department.icon || '🏥'}</div>
  <div style={{minWidth:0}}>
  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
  <div style={s.departmentName}>{department.name}</div>
  <span style={{...s.pill,background:badgeBg,color:badgeColor}}>
  {DEPARTMENT_TYPE_LABELS[department.dept_type] || 'Department'}
  </span>
  {Number(department.bed_count || 0) > 0 && (
  <span style={{...s.pill,background:'#F3F4F6',color:'#4B5563'}}>
  {Number(department.bed_count)} bed{Number(department.bed_count) === 1 ? '' : 's'}
  </span>
  )}
  </div>
  <div style={s.departmentDescription}>
  {department.description || 'No description added yet.'}
  </div>
  </div>
  </div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
  <button style={s.editBtn} onClick={()=>openDepartmentModal(department)}>Edit</button>
  <button style={{...s.editBtn,color:'#A32D2D',borderColor:'#f5c6cb'}} onClick={()=>handleDeleteDepartment(department)}>Delete</button>
  </div>
  </div>
  )
  })}
  </div>
  )}
  </div>
  </div>
  )}

  {activeTab==='audit' && (
  <div style={s.card}>
   <div style={{...s.cardHeader,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
    <span>📝 Audit Log</span>
    <button style={s.addBtn} onClick={() => exportAuditCsv(auditEntries)} disabled={auditLoading || auditEntries.length === 0}>
     Export CSV
    </button>
   </div>
   <div style={{...s.cardBody, padding:'24px'}}>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:'12px',marginBottom:'18px'}}>
     <div>
      <label style={s.label}>Search actions / targets / details</label>
      <input style={s.input} placeholder="Search audit entries" value={auditSearch} onChange={e => handleAuditSearch(e.target.value)} />
     </div>
     <div>
      <label style={s.label}>Date range</label>
      <select style={s.input} value={auditDateRange} onChange={e => handleAuditRange(e.target.value)}>
       <option value="7d">Last 7 days</option>
       <option value="30d">Last 30 days</option>
       <option value="90d">Last 90 days</option>
       <option value="all">All time</option>
      </select>
     </div>
     <div style={{display:'flex',alignItems:'flex-end'}}>
      <div style={{fontSize:12,color:'#555'}}>Showing {auditEntries.length} of {auditTotal || 0} audit event{auditTotal===1?'':'s'}.</div>
     </div>
    </div>
    <div style={{marginBottom:14,display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
     <div style={{padding:'10px 14px',borderRadius:10,background:'#F8FAFC',border:'1px solid #E2E8F0',color:'#0F6E99',fontSize:12}}>
      Audit log records are only visible to administrators. Events include staff, settings, department and workflow changes.
     </div>
    </div>
    <div style={{overflowX:'auto'}}>
     <table style={s.table}>
      <thead>
       <tr style={{background:'#fafafa'}}>
        {['Timestamp','User Role','Action','Target','Target ID','Details',''].map(h=> <th key={h} style={s.th}>{h}</th>)}
       </tr>
      </thead>
      <tbody>
       {auditLoading && (
        <tr><td colSpan={7} style={{...s.td,textAlign:'center',padding:'24px',color:'#888'}}>Loading audit entries…</td></tr>
       )}
       {!auditLoading && auditEntries.length === 0 && (
        <tr><td colSpan={7} style={{...s.td,textAlign:'center',padding:'24px',color:'#888'}}>No audit entries available for this range.</td></tr>
       )}
       {auditEntries.map(entry => {
        const detailsText = entry.details ? (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)) : ''
        const preview = detailsText.length > 90 ? `${detailsText.slice(0,90)}…` : detailsText
        const expanded = auditSelectedId === entry.id
        return (
         <Fragment key={entry.id}>
          <tr style={{background: expanded ? '#F8FAFC' : undefined}}>
           <td style={s.td}>{entry.performed_at ? new Date(entry.performed_at).toLocaleString('en-KE') : '—'}</td>
           <td style={s.td}>{entry.user_role || '—'}</td>
           <td style={s.td}>{entry.action || '—'}</td>
           <td style={s.td}>{entry.target_table || '—'}</td>
           <td style={s.td}>{entry.target_id || '—'}</td>
           <td style={{...s.td,fontSize:12,color:'#444',maxWidth:260,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={detailsText}>{preview || '—'}</td>
           <td style={s.td}>
            <button style={{...s.editBtn,fontSize:11,padding:'6px 10px'}} onClick={() => setAuditSelectedId(expanded ? null : entry.id)}>
             {expanded ? 'Hide' : 'View'}
            </button>
           </td>
          </tr>
          {expanded && (
           <tr key={`${entry.id}-details`}>
            <td colSpan={7} style={{...s.td,background:'#f9fafb',fontSize:12,color:'#333',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
             {detailsText}
            </td>
           </tr>
          )}
         </Fragment>
        )
       })}
      </tbody>
     </table>
    </div>
    <div style={{marginTop:14,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
     <div style={{fontSize:12,color:'#555'}}>Page {auditPage} / {Math.max(1, Math.ceil((auditTotal || 0) / auditPageSize))}</div>
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button style={{...s.btn,...s.btnGhost,padding:'8px 12px'}} disabled={auditPage <= 1 || auditLoading} onClick={() => handleAuditPageChange(auditPage - 1)}>Previous</button>
      <button style={{...s.btn,...s.btnGhost,padding:'8px 12px'}} disabled={auditPage >= Math.ceil((auditTotal || 0) / auditPageSize) || auditLoading} onClick={() => handleAuditPageChange(auditPage + 1)}>Next</button>
     </div>
    </div>
   </div>
  </div>
  )}

  {activeTab==='integrations' && (
  <div style={s.card}>
  <div style={s.cardHeader}>🔗 Integrations</div>
  <div style={s.cardBody}>
  <div style={{background:'#E3F0FB',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:13,color:'#1a6fb5'}}>
  ℹ Toggle an integration ON then click <strong>⚙ Configure</strong> to enter API keys and credentials. Changes are saved when you click <strong>Save Changes</strong>.
  </div>
  <div style={{display:'flex',flexDirection:'column',gap:0}}>
  {INTEGRATION_DEFS.map((intg,i)=>{
  const isOn = integrations[intg.key]
  const hasConfig = intg.fields.some(f => intgConfig[f.key])
  return (
  <div key={intg.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
  padding:'16px 4px', borderBottom:i<INTEGRATION_DEFS.length-1?'1px solid #f0f0f0':'none',gap:12}}>
  <div style={{flex:1}}>
  <div style={{display:'flex',alignItems:'center',gap:8}}>
  <span style={{fontSize:20}}>{intg.icon}</span>
  <div>
  <div style={{fontWeight:600,fontSize:14,color:'#111'}}>{intg.label}</div>
  <div style={{fontSize:12,color:'#888',marginTop:2}}>{intg.desc}</div>
  </div>
  </div>
  </div>
  <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
  {isOn && (
  <span style={{fontSize:11,fontWeight:600,padding:'3px 8px',borderRadius:99,
  background:hasConfig?'#E1F5EE':'#FFF3DC',color:hasConfig?'#0F6E56':'#C07000'}}>
  {hasConfig?' Configured':' Needs Config'}
  </span>
  )}
  {isOn && (
  <button style={s.configBtn} onClick={()=>setConfigModal(intg)}>⚙ Configure</button>
  )}
  <div style={{width:46,height:26,borderRadius:99,cursor:'pointer',transition:'background .2s',
  background:isOn?'#0F6E56':'#ddd',position:'relative',flexShrink:0}}
  onClick={()=>setIntegrations(prev=>({...prev,[intg.key]:!prev[intg.key]}))}>
  <div style={{position:'absolute',top:3,left:isOn?23:3,width:20,height:20,borderRadius:'50%',
  background:'#fff',transition:'left .2s',boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
  </div>
  </div>
  </div>
  )
  })}
  </div>
  </div>
  </div>
  )}

  {/* ══ SYSTEM SETTINGS ══════════════════════════════════════════ */}
  {activeTab==='system' && (
  <div style={s.card}>
  <div style={s.cardHeader}>⚙ System Settings</div>
  <div style={s.cardBody}>
  <div style={s.grid2}>
  <Fld label="Low Stock Threshold (units)">
  <input style={s.input} type="number" min={1} value={sysSettings.low_stock_threshold}
  onChange={e=>setSysSettings({...sysSettings,low_stock_threshold:parseInt(e.target.value)||20})}/>
  <div style={s.hint}>Alert when drug stock falls below this number</div>
  </Fld>
  <Fld label="Expiry Warning (days ahead)">
  <input style={s.input} type="number" min={1} value={sysSettings.expiry_warning_days}
  onChange={e=>setSysSettings({...sysSettings,expiry_warning_days:parseInt(e.target.value)||90})}/>
  <div style={s.hint}>Alert when drugs expire within this many days</div>
  </Fld>
  <Fld label="Default Currency">
  <select style={s.input} value={sysSettings.currency}
  onChange={e=>setSysSettings({...sysSettings,currency:e.target.value})}>
  {CURRENCIES.map(c=><option key={c}>{c}</option>)}
  </select>
  </Fld>
  <Fld label="Admin Settings PIN">
  <div style={{ position:'relative' }}>
  <input style={s.input} type={showAdminPin ? 'text' : 'password'} maxLength={6} value={sysSettings.admin_pin}
  onChange={e=>setSysSettings({...sysSettings,admin_pin:e.target.value})}
  placeholder="Set a unique 4–6 digit PIN for this hospital"/>
  <button type="button" style={s.eyeBtn} onClick={() => setShowAdminPin(v => !v)}>
  {showAdminPin ? 'Hide' : 'Show'}
  </button>
  </div>
  <div style={s.hint}>{sysSettings.admin_pin ? 'Anyone who knows this PIN can access Staff, Integrations & System tabs — keep it confidential within your hospital.' : 'No PIN set yet — set a unique PIN so only authorised staff can access Staff, Integrations & System settings.'}</div>
  <div style={{ ...s.hint, marginTop: 4, color: '#555' }}>
  If you forget this PIN, an Admin user can log in and set a new one here in System Settings.
  </div>
  </Fld>
  </div>
  <div style={{marginTop:8}}>
  <div style={s.sectionLabel}>Automated Reports</div>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 0',borderBottom:'1px solid #f0f0f0'}}>
  <div>
  <div style={{fontWeight:600,fontSize:14,color:'#111'}}>Auto Morning Report</div>
  <div style={{fontSize:12,color:'#888',marginTop:3}}>Daily summary at 07:00 Mon–Sat</div>
  </div>
  <div style={{width:46,height:26,borderRadius:99,cursor:'pointer',transition:'background .2s',
  background:sysSettings.auto_morning_report?'#0F6E56':'#ddd',position:'relative',flexShrink:0}}
  onClick={()=>setSysSettings(p=>({...p,auto_morning_report:!p.auto_morning_report}))}>
  <div style={{position:'absolute',top:3,left:sysSettings.auto_morning_report?23:3,
  width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .2s',
  boxShadow:'0 1px 4px rgba(0,0,0,.2)'}}/>
  </div>
  </div>
  </div>
  <div style={{marginTop:28,padding:'18px',background:'#fff8f8',border:'1px solid #f5c6cb',borderRadius:12}}>
  <div style={{fontSize:13,fontWeight:700,color:'#A32D2D',marginBottom:8,textTransform:'uppercase',letterSpacing:.6}}> Danger Zone</div>
  <div style={{fontSize:13,color:'#555',marginBottom:14}}>These actions are irreversible. Proceed with extreme caution.</div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
  <button style={s.dangerBtn} onClick={()=>window.notifyFromLegacyAlert('Contact support to reset test data.')} disabled={!isAdmin}>🗑 Clear Test Data</button>
  <button style={s.dangerBtn} onClick={()=>window.notifyFromLegacyAlert('Contact support to export full database backup.')} disabled={!isAdmin}>📦 Export Full Backup</button>
  </div>
  </div>
  </div>
  </div>
  )}
  </div>

  {/* ══ PIN MODAL ═════════════════════════════════════════════════ */}
  {showDepartmentModal && (
  <div style={s.overlay} onClick={()=>setShowDepartmentModal(false)}>
  <div style={{...s.modal,maxWidth:640}} onClick={e=>e.stopPropagation()}>
  <div style={s.modalHeader}>
  <h2 style={s.modalTitle}>{editDepartment?' Edit Department':'+ Add Department'}</h2>
  <button style={s.closeBtn} onClick={()=>setShowDepartmentModal(false)}></button>
  </div>
  <div style={s.modalBody}>
  <div style={s.grid2}>
  <Fld label="Department Name *">
  <input
  style={s.input}
  list="department-name-suggestions"
  value={departmentForm.name}
  onChange={e=>handleDepartmentFieldChange('name', e.target.value)}
  placeholder="e.g. Maternity"
  />
  <datalist id="department-name-suggestions">
  {standardDepartmentNames.map(name => <option key={name} value={name} />)}
  </datalist>
  <div style={s.hint}>Pick a standard name or type your own custom department.</div>
  </Fld>
  <Fld label="Type">
  <select style={s.input} value={departmentForm.dept_type} onChange={e=>handleDepartmentFieldChange('dept_type', e.target.value)}>
  {DEPARTMENT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
  </Fld>
  <Fld label="Icon">
  <input style={s.input} value={departmentForm.icon} onChange={e=>handleDepartmentFieldChange('icon', e.target.value)} placeholder="e.g. 🏥" />
  </Fld>
  <Fld label="Bed Count">
  <input style={s.input} type="number" min={0} value={departmentForm.bed_count} onChange={e=>handleDepartmentFieldChange('bed_count', e.target.value)} placeholder="0" />
  <div style={s.hint}>Use 0 if this department has no beds.</div>
  </Fld>
  </div>
  <Fld label="Description">
  <textarea style={{...s.input,height:84,resize:'vertical'}} value={departmentForm.description} onChange={e=>handleDepartmentFieldChange('description', e.target.value)} placeholder="Optional department summary" />
  </Fld>
  <div style={{marginTop:10}}>
  <div style={s.sectionLabel}>Department Capabilities</div>
  <div style={s.checkboxGrid}>
  <label style={s.checkboxCard}>
  <input type="checkbox" checked={departmentForm.can_refer} onChange={e=>handleDepartmentFieldChange('can_refer', e.target.checked)} />
  <span>Can Refer?</span>
  </label>
  <label style={s.checkboxCard}>
  <input type="checkbox" checked={departmentForm.can_order_lab} onChange={e=>handleDepartmentFieldChange('can_order_lab', e.target.checked)} />
  <span>Can Order Lab?</span>
  </label>
  <label style={s.checkboxCard}>
  <input type="checkbox" checked={departmentForm.can_prescribe} onChange={e=>handleDepartmentFieldChange('can_prescribe', e.target.checked)} />
  <span>Can Prescribe?</span>
  </label>
  </div>
  </div>
  </div>
  <div style={s.modalFooter}>
  <button style={s.cancelBtn} onClick={()=>setShowDepartmentModal(false)}>Cancel</button>
  <button style={s.submitBtn} onClick={handleSaveDepartment} disabled={savingDepartment}>
  {savingDepartment?'Saving...':'Save Department'}
  </button>
  </div>
  </div>
  </div>
  )}

  {showPinModal && (
  <div style={s.overlay} onClick={()=>setShowPinModal(false)}>
  <div style={{...s.modal,maxWidth:380}} onClick={e=>e.stopPropagation()}>
  <div style={s.modalHeader}>
  <h2 style={s.modalTitle}>🔒 Protected Section</h2>
  <button style={s.closeBtn} onClick={()=>setShowPinModal(false)}></button>
  </div>
  <div style={s.modalBody}>
  <div style={{textAlign:'center',padding:'10px 0 20px'}}>
  <div style={{fontSize:48,marginBottom:12}}>🔐</div>
  <div style={{fontSize:14,color:'#555',marginBottom:20}}>
  This section requires your hospital's settings PIN.<br/>
  Enter the PIN set for <strong>{profile.name || 'this hospital'}</strong> to continue.
  </div>
  <input
  style={{...s.input,textAlign:'center',fontSize:24,letterSpacing:8,maxWidth:200,margin:'0 auto'}}
  type="password" maxLength={6} value={pinInput}
  onChange={e=>{ setPinInput(e.target.value); setPinError('') }}
  onKeyDown={e=>e.key==='Enter'&&handlePinSubmit()}
  placeholder="••••"
  autoFocus
  />
  {pinError && (
  <div style={{color:'#A32D2D',fontSize:13,marginTop:10,fontWeight:600,animation:'shake .4s ease'}}>
  ❌ {pinError}
  </div>
  )}
  </div>
  </div>
  <div style={s.modalFooter}>
  <button style={s.cancelBtn} onClick={()=>setShowPinModal(false)}>Cancel</button>
  <button style={s.submitBtn} onClick={handlePinSubmit}>🔓 Unlock</button>
  </div>
  </div>
  </div>
  )}

  {/* ══ INTEGRATION CONFIG MODAL ══════════════════════════════════ */}
  {configModal && (
  <div style={s.overlay} onClick={()=>setConfigModal(null)}>
  <div style={{...s.modal,maxWidth:480}} onClick={e=>e.stopPropagation()}>
  <div style={s.modalHeader}>
  <h2 style={s.modalTitle}>{configModal.icon} Configure {configModal.label}</h2>
  <button style={s.closeBtn} onClick={()=>setConfigModal(null)}></button>
  </div>
  <div style={s.modalBody}>
  <div style={{background:'#FFF3DC',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#C07000',marginBottom:16}}>
  🔑 These credentials are stored encrypted in your hospital settings. Never share them with unauthorized staff.
  </div>
  {configModal.fields.map(f=>(
  <Fld key={f.key} label={f.label}>
  {f.type==='select' ? (
  <select style={s.input} value={intgConfig[f.key]||''}
  onChange={e=>setIntgConfig(prev=>({...prev,[f.key]:e.target.value}))}>
  <option value="">-- Select --</option>
  {f.options.map(o=><option key={o}>{o}</option>)}
  </select>
  ) : (
  <input style={s.input} type={f.type||'text'} placeholder={f.placeholder}
  value={intgConfig[f.key]||''}
  onChange={e=>setIntgConfig(prev=>({...prev,[f.key]:e.target.value}))}/>
  )}
  </Fld>
  ))}
  </div>
  <div style={s.modalFooter}>
  <button style={s.cancelBtn} onClick={()=>setConfigModal(null)}>Cancel</button>
  <button style={s.submitBtn} onClick={()=>setConfigModal(null)}> Save Config</button>
  </div>
  </div>
  </div>
  )}

  {/* ══ ADD / EDIT STAFF MODAL ════════════════════════════════════ */}
  {showAddUser && (
  <div style={s.overlay} onClick={()=>setShowAddUser(false)}>
  <div style={{...s.modal,maxWidth:500}} onClick={e=>e.stopPropagation()}>
  <div style={s.modalHeader}>
  <h2 style={s.modalTitle}>{editUser?' Edit Staff Member':'+ Add Staff Member'}</h2>
  <button style={s.closeBtn} onClick={()=>setShowAddUser(false)}></button>
  </div>
  <div style={s.modalBody}>
  <div style={s.grid2}>
  <Fld label="Full Name *">
  <input style={s.input} value={userForm.full_name} onChange={e=>setUserForm({...userForm,full_name:e.target.value})} placeholder="Dr. John Kamau"/>
  </Fld>
  <Fld label="Role *">
  <select style={s.input} value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}>
  {ROLES.map(r=><option key={r}>{r}</option>)}
  </select>
  </Fld>
  <Fld label="Email">
  <input style={s.input} type="email" value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})} placeholder="doctor@hospital.co.ke"/>
  </Fld>
  <Fld label="Phone">
  <input style={s.input} value={userForm.phone} onChange={e=>setUserForm({...userForm,phone:e.target.value})} placeholder="0712 345 678"/>
  </Fld>
  <Fld label="Status">
  <select style={s.input} value={userForm.status} onChange={e=>setUserForm({...userForm,status:e.target.value})}>
  {STAFF_STATUS_OPTIONS.map(st => <option key={st}>{st}</option>)}
  </select>
  </Fld>
  </div>
  <Fld label="Speciality (for doctors)">
  <input style={s.input} value={userForm.speciality} onChange={e=>setUserForm({...userForm,speciality:e.target.value})} placeholder="e.g. General Medicine, Paediatrics"/>
  </Fld>
  </div>
  <div style={s.modalFooter}>
  <button style={s.cancelBtn} onClick={()=>setShowAddUser(false)}>Cancel</button>
  <button style={s.submitBtn} onClick={handleSaveUser} disabled={savingUser}>
  {savingUser?'Saving...':editUser?' Update':'+ Add Staff'}
  </button>
  </div>
  </div>
  </div>
  )}
  </div>
 )
}

function Fld({ label, children }) {
 return (
  <div style={{ marginBottom: 14 }}>
  <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</label>
  {children}
  </div>
 )
}

const s = {
 page: { padding:'20px 24px', flex:1, overflowY:'auto', background:'#f7f8f7', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', minHeight:'100vh', boxSizing:'border-box' },
 loadWrap: { height:'80vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' },
 spinner: { width:36, height:36, border:'3px solid #e8ebe8', borderTop:'3px solid #0F6E56', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:10 },
 title: { fontSize:26, fontWeight:800, margin:0, color:'#111' },
 subtitle: { color:'#777', margin:'4px 0 0', fontSize:13, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' },
 saveBtn: { background:'#0F6E56', color:'#fff', border:'none', padding:'11px 24px', borderRadius:8, fontWeight:700, cursor:'pointer', fontSize:14, transition:'background .2s' },
 tabRow: { display:'flex', gap:6, marginBottom:20, flexWrap:'wrap', background:'#fff', padding:'10px 12px', borderRadius:12, border:'1px solid #eee' },
 tab: { padding:'8px 16px', border:'1px solid transparent', borderRadius:8, background:'none', cursor:'pointer', fontSize:13, color:'#555', fontWeight:500, transition:'all .15s' },
 tabActive: { background:'#0F6E56', color:'#fff', fontWeight:600 },
 card: { background:'#fff', borderRadius:14, border:'1px solid #eee', overflow:'hidden', marginBottom:20, boxShadow:'0 2px 8px rgba(0,0,0,.04)' },
 cardHeader: { padding:'16px 24px', fontWeight:700, fontSize:15, color:'#111', borderBottom:'1px solid #f0f0f0', background:'#fafafa' },
 cardBody: { padding:'20px 24px' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:4 },
 grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 },
 infoCard: { border:'1px solid #eee', borderRadius:10, padding:'14px 16px', background:'#fafafa' },
 infoTitle: { fontSize:13, fontWeight:700, color:'#111' },
 input: { width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box', background:'#fff', color:'#111', fontFamily:'inherit' },
 sectionLabel:{ fontSize:11, fontWeight:700, color:'#0F6E56', textTransform:'uppercase', letterSpacing:.8, marginBottom:12, paddingBottom:6, borderBottom:'1px solid #E1F5EE' },
 hint: { fontSize:11, color:'#aaa', marginTop:4 },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { fontSize:11, color:'#888', fontWeight:600, textAlign:'left', padding:'10px 14px', borderBottom:'2px solid #f0f0f0', textTransform:'uppercase', letterSpacing:.4, whiteSpace:'nowrap' },
 td: { fontSize:13, color:'#333', padding:'11px 14px', verticalAlign:'middle' },
 pill: { fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:99, display:'inline-block' },
 editBtn: { fontSize:12, padding:'5px 10px', border:'1px solid #ddd', borderRadius:6, background:'#fff', cursor:'pointer', color:'#555' },
 addBtn: { background:'#0F6E56', color:'#fff', border:'none', padding:'8px 16px', borderRadius:8, fontWeight:600, cursor:'pointer', fontSize:13 },
 configBtn: { fontSize:12, padding:'6px 12px', border:'1px solid #ddd', borderRadius:6, background:'#fff', cursor:'pointer', color:'#555', fontWeight:500 },
 empty: { textAlign:'center', padding:'40px 20px', color:'#bbb' },
 departmentRow: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, border:'1px solid #eee', borderRadius:12, padding:'14px 16px', background:'#fafafa', flexWrap:'wrap' },
 departmentInfo: { display:'flex', alignItems:'center', gap:12, minWidth:0, flex:1 },
 departmentIcon: { width:42, height:42, borderRadius:12, background:'#fff', border:'1px solid #eee', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 },
 departmentName: { fontSize:14, fontWeight:700, color:'#111' },
 departmentDescription: { fontSize:12, color:'#777', marginTop:4, lineHeight:1.5, wordBreak:'break-word' },
 checkboxGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10 },
 checkboxCard: { display:'flex', alignItems:'center', gap:8, border:'1px solid #e5e7eb', borderRadius:10, padding:'10px 12px', background:'#fff', fontSize:13, color:'#333', cursor:'pointer' },
 dangerBtn: { padding:'9px 16px', border:'1px solid #f5c6cb', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:13, color:'#A32D2D', fontWeight:500 },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
 modal: { background:'#fff', borderRadius:16, width:'100%', maxWidth:700, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.2)', animation:'fadeIn .2s ease' },
 modalHeader:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px', borderBottom:'1px solid #f0f0f0' },
 modalTitle: { fontSize:17, fontWeight:700, margin:0, color:'#111' },
 closeBtn: { background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#888' },
 modalBody: { padding:'20px 24px', overflowY:'auto', flex:1 },
 modalFooter:{ padding:'14px 24px', borderTop:'1px solid #f0f0f0', display:'flex', justifyContent:'flex-end', gap:10 },
 cancelBtn: { padding:'10px 20px', border:'1px solid #ddd', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:13, fontWeight:500, color:'#555' },
 submitBtn: { padding:'10px 24px', border:'none', borderRadius:8, background:'#0F6E56', color:'#fff', cursor:'pointer', fontSize:13, fontWeight:600 },
 eyeBtn: { position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', border:'none', background:'transparent', color:'#0F6E56', cursor:'pointer', fontSize:12, fontWeight:700, padding:'0 6px' },
}
