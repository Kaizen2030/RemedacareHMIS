import { useEffect, useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { colors as C, typography } from '../theme'
import Payroll from './Payroll'
import { canAccessPayroll, resolveRole } from '../access'
import { HrLicences, HrRoster, LeaveBalances, LeaveStatusCell } from './hr/HrExtras'
import { notifyError, notifyFromLegacyAlert, notifyInfo, notifyWarning } from '../notifications'
import { canonicalDepartmentName, findExistingDepartment } from '../utils/departmentNames'

/* ══════════════════════════════════════════════════════════════════
 DESIGN TOKENS — matches Remedacare system-wide palette
══════════════════════════════════════════════════════════════════ */
const css = {
 page: { minHeight:'100vh', background:C.bg, fontFamily:typography.fontFamily, fontSize:'13px', color:C.text },
 wrap: { padding:'20px 24px', maxWidth:'1500px', margin:'0 auto' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' },
 h1: { fontSize:'18px', fontWeight:700, margin:0 },
 subtext: { fontSize:'12px', color:C.sub, marginBottom:'18px' },
 statsRow: { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'20px' },
 stat: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px 16px' },
 statLbl: { fontSize:'11px', color:C.sub, fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px' },
 statVal: { fontSize:'22px', fontWeight:800, letterSpacing:'-0.5px' },
 statSub: { fontSize:'11px', color:C.muted, marginTop:'3px' },
 tabRow: { display:'flex', gap:'4px', marginBottom:'16px', background:C.surface, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'5px', flexWrap:'wrap' },
 tab: { padding:'7px 16px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:500, color:C.sub, background:'none', whiteSpace:'nowrap' },
 tabActive: { background:C.primary, color:'#fff', fontWeight:600 },
 toolbar: { display:'flex', gap:'8px', marginBottom:'14px', alignItems:'center', flexWrap:'wrap' },
 searchWrap: { position:'relative', flex:1, minWidth:'200px' },
 searchIcon: { position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:C.muted, fontSize:'13px' },
 searchInp: { width:'100%', boxSizing:'border-box', padding:'8px 10px 8px 30px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', outline:'none', background:C.surface },
 select: { padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'12px', background:C.surface, color:C.text, outline:'none', cursor:'pointer' },
 btn: { padding:'8px 14px', borderRadius:'7px', border:'none', cursor:'pointer', fontWeight:600, fontSize:'12px', whiteSpace:'nowrap' },
 btnPri: { background:C.primary, color:'#fff' },
 btnGhost: { background:C.surface, border:`1px solid ${C.border}`, color:C.text },
 btnBlue: { background:C.blueL, color:C.blue, border:'none' },
 btnDng: { background:C.dangerL, color:C.danger, border:'none' },
 card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', overflow:'hidden', marginBottom:'16px' },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { padding:'9px 14px', textAlign:'left', fontSize:'11px', fontWeight:700, color:C.sub, textTransform:'uppercase', letterSpacing:'.5px', borderBottom:`2px solid ${C.border}`, background:'#FAFBFD', whiteSpace:'nowrap' },
 td: { padding:'11px 14px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', verticalAlign:'middle' },
 badge: { display:'inline-block', padding:'2px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' },
 modal: { background:C.surface, borderRadius:'12px', width:'680px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'94vh', display:'flex', flexDirection:'column' },
 modalH: { fontSize:'15px', fontWeight:700, color:C.text },
 lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
 input: { width:'100%', boxSizing:'border-box', padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'10px' },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' },
 sectionHd: { fontSize:'11px', fontWeight:700, color:C.primary, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:'12px', paddingBottom:'6px', borderBottom:`1px solid ${C.primaryL}` },
 deptCard: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px 16px', cursor:'pointer', transition:'transform .15s ease, border-color .15s ease' },
}

export const DEPARTMENTS = []

const ROLE_CATEGORIES = {
 'Doctors & Clinical Officers': [
 'General Practitioner (GP)', 'Medical Officer', 'Senior Medical Officer',
 'Clinical Officer', 'Senior Clinical Officer', 'Medical Superintendent',
 'Physician / Internist', 'Surgeon (General)', 'Obstetrician & Gynaecologist',
 'Paediatrician', 'Orthopaedic Surgeon', 'Cardiothoracic Surgeon', 'Neurosurgeon',
 'Cardiologist', 'Neurologist', 'Psychiatrist', 'Dermatologist', 'Ophthalmologist',
 'ENT Specialist', 'Oncologist', 'Urologist', 'Anaesthesiologist', 'Radiologist',
 'Pathologist', 'Emergency Medicine Physician', 'Nephrologist', 'Gastroenterologist',
 'Pulmonologist / Chest Physician', 'Endocrinologist', 'Haematologist',
 'Rheumatologist', 'Neonatologist', 'Dental Officer', 'Consultant Physician',
 ],
 'Nursing': [
 'Chief Nursing Officer (CNO)', 'Matron', 'Nurse Manager',
 'Senior Nursing Officer', 'Nursing Officer I', 'Nursing Officer II', 'Nursing Officer III',
 'Registered Nurse (RN)', 'Enrolled Nurse (EN)',
 'ICU / Critical Care Nurse', 'Theatre Nurse (Scrub / Scout)',
 'Midwife', 'Paediatric Nurse', 'Psychiatric / Mental Health Nurse',
 'Oncology Nurse', 'Renal / Dialysis Nurse', 'Infection Control Nurse',
 'Nurse Anaesthetist (CRNA)', 'Community Health Nurse', 'Palliative Care Nurse',
 ],
 'Pharmacy': [
 'Chief Pharmacist', 'Senior Pharmacist', 'Pharmacist', 'Clinical Pharmacist',
 'Senior PharmTech', 'Pharmaceutical Technologist (PharmTech)',
 'Pharmacy Assistant', 'Pharmacy Intern', 'Pharmacy Aide',
 ],
 'Laboratory': [
 'Chief Medical Laboratory Scientist', 'Medical Laboratory Scientist (MLS)',
 'Senior Medical Laboratory Technologist', 'Medical Laboratory Technologist',
 'Medical Laboratory Technician', 'Phlebotomist', 'Histopathology Technician',
 'Cytology Technician', 'Blood Bank Technician', 'Microbiology Technician',
 'Lab Quality Assurance Officer', 'Lab Aide',
 ],
 'Allied Health': [
 'Radiographer', 'Senior Radiographer', 'Sonographer', 'CT / MRI Technologist',
 'Physiotherapist', 'Senior Physiotherapist', 'Occupational Therapist',
 'Speech & Language Therapist', 'Dietitian / Nutritionist', 'Medical Social Worker',
 'Counsellor / Psychologist', 'Orthotist / Prosthetist', 'Audiologist', 'Optometrist',
 'Dental Technician', 'Dental Nurse', 'Biomedical Engineer', 'Biomedical Technician',
 'Health Records & Information Officer', 'Community Health Worker (CHW)',
 'Community Health Extension Worker (CHEW)', 'Public Health Officer',
 ],
 'Administration': [
 'Hospital Director / CEO', 'Deputy Director', 'Medical Director',
 'Hospital Administrator', 'Operations Manager', 'Quality Assurance Manager',
 'HR Manager', 'HR Officer', 'Finance Manager', 'Accountant', 'Accounts Clerk',
 'Internal Auditor', 'Cashier', 'Receptionist / Front Desk', 'Customer Care Officer',
 'Procurement Officer', 'Stores / Inventory Officer', 'Marketing Officer',
 'Legal Officer', 'Compliance Officer', 'Ward Clerk', 'Data Analyst',
 ],
 'IT & Systems': [
 'IT Manager', 'Systems Administrator', 'IT Support Officer',
 'Database Administrator', 'Network Engineer', 'Health Informatics Officer',
 'CCTV / Security Systems Operator',
 ],
 'Support Services': [
 'Security Manager', 'Senior Security Guard', 'Security Guard', 'Watchman',
 'Driver', 'Ambulance Driver',
 'Senior Cook', 'Cook', 'Kitchen Assistant', 'Food Service Aide',
 'Head Cleaner / Housekeeper', 'Cleaner / Housekeeper', 'Laundry Attendant',
 'Orderly / Porter', 'Mortuary Attendant', 'Embalmer', 'Gardener / Groundsman',
 'Maintenance Supervisor', 'Maintenance Technician', 'Plumber', 'Electrician',
 'Carpenter', 'Generator / HVAC Technician', 'Sterilization Technician (CSSD)',
 'Waste Management Officer',
 ],
}

const REG_BODIES = {
 'Doctors & Clinical Officers': { code:'KMPDC', full:'Kenya Medical Practitioners & Dentists Council' },
 'Nursing': { code:'NCK', full:'Nursing Council of Kenya' },
 'Pharmacy': { code:'PPB', full:'Pharmacy & Poisons Board' },
 'Laboratory': { code:'KMLTTB', full:'Kenya Medical Laboratory Technicians & Technologists Board' },
 'Allied Health': { code:'Various', full:'Varies by discipline (e.g. KPA, KNDI, KSSB)' },
}

const STAFF_TEMPLATES = {
 'Outpatient (OPD)': [
 { name:'Dr. Mercy Wanjiku', role:'General Practitioner (GP)' },
 { name:'Dr. Alex Njoroge', role:'General Practitioner (GP)' },
 { name:'Esther Wambui', role:'Registered Nurse (RN)' },
 { name:'Samuel Maina', role:'Registered Nurse (RN)' },
 { name:'John Kamau', role:'Clinical Officer' },
 { name:'Peter Otieno', role:'Receptionist / Front Desk' },
 ],
 'Emergency & Casualty': [
 { name:'Dr. Esther Mutua', role:'Emergency Medicine Physician' },
 { name:'Grace Njeri', role:'Senior Nursing Officer' },
 { name:'Alice Chebet', role:'Nursing Officer I' },
 { name:'Paul Kiptoo', role:'Clinical Officer' },
 { name:'David Mwangi', role:'Ambulance Driver' },
 ],
 'Inpatient — Medical Ward': [
 { name:'Dr. Samuel Kimani', role:'Medical Officer' },
 { name:'Nancy Achieng', role:'Nursing Officer II' },
 { name:'Lilian Mwende', role:'Nursing Officer II' },
 { name:'Mercy Wanjiru', role:'Ward Clerk' },
 { name:'James Ouma', role:'Cleaner' },
 ],
 'Inpatient — Surgical Ward': [
 { name:'Dr. Faith Ouma', role:'Medical Officer' },
 { name:'Catherine Kipruto', role:'Nursing Officer II' },
 { name:'Ruth Atieno', role:'Nursing Officer II' },
 { name:'Peter Musyoka', role:'Ward Clerk' },
 { name:'Simon Ndegwa', role:'Cleaner' },
 ],
 'Inpatient — Paediatric Ward': [
 { name:'Dr. Mary Wanjiru', role:'Medical Officer' },
 { name:'Anne Chebet', role:'Paediatric Nurse' },
 { name:'Mercy Mutiso', role:'Paediatric Nurse' },
 { name:'Grace Mburu', role:'Ward Clerk' },
 { name:'Kennedy Kiptoo', role:'Cleaner' },
 ],
 'Maternity & Labour Ward': [
 { name:'Dr. Grace Mwende', role:'Obstetrician & Gynaecologist' },
 { name:'Jane Akinyi', role:'Midwife' },
 { name:'Beatrice Chepngeno', role:'Midwife' },
 { name:'Esther Muthoni', role:'Nursing Officer I' },
 ],
 'Pharmacy': [
 { name:'Ann Njeri', role:'Pharmacist' },
 { name:'Brian Kiptoo', role:'Pharmaceutical Technologist (PharmTech)' },
 { name:'Esther Achieng', role:'Pharmacy Assistant' },
 ],
 'Laboratory': [
 { name:'David Ochieng', role:'Medical Laboratory Technologist' },
 { name:'Grace Wambui', role:'Phlebotomist' },
 { name:'Peter Ndegwa', role:'Medical Laboratory Technician' },
 ],
 'IT & Systems': [
 { name:'Kevin Otieno', role:'IT Support Officer' },
 ],
 'Administration': [
 { name:'Mary Kamau', role:'Hospital Administrator' },
 { name:'Jane Wanjiru', role:'HR Officer' },
 { name:'Peter Kiplagat', role:'Accountant' },
 ],
 'Support Services': [
 { name:'James Mwangi', role:'Cleaner' },
 { name:'Violet Chebet', role:'Cleaner' },
 { name:'John Ouma', role:'Security Guard' },
 { name:'Henry Karanja', role:'Driver' },
 ],
 'Community Health': [
 { name:'Grace Ombogo', role:'Community Health Nurse' },
 { name:'David Otieno', role:'Public Health Officer' },
 { name:'Faith Mwikali', role:'Community Health Worker (CHW)' },
 ],
 'Cardiology': [
 { name:'Dr. Peter Kiprop', role:'Cardiologist' },
 { name:'Dr. Susan Wanjiku', role:'Cardiologist' },
 { name:'Nancy Kipruto', role:'Cardiac Nurse' },
 { name:'James Mutua', role:'Cardiac Technician' },
 ],
 'Maintenance & Engineering': [
 { name:'Peter Njoroge', role:'Maintenance Supervisor' },
 { name:'Samuel Kariuki', role:'Electrician' },
 { name:'Joseph Kamau', role:'Plumber' },
 ],
 'Human Resources': [
 { name:'Wanjiru Nyambura', role:'HR Manager' },
 { name:'Esther Kiptoo', role:'HR Officer' },
 { name:'Jane Wambui', role:'Payroll Clerk' },
 ],
 'Medical Records': [
 { name:'Alice Wairimu', role:'Health Records Officer' },
 { name:'Christine Njeri', role:'Medical Records Clerk' },
 ],
 'Security': [
 { name:'John Mwangi', role:'Security Manager' },
 { name:'Michael Muturi', role:'Security Guard' },
 ],
 'Kitchen & Catering': [
 { name:'Mary Achieng', role:'Senior Cook' },
 { name:'Alice Njeri', role:'Kitchen Assistant' },
 { name:'Peter Otieno', role:'Food Service Aide' },
 ],
 'Mental Health & Psychiatry': [
 { name:'Dr. Susan Wanjiru', role:'Psychiatrist' },
 { name:'James Otieno', role:'Psychiatric Nurse' },
 { name:'Lilian Mwende', role:'Counsellor / Psychologist' },
 ],
 'ICU / HDU': [
 { name:'Dr. Charles Kimani', role:'Critical Care Physician' },
 { name:'Anne Wambui', role:'ICU Nurse' },
 { name:'Esther Nyambura', role:'Critical Care Nurse' },
 ],
}

function isValidDeptRole(role, dept) {
 if (!role || !dept) return true
 const r = role.toLowerCase()
 const d = dept.toLowerCase()
 if (d.includes('pharmacy') && !r.includes('pharm')) return false
 if (d.includes('laboratory') && !['lab', 'phlebotomist', 'microbiology', 'pathologist'].some(k => r.includes(k))) return false
 if (d.includes('it') && !['it', 'systems', 'support'].some(k => r.includes(k))) return false
 return true
}

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Locum', 'Intern', 'Attachment / Student', 'Volunteer', 'Consultant']
const SHIFT_OPTIONS = ['Day (07:00–19:00)', 'Night (19:00–07:00)', 'Half Day AM', 'Half Day PM', 'Rotating', 'On Call', 'Off Duty']
const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Maternity Leave', 'Paternity Leave', 'Compassionate Leave', 'Study / Exam Leave', 'Unpaid Leave']
const STATUS_OPTIONS = ['Pending Approval', 'Active', 'On Leave', 'Suspended', 'Rejected', 'Terminated', 'Deceased']
const GENDERS = ['Male', 'Female', 'Prefer not to say']

const DEPT_ICONS = {
 'Laboratory':'🔬','Pharmacy':'','Outpatient (OPD)':'','Emergency & Casualty':'',
 'ICU / HDU':'❤','Theatre / Surgery':'','Maternity & Labour Ward':'',
 'Inpatient — Medical Ward':'','Inpatient — Surgical Ward':'🏨','Inpatient — Paediatric Ward':'🧒',
 'Radiology & Imaging':'','Physiotherapy':'🦾','Mental Health & Psychiatry':'',
 'Administration':'📋','Finance & Accounts':'💰','Security':'','Transport':'🚗',
 'Kitchen & Catering':'🍽','Housekeeping & Laundry':'🧹','Maintenance & Engineering':'🔧',
 'IT & Systems':'💻','Mortuary':'⚰','Community Health':'🌍','Cardiology':'❤️',
}

const CAT_COLORS = {
 'Doctors & Clinical Officers': { bg:'#EFF6FF', color:'#1D4ED8' },
 'Nursing': { bg:'#FDF4FF', color:'#7E22CE' },
 'Pharmacy': { bg:'#F0FDF4', color:'#15803D' },
 'Laboratory': { bg:'#FFF7ED', color:'#C2410C' },
 'Allied Health': { bg:'#ECFEFF', color:'#0E7490' },
 'Administration': { bg:'#F8FAFC', color:'#475569' },
 'IT & Systems': { bg:'#EFF6FF', color:'#2563EB' },
 'Support Services': { bg:'#FAFAF9', color:'#78716C' },
}

function getRoleCategory(role) {
 return Object.entries(ROLE_CATEGORIES).find(([, roles]) => roles.includes(role))?.[0] || 'Support Services'
}
function getRegBody(cat) { return REG_BODIES[cat] || null }

function genStaffNo() {
 const timestamp = Date.now().toString(36).toUpperCase()
 const random = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0')
 return `STF-${timestamp}-${random}`
}

function daysUntil(dateStr) {
 if (!dateStr) return null
 return Math.floor((new Date(dateStr) - Date.now()) / 86400000)
}

function statusStyle(s) {
 return {
 Active: { bg:C.primaryL, color:C.primary },
 'On Leave': { bg:C.warnL, color:C.warn },
 Suspended: { bg:C.dangerL, color:C.danger },
 Terminated: { bg:'#F3F4F6', color:C.muted },
 Deceased: { bg:'#F3F4F6', color:C.muted },
 }[s] || { bg:'#F3F4F6', color:C.sub }
}

function shiftStyle(s) {
 if (!s) return { bg:'#F3F4F6', color:C.muted }
 if (s.includes('Day')) return { bg:C.blueL, color:C.blue }
 if (s.includes('Night')) return { bg:C.purpleL, color:C.purple }
 if (s.includes('On Call')) return { bg:C.warnL, color:C.warn }
 if (s.includes('Off')) return { bg:'#F3F4F6', color:C.muted }
 return { bg:'#F3F4F6', color:C.sub }
}

function Avatar({ name, size = 36, cat }) {
 const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
 const sc = cat ? CAT_COLORS[cat] : { bg:'#E5E7EB', color:'#374151' }
 return (
  <div style={{ width:size, height:size, borderRadius:'50%', background:sc.bg, color:sc.color,
   display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700,
   fontSize: size * 0.35, flexShrink:0, letterSpacing:'.5px' }}>
   {initials}
  </div>
 )
}

/* ══════════════════════════════════════════════════════════════════
 STAFF MODAL
══════════════════════════════════════════════════════════════════ */
function StaffModal({ staff, allStaff, departmentOptions, onClose, onSave, saving }) {
 const editing = !!staff?.id
 const [section, setSection] = useState('personal')
 const [form, setForm] = useState({
  staff_no: staff?.staff_no || genStaffNo(),
  full_name: staff?.full_name || '',
  gender: staff?.gender || '',
  date_of_birth: staff?.date_of_birth || '',
  national_id: staff?.national_id || '',
  kra_pin: staff?.kra_pin || '',
  phone: staff?.phone || '',
  email: staff?.email || '',
  address: staff?.address || '',
  role: staff?.role || '',
  role_category: staff?.role_category || '',
  department: staff?.department || '',
  speciality: staff?.speciality || '',
  registration_body: staff?.registration_body || '',
  registration_no: staff?.registration_no || '',
  registration_expiry: staff?.registration_expiry || '',
  employment_type: staff?.employment_type || 'Full-time',
  start_date: staff?.start_date || '',
  contract_end_date: staff?.contract_end_date || '',
  salary_kes: staff?.salary_kes || '',
  pay_grade: staff?.pay_grade || '',
  reporting_to: staff?.reporting_to || '',
  current_shift: staff?.current_shift || 'Day (07:00–19:00)',
  status: staff?.status || 'Active',
  notes: staff?.notes || '',
 })

 const set = k => e => {
  const v = e.target.value
  setForm(f => {
   const u = { ...f, [k]: v }
   if (k === 'role') {
    const cat = getRoleCategory(v)
    const rb = getRegBody(cat)
    u.role_category = cat
    u.registration_body = rb ? `${rb.code} — ${rb.full}` : ''
   }
   return u
  })
 }

 const sections = [
  { key:'personal', label:'👤 Personal' },
  { key:'professional', label:' Professional' },
  { key:'employment', label:'💼 Employment' },
 ]

 return (
  <div style={css.overlay} onClick={onClose}>
   <div style={css.modal} onClick={e => e.stopPropagation()}>
    <div style={{padding:'18px 24px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
     <div>
      <div style={css.modalH}>{editing ? ' Edit Staff' : ' Add New Staff'}</div>
      <div style={{fontSize:'11px', color:C.sub, marginTop:'2px'}}>Staff No: <strong>{form.staff_no}</strong></div>
     </div>
     <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={onClose} aria-label="Close" title="Close">✕</button>
    </div>
    <div style={{display:'flex', gap:'4px', padding:'10px 24px', borderBottom:`1px solid ${C.border}`, background:'#FAFBFD', flexShrink:0}}>
     {sections.map(s => (
      <button key={s.key} style={{...css.tab,...(section===s.key?css.tabActive:{}), fontSize:'12px'}} onClick={() => setSection(s.key)}>
       {s.label}
      </button>
     ))}
    </div>
    <div style={{padding:'20px 24px', overflowY:'auto', flex:1}}>
     {section === 'personal' && (
      <>
       <div style={css.sectionHd}>Personal Information</div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Full Name *</label><input style={css.input} placeholder="Full legal name" value={form.full_name} onChange={set('full_name')} /></div>
        <div><label style={css.lbl}>Gender</label><select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.gender} onChange={set('gender')} disabled><option value="">Select...</option>{GENDERS.map(g => <option key={g}>{g}</option>)}</select></div>
       </div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Date of Birth</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} type="date" value={form.date_of_birth} onChange={set('date_of_birth')} readOnly /></div>
        <div><label style={css.lbl}>National ID / Passport No</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} placeholder="e.g. 12345678" value={form.national_id} onChange={set('national_id')} readOnly /></div>
       </div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Phone *</label><input style={css.input} placeholder="07XXXXXXXX" value={form.phone} onChange={set('phone')} /></div>
        <div><label style={css.lbl}>Email</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} placeholder="staff@hospital.co.ke" value={form.email} onChange={set('email')} readOnly /></div>
       </div>
       <div><label style={css.lbl}>KRA PIN</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} placeholder="A000XXXXXXXB" value={form.kra_pin} onChange={set('kra_pin')} readOnly /></div>
       <div><label style={css.lbl}>Residential Address</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} placeholder="Street, Estate, Town" value={form.address} onChange={set('address')} readOnly /></div>
      </>
     )}
     {section === 'professional' && (
      <>
       <div style={css.sectionHd}>Professional Details</div>
       <div style={css.grid2}>
        <div>
         <label style={css.lbl}>Role / Designation *</label>
         <select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.role} onChange={set('role')} disabled>
          <option value="">— Select Role —</option>
          {Object.entries(ROLE_CATEGORIES).map(([cat, roles]) => (
           <optgroup key={cat} label={cat}>{roles.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
          ))}
         </select>
        </div>
        <div><label style={css.lbl}>Role Category (auto-filled)</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.role_category} readOnly /></div>
       </div>
       <div style={css.grid2}>
        <div>
         <label style={css.lbl}>Department *</label>
         <select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.department} onChange={set('department')} disabled>
          <option value="">— Select Department —</option>
          {departmentOptions.map(d => <option key={d}>{d}</option>)}
         </select>
        </div>
        <div><label style={css.lbl}>Speciality (if applicable)</label><input style={css.input} placeholder="e.g. Cardiology, ICU, Trauma" value={form.speciality} onChange={set('speciality')} /></div>
       </div>
       <div style={{background:C.blueL, border:`1px solid ${C.blue}22`, borderRadius:'7px', padding:'10px 14px', marginBottom:'14px', fontSize:'11px', color:C.blue}}>
        🏛 Registration Body: <strong>{form.registration_body || '— auto-filled when role is selected —'}</strong>
       </div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Registration Number</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} placeholder="e.g. KMPDC/2019/0812" value={form.registration_no} onChange={set('registration_no')} readOnly /></div>
        <div><label style={css.lbl}>Registration Expiry Date</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} type="date" value={form.registration_expiry} onChange={set('registration_expiry')} readOnly /></div>
       </div>
       {form.registration_expiry && (() => {
        const days = daysUntil(form.registration_expiry)
        if (days === null) return null
        const isExpired = days < 0
        const isExpiring = days <= 30 && days >= 0
        if (!isExpired && !isExpiring) return null
        return (
         <div style={{background: isExpired?C.dangerL:C.warnL, border:`1px solid ${isExpired?C.danger:C.warn}33`, borderRadius:'7px', padding:'8px 12px', marginBottom:'12px', fontSize:'11px', color: isExpired?C.danger:C.warn, fontWeight:600}}>
          {isExpired ? ` Registration EXPIRED ${Math.abs(days)} days ago!` : ` Registration expires in ${days} day(s) — renew soon!`}
         </div>
        )
       })()}
      </>
     )}
     {section === 'employment' && (
      <>
       <div style={css.sectionHd}>Employment & Payroll</div>
       <div style={css.grid3}>
        <div><label style={css.lbl}>Employment Type</label><select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.employment_type} onChange={set('employment_type')} disabled>{EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
        <div><label style={css.lbl}>Start Date</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} type="date" value={form.start_date} onChange={set('start_date')} readOnly /></div>
        <div><label style={css.lbl}>Contract End (if applicable)</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} type="date" value={form.contract_end_date} onChange={set('contract_end_date')} readOnly /></div>
       </div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Gross Salary (KES / month)</label><input style={{...css.input, background:'#FAFBFD', color:C.sub}} type="number" placeholder="e.g. 80000" value={form.salary_kes} onChange={set('salary_kes')} readOnly /></div>
        <div>
         <label style={css.lbl}>Reporting To</label>
         <select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.reporting_to} onChange={set('reporting_to')} disabled>
          <option value="">— None / Top Level —</option>
          {allStaff.filter(s => s.department && s.department === form.department && s.id !== staff?.id).length > 0 && (
           <optgroup label={` ${form.department || 'Same Dept'}`}>
            {allStaff.filter(s => s.department && s.department === form.department && s.id !== staff?.id).map(s => <option key={s.id} value={s.id}>{s.full_name} — {s.role}</option>)}
           </optgroup>
          )}
          {allStaff.filter(s => s.department !== form.department && s.id !== staff?.id).length > 0 && (
           <optgroup label="🏢 Other Departments">
            {allStaff.filter(s => s.department !== form.department && s.id !== staff?.id).map(s => <option key={s.id} value={s.id}>{s.full_name} — {s.role} ({s.department})</option>)}
           </optgroup>
          )}
         </select>
        </div>
       </div>
       <div style={css.grid2}>
        <div><label style={css.lbl}>Current Shift</label><select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.current_shift} onChange={set('current_shift')} disabled>{SHIFT_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div>
        <div><label style={css.lbl}>Staff Status</label><select style={{...css.input, background:'#FAFBFD', color:C.sub}} value={form.status} onChange={set('status')} disabled>{STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div>
       </div>
       <div><label style={css.lbl}>Notes / Additional Info</label><textarea style={{...css.input, height:'60px', resize:'vertical', background:'#FAFBFD', color:C.sub}} placeholder="Any additional notes..." value={form.notes} onChange={set('notes')} readOnly /></div>
      </>
     )}
    </div>
    <div style={{padding:'14px 24px', borderTop:`1px solid ${C.border}`, display:'flex', gap:'8px', justifyContent:'flex-end', flexShrink:0}}>
     {section !== 'personal' && (
      <button style={{...css.btn,...css.btnGhost}} onClick={() => setSection(s => s === 'employment' ? 'professional' : 'personal')}>← Back</button>
     )}
     {section !== 'employment' ? (
      <button style={{...css.btn,...css.btnBlue}} onClick={() => setSection(s => s === 'personal' ? 'professional' : 'employment')}>Next →</button>
     ) : (
      <button style={{...css.btn,...css.btnPri}} onClick={() => onSave(form, staff?.id)} disabled={saving}>
       {saving ? 'Saving...' : ' Update Staff'}
      </button>
     )}
    </div>
   </div>
  </div>
 )
}

/* ══════════════════════════════════════════════════════════════════
 VIEW MODAL
══════════════════════════════════════════════════════════════════ */
function ViewModal({ s, allStaff, onClose, onEdit }) {
 const sc = CAT_COLORS[s.role_category] || { bg:'#F3F4F6', color:C.sub }
 const days = daysUntil(s.registration_expiry)
 const supervisor = allStaff.find(x => x.id === s.reporting_to)
 const Row = ({ label, value, bold }) => value ? (
  <div style={{display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:`1px solid ${C.border}`, fontSize:'13px'}}>
   <span style={{color:C.sub, minWidth:'140px'}}>{label}</span>
   <span style={{fontWeight:bold?700:500, textAlign:'right'}}>{value}</span>
  </div>
 ) : null
 return (
  <div style={css.overlay} onClick={onClose}>
   <div style={{...css.modal, width:'540px'}} onClick={e => e.stopPropagation()}>
    <div style={{padding:'20px 24px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:'14px', flexShrink:0}}>
     <Avatar name={s.full_name} size={48} cat={s.role_category} />
     <div style={{flex:1}}>
      <div style={{fontWeight:800, fontSize:'16px'}}>{s.full_name}</div>
      <div style={{fontSize:'12px', color:C.sub, marginTop:'2px'}}>{s.role} · {s.department}</div>
      <div style={{display:'flex', gap:'6px', marginTop:'6px', flexWrap:'wrap'}}>
       <span style={{...css.badge, ...statusStyle(s.status)}}>{s.status}</span>
       <span style={{...css.badge, background:sc.bg, color:sc.color}}>{s.role_category}</span>
       {s.current_shift && <span style={{...css.badge, ...shiftStyle(s.current_shift)}}>{s.current_shift}</span>}
      </div>
     </div>
     <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={onClose} aria-label="Close" title="Close">✕</button>
    </div>
    <div style={{padding:'16px 24px', overflowY:'auto', flex:1}}>
     <div style={css.sectionHd}>Personal</div>
     <Row label="Staff No" value={s.staff_no} bold />
     <Row label="National ID" value={s.national_id} />
     <Row label="KRA PIN" value={s.kra_pin} />
     <Row label="Phone" value={s.phone} />
     <Row label="Email" value={s.email} />
     <Row label="Gender" value={s.gender} />
     <Row label="Date of Birth" value={s.date_of_birth} />
     <div style={{...css.sectionHd, marginTop:'16px'}}>Professional</div>
     <Row label="Role" value={s.role} bold />
     <Row label="Department" value={s.department} />
     <Row label="Speciality" value={s.speciality} />
     <Row label="Reg. Body" value={s.registration_body} />
     <Row label="Reg. Number" value={s.registration_no} />
     <Row label="Reg. Expiry" value={s.registration_expiry} />
     {days !== null && days <= 30 && (
      <div style={{background: days < 0?C.dangerL:C.warnL, borderRadius:'7px', padding:'8px 12px', fontSize:'11px', color: days < 0?C.danger:C.warn, fontWeight:600, marginTop:'6px'}}>
       {days < 0 ? ` Registration EXPIRED ${Math.abs(days)} days ago` : ` Expires in ${days} day(s)`}
      </div>
     )}
     <div style={{...css.sectionHd, marginTop:'16px'}}>Employment</div>
     <Row label="Employment Type" value={s.employment_type} />
     <Row label="Start Date" value={s.start_date} />
     <Row label="Contract End" value={s.contract_end_date} />
     <Row label="Gross Salary" value={s.salary_kes ? `KES ${parseFloat(s.salary_kes).toLocaleString()} / mo` : null} bold />
     <Row label="Reporting To" value={supervisor?.full_name} />
     <Row label="Current Shift" value={s.current_shift} />
     {s.notes && <div style={{marginTop:'12px', background:C.bg, borderRadius:'7px', padding:'10px 12px', fontSize:'12px', color:C.sub}}>📝 {s.notes}</div>}
    </div>
    <div style={{padding:'12px 24px', borderTop:`1px solid ${C.border}`, display:'flex', gap:'8px', flexShrink:0}}>
     <button style={{...css.btn,...css.btnGhost,flex:1,padding:'9px'}} onClick={onClose}>Close</button>
     <button style={{...css.btn,...css.btnPri,flex:2,padding:'9px'}} onClick={onEdit}> Edit</button>
    </div>
   </div>
  </div>
 )
}

/* ══════════════════════════════════════════════════════════════════
 DEPARTMENT MODAL
══════════════════════════════════════════════════════════════════ */
function DepartmentModal({ visible, form, onClose, onChange, onSave, saving }) {
 if (!visible) return null
 return (
  <div style={css.overlay} onClick={onClose}>
   <div style={css.modal} onClick={e => e.stopPropagation()}>
    <div style={{padding:'18px 24px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
     <div>
      <div style={css.modalH}>Manage Department</div>
      <div style={{fontSize:'11px', color:C.sub, marginTop:'2px'}}>Create or update departments stored in the hospital database.</div>
     </div>
     <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={onClose} aria-label="Close" title="Close">✕</button>
    </div>
    <div style={{padding:'20px 24px', overflowY:'auto', flex:1}}>
     <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
      <div><label style={css.lbl}>Department Name</label><input style={css.input} value={form.name} onChange={e => onChange('name', e.target.value)} placeholder="e.g. Cardiology" /></div>
      <div>
       <label style={css.lbl}>Type</label>
       <select style={css.input} value={form.dept_type} onChange={e => onChange('dept_type', e.target.value)}>
        <option value="clinical">Clinical</option>
        <option value="diagnostic">Diagnostic</option>
        <option value="pharmacy">Pharmacy</option>
        <option value="admin">Admin</option>
        <option value="support">Support</option>
       </select>
      </div>
      <div><label style={css.lbl}>Icon</label><input style={css.input} value={form.icon} onChange={e => onChange('icon', e.target.value)} placeholder="Emoji or short symbol" /></div>
      <div><label style={css.lbl}>Color</label><input style={css.input} value={form.color_hex} onChange={e => onChange('color_hex', e.target.value)} placeholder="#2563EB" /></div>
      <div><label style={css.lbl}>Background</label><input style={css.input} value={form.bg} onChange={e => onChange('bg', e.target.value)} placeholder="#EFF6FF" /></div>
     </div>
     <div><label style={css.lbl}>Description</label><textarea style={{...css.input, minHeight:'80px', resize:'vertical'}} value={form.description} onChange={e => onChange('description', e.target.value)} placeholder="Short department summary." /></div>
     <div style={{display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px', marginTop:'10px'}}>
      <label style={{...css.lbl, display:'flex', alignItems:'center', gap:'8px'}}><input type="checkbox" checked={form.can_refer} onChange={e => onChange('can_refer', e.target.checked)} /> Can refer</label>
      <label style={{...css.lbl, display:'flex', alignItems:'center', gap:'8px'}}><input type="checkbox" checked={form.can_order_lab} onChange={e => onChange('can_order_lab', e.target.checked)} /> Order lab</label>
      <label style={{...css.lbl, display:'flex', alignItems:'center', gap:'8px'}}><input type="checkbox" checked={form.can_prescribe} onChange={e => onChange('can_prescribe', e.target.checked)} /> Can prescribe</label>
     </div>
    </div>
    <div style={{padding:'14px 24px', borderTop:`1px solid ${C.border}`, display:'flex', gap:'8px', justifyContent:'flex-end', flexShrink:0}}>
     <button style={{...css.btn,...css.btnGhost}} onClick={onClose}>Cancel</button>
     <button style={{...css.btn,...css.btnPri}} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save Department'}</button>
    </div>
   </div>
  </div>
 )
}

/* ══════════════════════════════════════════════════════════════════
 MAIN COMPONENT
══════════════════════════════════════════════════════════════════ */
export default function HRStaff({ onNavigateDepartment }) {
 const ctx = useHospital()
 const location = useLocation()
 const hospitalId = ctx?.hospitalId
 const userRole = ctx?.userRole
 const configuredDepartments = ctx?.departments || []
 const refreshDepartments = ctx?.refreshDepartments

 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const canDecideLeave = isAdmin || resolveRole(userRole) === 'HR'
 const canViewPayroll = canAccessPayroll(userRole)
 const [staff, setStaff] = useState([])
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const requestedTab = new URLSearchParams(location.search).get('tab')
 const [tab, setTab] = useState(canViewPayroll && requestedTab === 'payroll' ? 'payroll' : 'directory')
 const [search, setSearch] = useState('')
 const hrTabs = [
  { key: 'directory', label: 'Staff Directory' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'roster', label: 'Duty roster' },
  { key: 'leave', label: 'Leave' },
  { key: 'licences', label: 'Licences & CPD' },
  { key: 'departments', label: 'Departments' },
  ...(canViewPayroll ? [{ key: 'payroll', label: 'Payroll' }] : []),
 ]

 useEffect(() => {
  if (canViewPayroll && requestedTab === 'payroll') setTab('payroll')
 }, [canViewPayroll, requestedTab])

 useEffect(() => {
  if (!isAdmin && canViewPayroll) setTab('payroll')
 }, [isAdmin, canViewPayroll])
 const [deptFilter, setDeptFilter] = useState('all')
 const [catFilter, setCatFilter] = useState('all')
 const [statusFilter, setStatusFilter] = useState('all')
 const [empFilter, setEmpFilter] = useState('all')
 const [showModal, setShowModal] = useState(false)
 const [editStaff, setEditStaff] = useState(null)
 const [viewStaff, setViewStaff] = useState(null)
 const [leaveForm, setLeaveForm] = useState(null)
 const [leaves, setLeaves] = useState([])
 const [seeding, setSeeding] = useState(false)
 const [visitCounts, setVisitCounts] = useState({})
 const [selectedDept, setSelectedDept] = useState(null)
 const [showDeptModal, setShowDeptModal] = useState(false)
 const [editDepartment, setEditDepartment] = useState(null)
 const [departmentForm, setDepartmentForm] = useState({
  name: '', dept_type: 'clinical', icon: '🏥', color_hex: '#2563EB',
  bg: '#EFF6FF', description: '', can_refer: true, can_order_lab: true, can_prescribe: true,
 })
 const [deptSaving, setDeptSaving] = useState(false)

 // ── THE FIX: safe useEffect with timeout fallback ──────────────
 useEffect(() => {
  if (canViewPayroll && !isAdmin) {
   setLoading(false)
   return
  }
  if (hospitalId) {
   fetchAll()
  } else {
   // hospitalId not ready — stop spinner after 5s so page never freezes forever
   const t = setTimeout(() => setLoading(false), 5000)
   return () => clearTimeout(t)
  }
 }, [hospitalId, isAdmin, canViewPayroll])

 // ── THE FIX: try/catch/finally so setLoading(false) ALWAYS runs ─
 async function fetchAll() {
  setLoading(true)
  try {
   // Staff — runs first, most important
   await fetchStaff(search)

   // Leave records
   const { data: leaveData, error: leaveError } = await supabase
    .from('staff_leave')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('start_date', { ascending: false })
   if (leaveError) console.error('leave error:', leaveError.message)
   setLeaves(leaveData || [])

   // Visits for referral counts — isolated so RLS/column errors can't block the page
   try {
    const { data: visitsData } = await supabase
     .from('visits')
     .select('id,status,speciality')
     .eq('hospital_id', hospitalId)
     .in('status', ['Doctor', 'referred', 'Referred'])
    const counts = {}
    ;(visitsData || []).forEach(v => {
     const dept = v.speciality || ''
     if (dept) counts[dept] = (counts[dept] || 0) + 1
    })
    setVisitCounts(counts)
   } catch (visitsErr) {
    console.error('visits error (non-blocking):', visitsErr.message)
    setVisitCounts({})
   }

  } catch (err) {
   console.error('HR fetchAll error:', err.message)
  } finally {
   // ALWAYS stops loading no matter what failed above
   setLoading(false)
  }
 }

 async function fetchStaff(searchTerm = '') {
  const query = supabase
    .from('staff')
    .select('*')
    .eq('hospital_id', hospitalId)
    .order('full_name')
    .limit(200)

  if (searchTerm?.trim()) {
    query.or(`full_name.ilike.%${searchTerm}%,staff_no.ilike.%${searchTerm}%,role.ilike.%${searchTerm}%,department.ilike.%${searchTerm}%,registration_no.ilike.%${searchTerm}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('fetchStaff error:', error.message)
    setStaff([])
  } else {
    setStaff(data || [])
  }
 }

 useEffect(() => {
  if (!hospitalId) return
  const timeout = setTimeout(() => fetchStaff(search), 350)
  return () => clearTimeout(timeout)
 }, [hospitalId, search])

 async function handleSaveDepartment() {
  if (!hospitalId) return
  // Save the proper name and refuse a second copy of a department ("Psychiatry" when "Mental Health & Psychiatry" exists).
  const name = canonicalDepartmentName(departmentForm.name)
  if (!name) return notifyWarning('Department name is required.')
  const editingName = editDepartment ? (departmentRecords.find(d => d.id === editDepartment)?.name || '') : ''
  const duplicate = findExistingDepartment(name, departmentRecords.map(d => d.name), editingName)
  if (duplicate) return notifyWarning(`"${departmentForm.name.trim()}" is the same department as "${duplicate}", which already exists. Edit "${duplicate}" instead.`)
  const departmentLayout = departmentForm.dept_type === 'diagnostic'
   ? { data_sources: ['lab_tests', 'staff'], ui_sections: ['lab_queue', 'completed_tests', 'staff'] }
   : departmentForm.dept_type === 'pharmacy'
    ? { data_sources: ['prescriptions', 'staff'], ui_sections: ['prescription_queue', 'dispensed', 'staff'] }
    : departmentForm.dept_type === 'clinical'
     ? { data_sources: ['visits', 'consultations', 'staff'], ui_sections: ['visit_queue', 'consultations', 'staff'] }
     : { data_sources: ['staff'], ui_sections: ['staff_full'] }
  setDeptSaving(true)
  const payload = {
   hospital_id: hospitalId,
   name,
   dept_type: departmentForm.dept_type,
   icon: departmentForm.icon,
   color_hex: departmentForm.color_hex,
   bg: departmentForm.bg,
   description: departmentForm.description,
   can_refer: departmentForm.can_refer,
   can_order_lab: departmentForm.can_order_lab,
   can_prescribe: departmentForm.can_prescribe,
   ...departmentLayout,
  }
  const { error } = editDepartment
   ? await supabase.from('departments').update(payload).eq('id', editDepartment)
   : await supabase.from('departments').insert(payload)
  setDeptSaving(false)
  if (error) { notifyFromLegacyAlert(error.message); return }
  setShowDeptModal(false)
  setEditDepartment(null)
  setDepartmentForm({ name: '', dept_type: 'clinical', icon: '🏥', color_hex: '#2563EB', bg: '#EFF6FF', description: '', can_refer: true, can_order_lab: true, can_prescribe: true })
  await refreshDepartments?.()
 }

 async function handleDeleteDepartment(dept) {
  if (!isAdmin) return notifyWarning('Only Admin users can manage departments.')
  const deptName = typeof dept === 'string' ? dept : dept?.name
  if (!deptName) return
  if (!await window.openConfirmDialog(`Delete department '${deptName}'? This will not remove existing staff assignments.`)) return
  const query = supabase.from('departments').delete().eq('hospital_id', hospitalId)
  const { error } = dept?.id ? await query.eq('id', dept.id) : await query.eq('name', deptName)
  if (error) { notifyFromLegacyAlert(error.message); return }
  if (selectedDept === deptName) setSelectedDept(null)
  if (deptFilter === deptName) setDeptFilter('all')
  await refreshDepartments?.()
 }

 function openDepartmentModal(dept = null) {
  if (!dept) {
   setEditDepartment(null)
   setDepartmentForm({ name: '', dept_type: 'clinical', icon: '🏥', color_hex: '#2563EB', bg: '#EFF6FF', description: '', can_refer: true, can_order_lab: true, can_prescribe: true })
  } else {
   setEditDepartment(dept.id)
   setDepartmentForm({ name: dept.name, dept_type: dept.dept_type, icon: dept.icon || '🏥', color_hex: dept.color_hex || '#2563EB', bg: dept.bg || '#EFF6FF', description: dept.description || '', can_refer: dept.can_refer !== false, can_order_lab: dept.can_order_lab !== false, can_prescribe: dept.can_prescribe !== false })
  }
  setShowDeptModal(true)
 }

 async function seedDepartmentStaff(department) {
  if (!hospitalId) return
  const template = STAFF_TEMPLATES[department]
  if (!template) return notifyWarning(`No auto-staff template exists for ${department}.`)
  const existingNames = new Set(staff.map(s => s.full_name))
  const payload = template.filter(p => !existingNames.has(p.name)).map(p => {
   const cat = getRoleCategory(p.role)
   const rb = getRegBody(cat)
   return { hospital_id: hospitalId, staff_no: genStaffNo(), full_name: p.name, role: p.role, role_category: cat, department, employment_type: 'Full-time', current_shift: 'Day (07:00–19:00)', status: 'Active', registration_body: rb ? `${rb.code} — ${rb.full}` : null }
  })
  if (payload.length === 0) return notifyWarning(`Template staff for ${department} already exist.`)
  setSeeding(true)
  const { error } = await supabase.from('staff').insert(payload)
  setSeeding(false)
  if (error) return notifyFromLegacyAlert(error.message)
  fetchAll()
 }

 async function seedAllCoreStaff() {
  if (!hospitalId) return
  const existingNames = new Set(staff.map(s => s.full_name))
  const payload = []
  Object.keys(STAFF_TEMPLATES).forEach(department => {
   ;(STAFF_TEMPLATES[department] || []).forEach(p => {
    if (!existingNames.has(p.name)) {
     const cat = getRoleCategory(p.role)
     const rb = getRegBody(cat)
     payload.push({ hospital_id: hospitalId, staff_no: genStaffNo(), full_name: p.name, role: p.role, role_category: cat, department, employment_type: 'Full-time', current_shift: 'Day (07:00–19:00)', status: 'Active', registration_body: rb ? `${rb.code} — ${rb.full}` : null })
    }
   })
  })
  if (payload.length === 0) return notifyWarning('All core template staff already exist.')
  setSeeding(true)
  const { error } = await supabase.from('staff').insert(payload)
  setSeeding(false)
  if (error) return notifyFromLegacyAlert(error.message)
  fetchAll()
 }

 async function handleSave(form, id) {
  if (!id) return notifyInfo('Create new staff accounts from Settings → Staff & Users.')
  if (!form.full_name || !form.phone) return notifyWarning('Full name and phone are required.')
  setSaving(true)
  const payload = {
   full_name: form.full_name,
   phone: form.phone,
   speciality: form.speciality || null,
  }
  const { error } = await supabase.from('staff').update(payload).eq('id', id).eq('hospital_id', hospitalId)
  if (error) { notifyError('Error: ' + error.message); setSaving(false); return }
  setShowModal(false); setEditStaff(null)
  await fetchAll(); setSaving(false)
 }

 async function handleDelete(s) {
  if (!isAdmin) { notifyWarning('Only Admin users can delete staff records.'); return }
  if (!await window.openConfirmDialog(`Remove ${s.full_name} from the system? This cannot be undone.`)) return
  await supabase.from('staff').delete().eq('id', s.id)
  fetchAll()
 }

 async function updateShift(id, shift) {
  await supabase.from('staff').update({ current_shift: shift }).eq('id', id)
  setStaff(prev => prev.map(s => s.id === id ? { ...s, current_shift: shift } : s))
 }

 async function toggleOnShift(id, currentShift) {
  const nextShift = currentShift && !currentShift.toLowerCase().includes('off')
   ? 'Off Duty'
   : 'Day (07:00–19:00)'
  await updateShift(id, nextShift)
 }

 async function saveLeave(form) {
  // HR approves in the Leave tab; the staff member is marked On Leave when approved leave starts (database).
  const { error } = await supabase.from('staff_leave').insert({ hospital_id: hospitalId, ...form, created_at: new Date().toISOString() })
  if (error) { notifyError('Error: ' + error.message); return }
  notifyInfo('Leave requested. HR approves it in the Leave tab.')
  setLeaveForm(null); fetchAll()
 }

 const totalStaff = staff.length
 const onDuty = staff.filter(s => s.status === 'Active' && s.current_shift && !s.current_shift.includes('Off')).length
 const onLeave = staff.filter(s => s.status === 'On Leave').length
 const expiringReg = staff.filter(s => { const d = daysUntil(s.registration_expiry); return d !== null && d <= 30 }).length
 const totalPayroll = staff.reduce((a, s) => a + (parseFloat(s.salary_kes) || 0), 0)

 const filtered = useMemo(() => staff.filter(s => {
  const q = search.toLowerCase()
  const matchSearch = !search || s.full_name?.toLowerCase().includes(q) || s.staff_no?.toLowerCase().includes(q) || s.role?.toLowerCase().includes(q) || s.department?.toLowerCase().includes(q) || s.phone?.includes(search) || s.registration_no?.toLowerCase().includes(q)
  return matchSearch && (deptFilter === 'all' || s.department === deptFilter) && (catFilter === 'all' || s.role_category === catFilter) && (statusFilter === 'all' || s.status === statusFilter) && (empFilter === 'all' || s.employment_type === empFilter)
 }), [staff, search, deptFilter, catFilter, statusFilter, empFilter])

 const departmentRecords = configuredDepartments || []
 const configuredDepartmentNames = useMemo(() => departmentRecords.map(d => d?.name).filter(Boolean), [departmentRecords])
 const legacyDepartmentNames = useMemo(() => [...new Set(staff.map(s => String(s.department || '').trim()).filter(Boolean))].filter(name => !configuredDepartmentNames.includes(name)).sort(), [staff, configuredDepartmentNames])
 const departmentOptions = useMemo(() => [...configuredDepartmentNames, ...legacyDepartmentNames], [configuredDepartmentNames, legacyDepartmentNames])
 const departmentRecordMap = useMemo(() => new Map(departmentRecords.map(dept => [dept.name, dept])), [departmentRecords])

 const staffByDepartment = useMemo(() => {
  const map = {}
  staff.forEach(s => {
   const d = departmentOptions.includes(s.department) ? s.department : s.department || 'Unassigned'
   if (!map[d]) map[d] = []
   map[d].push(s)
  })
  return map
 }, [staff, departmentOptions])

 const invalidStaff = useMemo(() => staff.filter(s => !s.department || !s.role), [staff])

 const deptSummary = useMemo(() => {
  const map = {}
  departmentOptions.forEach(d => { map[d] = { total: 0, active: 0, cats: {} } })
  staff.forEach(s => {
   const d = departmentOptions.includes(s.department) ? s.department : s.department || 'Unassigned'
   if (!map[d]) map[d] = { total: 0, active: 0, cats: {} }
   map[d].total++
   if (s.status === 'Active') map[d].active++
   const cat = s.role_category || 'Other'
   map[d].cats[cat] = (map[d].cats[cat] || 0) + 1
  })
  return Object.entries(map)
 }, [staff, departmentOptions])

 const emptyDepartments = departmentOptions.filter(d => !(staffByDepartment[d] || []).length)

 if (loading) return (
  <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:C.bg, fontFamily:typography.fontFamily }}>
   <div style={{ textAlign:'center', color:C.sub }}>
    <div style={{ width:'220px' }}>
     <SkeletonLoader rows={3} height={14} width={['55%','100%','72%']} />
    </div>
    <div style={{ marginTop:'12px' }}>Loading staff...</div>
   </div>
  </div>
 )

 return (
  <div style={css.page}>
   <div style={css.wrap}>

    {/* Header */}
    <div style={css.header}>
     <div><h1 style={css.h1}>HR & Staff</h1></div>
     <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
      {canViewPayroll && tab !== 'payroll' && <button type="button" style={{...css.btn,...css.btnPri}} onClick={() => setTab('payroll')}>Open Payroll</button>}
      <div style={{ background:C.blueL, border:`1px solid ${C.blue}22`, borderRadius:'8px', padding:'10px 14px', fontSize:'12px', color:C.blue, maxWidth:'320px' }}>
       To add new staff members and give them app access, go to Settings → Staff & Users.
      </div>
     </div>
    </div>

    {isAdmin && <div style={css.subtext}>
     {totalStaff} staff registered · {onDuty} on duty · {onLeave} on leave
     {expiringReg > 0 && <span style={{ color:C.warn, fontWeight:600 }}> · {expiringReg} registration(s) expiring soon</span>}
    </div>}

    {/* Stats */}
    {isAdmin && <div style={css.statsRow}>
     {[
      { lbl:'Total Staff', val:totalStaff, sub:'all employment types', color:C.text },
      { lbl:'On Duty Now', val:onDuty, sub:'active shifts', color:C.blue },
      { lbl:'On Leave', val:onLeave, sub:'currently absent', color:C.warn },
      { lbl:'Expiring Reg.', val:expiringReg, sub:'within 30 days', color:expiringReg>0?C.danger:C.muted },
      { lbl:'Monthly Payroll', val:`KES ${(totalPayroll/1000).toFixed(0)}K`, sub:'gross estimates', color:C.primary },
     ].map(s => (
      <div key={s.lbl} style={css.stat}>
       <div style={css.statLbl}>{s.lbl}</div>
       <div style={{...css.statVal, color:s.color}}>{s.val}</div>
       <div style={css.statSub}>{s.sub}</div>
      </div>
     ))}
    </div>}

    {/* Tabs */}
    <div style={css.tabRow}>
     {[
      { key:'directory', label:'📋 Directory' },
      { key:'departments', label:' Departments' },
      { key:'onduty', label:'⏰ On Duty Today' },
      { key:'leave', label:`🌴 Leave (${onLeave})` },
     ].filter(() => isAdmin).concat(canViewPayroll ? [{ key:'payroll', label:'Payroll' }] : []).map(t => (
      <button key={t.key} style={{...css.tab,...(tab===t.key?css.tabActive:{})}} onClick={() => setTab(t.key)}>{t.label}</button>
     ))}
    </div>

    {/* ════ TAB: DIRECTORY ════ */}
    {tab === 'payroll' && canViewPayroll && <Payroll compact />}

    {tab === 'directory' && (
     <>
      {selectedDept && (
       <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px', fontSize:'12px', color:C.sub }}>
        <span>Showing department:</span>
        <span style={{ padding:'4px 10px', borderRadius:'999px', background:'#EEF2FF', color:C.blue, fontWeight:600 }}>{selectedDept}</span>
        <button style={{...css.btn,...css.btnGhost,fontSize:'11px',padding:'4px 8px'}} onClick={() => { setDeptFilter('all'); setSelectedDept(null) }}>Clear</button>
       </div>
      )}
      <div style={css.toolbar}>
       <div style={css.searchWrap}>
        <span style={css.searchIcon}></span>
        <input style={css.searchInp} placeholder="Search name, staff no, role, department, reg no..." value={search} onChange={e => setSearch(e.target.value)} />
       </div>
       <select style={css.select} value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setSelectedDept(e.target.value === 'all' ? null : e.target.value) }}>
        <option value="all">All Departments</option>
        {departmentOptions.map(d => <option key={d}>{d}</option>)}
       </select>
       <select style={css.select} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
        <option value="all">All Categories</option>
        {Object.keys(ROLE_CATEGORIES).map(c => <option key={c}>{c}</option>)}
       </select>
       <select style={css.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="all">All Statuses</option>
        {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
       </select>
       <select style={css.select} value={empFilter} onChange={e => setEmpFilter(e.target.value)}>
        <option value="all">All Types</option>
        {EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
       </select>
       <span style={{ fontSize:'12px', color:C.sub, whiteSpace:'nowrap' }}>{filtered.length} records</span>
      </div>
      <div style={css.card}>
       <div style={{ overflowX:'auto' }}>
        <table style={css.table}>
         <thead>
          <tr>
           {['Staff','Role / Category','Department','Type','Registration','Shift','Status',''].map(h => <th key={h} style={css.th}>{h}</th>)}
          </tr>
         </thead>
         <tbody>
          {filtered.length === 0 && (
           <tr><td colSpan={8} style={{...css.td, textAlign:'center', color:C.muted, padding:'40px'}}>
            No staff found. {search || deptFilter !== 'all' ? 'Try adjusting filters.' : 'Add staff in Settings → Staff & Users to manage them here.'}
           </td></tr>
          )}
          {filtered.map(s => {
           const sc = CAT_COLORS[s.role_category] || { bg:'#F3F4F6', color:C.sub }
           const days = daysUntil(s.registration_expiry)
           return (
            <tr key={s.id} onMouseEnter={e => e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e => e.currentTarget.style.background=''}>
             <td style={css.td}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
               <Avatar name={s.full_name} size={32} cat={s.role_category} />
               <div>
                <div style={{ fontWeight:600 }}>{s.full_name}</div>
                <div style={{ fontSize:'11px', color:C.sub, marginTop:'1px' }}>{s.staff_no} · {s.phone}</div>
               </div>
              </div>
             </td>
             <td style={css.td}>
              <div style={{ fontSize:'12px', fontWeight:600 }}>{s.role || '—'}</div>
              {s.role_category && <span style={{...css.badge, background:sc.bg, color:sc.color, fontSize:'10px', marginTop:'3px', display:'inline-block'}}>{s.role_category}</span>}
             </td>
             <td style={{...css.td, fontSize:'12px'}}>
              <div>{DEPT_ICONS[s.department] || ''} {s.department || '—'}</div>
              {s.speciality && <div style={{ fontSize:'11px', color:C.sub, marginTop:'2px' }}>{s.speciality}</div>}
             </td>
             <td style={{...css.td, fontSize:'12px', color:C.sub}}>{s.employment_type || '—'}</td>
             <td style={css.td}>
              {s.registration_no ? (
               <div>
                <div style={{ fontSize:'11px', fontFamily:'monospace', color:C.purple }}>{s.registration_no}</div>
                {days !== null && <div style={{ fontSize:'10px', color: days < 0?C.danger : days <= 30?C.warn:C.primary, fontWeight:600, marginTop:'2px' }}>{days < 0 ? `EXPIRED ${Math.abs(days)}d ago` : days <= 30 ? `Expires in ${days}d` : `Valid · ${days}d left`}</div>}
               </div>
              ) : <span style={{ fontSize:'11px', color:C.muted }}>N/A</span>}
             </td>
             <td style={css.td}>
              <select style={{...css.badge, ...shiftStyle(s.current_shift), border:'none', cursor:'pointer', padding:'3px 8px', fontSize:'11px', outline:'none'}} value={s.current_shift || 'Off Duty'} onChange={e => updateShift(s.id, e.target.value)}>
               {SHIFT_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
             </td>
             <td style={css.td}><span style={{...css.badge, ...statusStyle(s.status)}}>{s.status}</span></td>
             <td style={css.td}>
             <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
               <button style={{...css.btn,...css.btnBlue,padding:'4px 10px',fontSize:'11px'}} onClick={() => setViewStaff(s)}>View</button>
               <button style={{...css.btn,...css.btnGhost,padding:'4px 10px',fontSize:'11px'}} onClick={() => { setEditStaff(s); setShowModal(true) }}>Edit</button>
               <button style={{...css.btn,...css.btnGhost,padding:'4px 10px',fontSize:'11px'}} onClick={() => toggleOnShift(s.id, s.current_shift)}>{s.current_shift && !s.current_shift.toLowerCase().includes('off') ? 'Set Off' : 'Set On'}</button>
              </div>
             </td>
            </tr>
           )
          })}
         </tbody>
        </table>
       </div>
      </div>
     </>
    )}

    {/* ════ TAB: DEPARTMENTS ════ */}
    {tab === 'roster' && <HrRoster hospitalId={hospitalId} staff={staff} />}
    {tab === 'licences' && <HrLicences hospitalId={hospitalId} staff={staff} />}

    {tab === 'departments' && (
     <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', flexWrap:'wrap', gap:8 }}>
       <div style={{ color:C.sub, fontSize:'12px' }}>Click any department card to open the staff directory filtered for that department.</div>
       {isAdmin && configuredDepartments.length === 0 && (
        <div style={{ background:C.warnL, border:`1px solid ${C.warn}44`, borderRadius:'8px', padding:'10px 14px', fontSize:'12px', color:C.warn, display:'flex', gap:10, alignItems:'center' }}>
         <span>⚠️ No departments in database yet.</span>
         <span style={{ color:C.sub }}>Run <strong>migration_departments.sql</strong> in Supabase to seed defaults.</span>
        </div>
       )}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(180px,1fr))', gap:'12px', marginBottom:'18px' }}>
       <div style={{...css.card, padding:'14px 16px'}}><div style={{ fontSize:'12px', color:C.sub, marginBottom:'6px' }}>Departments with staff</div><div style={{ fontSize:'22px', fontWeight:700 }}>{deptSummary.filter(([_, info]) => info.total > 0).length}</div></div>
       <div style={{...css.card, padding:'14px 16px'}}><div style={{ fontSize:'12px', color:C.sub, marginBottom:'6px' }}>Departments still empty</div><div style={{ fontSize:'22px', fontWeight:700 }}>{emptyDepartments.length}</div></div>
       <div style={{...css.card, padding:'14px 16px', borderColor: invalidStaff.length ? C.danger : C.border }}>
        <div style={{ fontSize:'12px', color:C.sub, marginBottom:'6px' }}>Incomplete staff records</div>
        <div style={{ fontSize:'22px', fontWeight:700, color: invalidStaff.length ? C.danger : C.text }}>{invalidStaff.length}</div>
        {invalidStaff.length > 0 && <div style={{ fontSize:'11px', color:C.danger, marginTop:'6px' }}>Fix missing role or department before saving staff.</div>}
       </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'14px' }}>
       {deptSummary.map(([dept, info]) => {
        const deptStaff = staffByDepartment[dept] || []
        const departmentRecord = departmentRecordMap.get(dept)
        const deptIcon = departmentRecord?.icon || DEPT_ICONS[dept] || ''
        return (
         <div key={dept} style={{...css.deptCard, textAlign:'left', cursor:'default'}}>
          <div onClick={() => { setDeptFilter(dept); setTab('directory'); setSelectedDept(dept) }}>
           <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
            <div style={{ fontWeight:700, fontSize:'14px', cursor:'pointer' }}>{deptIcon} {dept}</div>
            {visitCounts[dept] > 0 && (
             <span style={{ background:'#EEF2FF', color:'#3B4FD8', fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'99px', whiteSpace:'nowrap' }}>
              ↗ {visitCounts[dept]} incoming
             </span>
            )}
           </div>
           <div style={{ fontSize:'12px', color:C.sub }}>{info.active} active of {info.total} total</div>
           {departmentRecord ? (
            <div style={{ marginTop:'8px', fontSize:'11px', color:C.sub }}>{departmentRecord.type || 'department'}{departmentRecord.description ? ` · ${departmentRecord.description}` : ''}</div>
           ) : (
            <div style={{ marginTop:'8px', fontSize:'11px', color:C.warn }}>Legacy staff assignment only. This department is view-only here until it is configured in the shared departments data.</div>
           )}
           {Object.entries(info.cats).slice(0, 3).map(([cat, count]) => (
            <div key={cat} style={{ marginTop:'8px', fontSize:'12px', color:C.sub }}>{count} × {cat}</div>
           ))}
           {deptStaff.length > 0 ? (
            <div style={{ marginTop:'10px', fontSize:'12px', color:C.sub }}>{deptStaff.slice(0, 3).map((s, idx) => <div key={s.id || idx}>• {s.full_name}</div>)}</div>
           ) : (
            <div style={{ marginTop:'10px', fontSize:'12px', color:C.sub }}>No staff yet. Staff added in Settings → Staff & Users will appear here.</div>
           )}
           {visitCounts[dept] > 0 && (
            <div style={{ marginTop:'10px', background:'#F0F4FF', border:'1.5px solid #C7D7FD', borderRadius:'8px', padding:'10px 12px' }}>
             <div style={{ fontSize:'11px', fontWeight:700, color:'#3B4FD8', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'4px' }}>📋 Referred Patients in Queue</div>
             <div style={{ fontSize:'12px', color:'#1e3a8a' }}><strong>{visitCounts[dept]}</strong> patient{visitCounts[dept] > 1 ? 's are' : ' is'} currently routed to this department. Open the department page to review and consult.</div>
            </div>
           )}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'8px', marginTop:'12px' }}>
           <button type="button" style={{...css.btn,...css.btnGhost,fontSize:'11px',padding:'6px 10px'}} onClick={() => onNavigateDepartment?.(dept)} disabled={!departmentRecord} title={!departmentRecord ? 'This department is not available as a detailed department page yet.' : ''}>Open department page</button>
           <button type="button" style={{...css.btn,...css.btnGhost,fontSize:'11px',padding:'6px 10px'}} onClick={() => { setDeptFilter(dept); setTab('directory'); setSelectedDept(dept) }}>View in directory</button>
           {deptStaff.length === 0 && (
            <div style={{ fontSize:'11px', color:C.sub, display:'flex', alignItems:'center' }}>
             New staff for this department are added from Settings → Staff & Users.
            </div>
           )}
          </div>
         </div>
        )
       })}
       {deptSummary.length === 0 && (
        <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'60px', color:C.muted }}>
         <div style={{ fontSize:'36px' }}></div>
         <div style={{ marginTop:'10px' }}>No department data yet. Add a department first, then assign staff to it.</div>
        </div>
       )}
      </div>
     </div>
    )}

    {/* ════ TAB: ON DUTY TODAY ════ */}
    {tab === 'onduty' && (
     <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'16px' }}>
       {[
        { shift:'Day (07:00–19:00)', icon:'☀', color:C.blue, colorL:C.blueL },
        { shift:'Night (19:00–07:00)', icon:'🌙', color:C.purple, colorL:C.purpleL },
        { shift:'On Call', icon:'📟', color:C.warn, colorL:C.warnL },
       ].map(({ shift, icon, color, colorL }) => {
        const group = staff.filter(s => s.current_shift === shift && s.status === 'Active')
        return (
         <div key={shift} style={{...css.card, border:`1px solid ${color}22`, marginBottom:0}}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}`, background:colorL, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
           <span style={{ fontWeight:700, fontSize:'13px', color }}>{icon} {shift}</span>
           <span style={{ fontWeight:800, fontSize:'18px', color }}>{group.length}</span>
          </div>
          <div style={{ maxHeight:'220px', overflowY:'auto' }}>
           {group.length === 0
            ? <div style={{ padding:'16px', textAlign:'center', color:C.muted, fontSize:'12px' }}>No staff on this shift</div>
            : group.map(s => (
             <div key={s.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 14px', borderBottom:`1px solid ${C.border}` }}>
              <Avatar name={s.full_name} size={28} cat={s.role_category} />
              <div style={{ flex:1, minWidth:0 }}>
               <div style={{ fontWeight:600, fontSize:'12px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.full_name}</div>
               <div style={{ fontSize:'10px', color:C.sub }}>{s.role}</div>
              </div>
             </div>
            ))}
          </div>
         </div>
        )
       })}
      </div>
      <div style={css.card}>
       <div style={{ padding:'10px 16px', borderBottom:`1px solid ${C.border}`, fontWeight:600, fontSize:'13px', background:'#FAFBFD' }}>⬜ Off Duty / Not Scheduled — {staff.filter(s => !s.current_shift || s.current_shift === 'Off Duty').length} staff</div>
       <table style={css.table}>
        <thead><tr>{['Name','Role','Department','Status',''].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
        <tbody>
         {staff.filter(s => !s.current_shift || s.current_shift === 'Off Duty').map(s => (
          <tr key={s.id} onMouseEnter={e => e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e => e.currentTarget.style.background=''}>
           <td style={css.td}><div style={{ display:'flex', alignItems:'center', gap:'8px' }}><Avatar name={s.full_name} size={28} cat={s.role_category} /><span style={{ fontWeight:600, fontSize:'12px' }}>{s.full_name}</span></div></td>
           <td style={{...css.td, fontSize:'12px', color:C.sub}}>{s.role}</td>
           <td style={{...css.td, fontSize:'12px'}}>{s.department}</td>
           <td style={css.td}><span style={{...css.badge, ...statusStyle(s.status)}}>{s.status}</span></td>
           <td style={css.td}><select style={{...css.select, fontSize:'11px', padding:'4px 8px'}} value={s.current_shift || 'Off Duty'} onChange={e => updateShift(s.id, e.target.value)}>{SHIFT_OPTIONS.map(o => <option key={o}>{o}</option>)}</select></td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </>
    )}

    {/* ════ TAB: LEAVE ════ */}
    {tab === 'leave' && (
     <>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'14px' }}>
       <button style={{...css.btn,...css.btnPri}} onClick={() => setLeaveForm({ staff_id:'', leave_type:'Annual Leave', start_date:'', end_date:'', reason:'' })}>+ Request Leave</button>
      </div>
      <div style={css.card}>
       <div style={{ padding:'10px 16px', borderBottom:`1px solid ${C.border}`, fontWeight:600, fontSize:'13px', background:'#FAFBFD' }}>Leave Records</div>
       <table style={css.table}>
        <thead><tr>{['Staff','Leave Type','From','To','Days','Reason','Status'].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
        <tbody>
         {leaves.length === 0 && <tr><td colSpan={7} style={{...css.td, textAlign:'center', color:C.muted, padding:'40px'}}>No leave records yet.</td></tr>}
         {leaves.map(l => {
          const member = staff.find(s => s.id === l.staff_id)
          const days = l.working_days ?? (l.start_date && l.end_date ? Math.ceil((new Date(l.end_date) - new Date(l.start_date)) / 86400000) + 1 : '—')
          return (
           <tr key={l.id} onMouseEnter={e => e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e => e.currentTarget.style.background=''}>
            <td style={css.td}><div style={{ fontWeight:600 }}>{member?.full_name || 'Unknown'}</div><div style={{ fontSize:'11px', color:C.sub }}>{member?.role}</div></td>
            <td style={css.td}><span style={{...css.badge, background:C.blueL, color:C.blue}}>{l.leave_type}</span></td>
            <td style={{...css.td, fontSize:'12px', color:C.sub}}>{l.start_date || '—'}</td>
            <td style={{...css.td, fontSize:'12px', color:C.sub}}>{l.end_date || '—'}</td>
            <td style={{...css.td, fontWeight:700}}>{days}</td>
            <td style={{...css.td, fontSize:'12px', color:C.sub, maxWidth:'180px'}}>{l.reason || '—'}</td>
            <td style={css.td}><LeaveStatusCell leave={l} canDecide={canDecideLeave} onChanged={fetchAll} /></td>
           </tr>
          )
         })}
        </tbody>
       </table>
      </div>
     </>
    )}

   </div>

   {/* Leave Modal */}
   {leaveForm && (
    <div style={css.overlay} onClick={() => setLeaveForm(null)}>
     <div style={{...css.modal, width:'460px', height:'auto'}} onClick={e => e.stopPropagation()}>
      <div style={{ padding:'18px 24px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
       <div style={css.modalH}>🌴 Leave Request</div>
       <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={() => setLeaveForm(null)} aria-label="Close" title="Close">✕</button>
      </div>
      <div style={{ padding:'20px 24px' }}>
       <label style={css.lbl}>Staff Member *</label>
       <select style={css.input} value={leaveForm.staff_id} onChange={e => setLeaveForm(f => ({...f, staff_id: e.target.value}))}>
        <option value="">— Select Staff —</option>
        {staff.filter(s => s.status === 'Active').map(s => <option key={s.id} value={s.id}>{s.full_name} — {s.role}</option>)}
       </select>
       <label style={css.lbl}>Leave Type</label>
       <select style={css.input} value={leaveForm.leave_type} onChange={e => setLeaveForm(f => ({...f, leave_type: e.target.value}))}>
        {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
       </select>
       <LeaveBalances hospitalId={hospitalId} staffId={leaveForm.staff_id} />
       <div style={css.grid2}>
        <div><label style={css.lbl}>From *</label><input style={css.input} type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({...f, start_date: e.target.value}))} /></div>
        <div><label style={css.lbl}>To *</label><input style={css.input} type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({...f, end_date: e.target.value}))} /></div>
       </div>
       <label style={css.lbl}>Reason</label>
       <textarea style={{...css.input, height:'60px', resize:'vertical'}} placeholder="Brief reason for leave..." value={leaveForm.reason} onChange={e => setLeaveForm(f => ({...f, reason: e.target.value}))} />
       <div style={{ display:'flex', gap:'8px', marginTop:'4px' }}>
        <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={() => setLeaveForm(null)}>Cancel</button>
        <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={() => { if (!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date) return notifyWarning('Fill in all required fields.'); saveLeave(leaveForm) }}>Request leave</button>
       </div>
      </div>
     </div>
    </div>
   )}

   {showModal && <StaffModal staff={editStaff} allStaff={staff} departmentOptions={departmentOptions} onClose={() => { setShowModal(false); setEditStaff(null) }} onSave={handleSave} saving={saving} />}
   {viewStaff && <ViewModal s={viewStaff} allStaff={staff} onClose={() => setViewStaff(null)} onEdit={() => { setEditStaff(viewStaff); setViewStaff(null); setShowModal(true) }} />}
   <DepartmentModal visible={showDeptModal} form={departmentForm} onClose={() => setShowDeptModal(false)} onChange={(key, value) => setDepartmentForm(f => ({ ...f, [key]: value }))} onSave={handleSaveDepartment} saving={deptSaving} />

  </div>
 )
}

export function useStaffByRole(hospitalId) {
 const [staff, setStaff] = useState([])
 useEffect(() => {
  if (!hospitalId) return
  supabase.from('staff').select('id,full_name,role,role_category,department')
   .eq('hospital_id', hospitalId).eq('status', 'Active').order('full_name')
   .then(({ data }) => setStaff(data || []))
 }, [hospitalId])
 return {
  allActive: staff,
  doctors: staff.filter(s => s.role_category === 'Doctors & Clinical Officers'),
  nurses: staff.filter(s => s.role_category === 'Nursing'),
  pharmacists: staff.filter(s => s.role_category === 'Pharmacy'),
  labTechs: staff.filter(s => s.role_category === 'Laboratory'),
  alliedHealth: staff.filter(s => s.role_category === 'Allied Health'),
  byDept: dept => staff.filter(s => s.department === dept),
 }
}
