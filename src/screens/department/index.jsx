import { useEffect, useMemo, useState, useCallback } from 'react'
import supabase from '../../supabase'
import { canPerformAction } from '../../access'
import { useHospital } from '../../context'
import { canonicalizePrescriptionDrug, findInventoryMatch } from '../../utils/pharmacy'
import { getLabTestsForCategory, LAB_TEST_CATEGORIES } from '../../utils/labCatalog'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'
import DepartmentBeds from './DepartmentBeds'
import DepartmentHeader from './DepartmentHeader'
import DepartmentMetrics from './DepartmentMetrics'
import DepartmentStaff from './DepartmentStaff'

// ─────────────────────────────────────────────────────────────
// DEPARTMENTS NOW STORED IN DATABASE
// Fallback config for unknown departments
// ─────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = { type: 'admin', icon: '🏢', color: '#374151', bg: '#F9FAFB', dataSources: ['staff'], uiSections: ['staff_full'], description: '', canRefer: true, canOrderLab: true, canPrescribe: true }

export const DEPARTMENT_CONFIG = {
  // ── CLINICAL ──────────────────────────────────────────────
  'OPD / Outpatient': {
    type: 'clinical',
    icon: '🩺',
    color: '#2563EB',
    bg: '#EFF6FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'referrals_out', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Initial patient assessment, consultation, and routing hub.',
  },
  'Emergency': {
    type: 'clinical',
    icon: '🚨',
    color: '#DC2626',
    bg: '#FEF2F2',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'triage', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Triage, stabilization, and emergency interventions.',
  },
  'Inpatient / Wards': {
    type: 'clinical',
    icon: '🛏️',
    color: '#7C3AED',
    bg: '#F5F3FF',
    dataSources: ['visits', 'admissions', 'staff'],
    uiSections: ['admitted_patients', 'visit_queue', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Admitted patient care, monitoring, and discharge planning.',
  },
  'Theatre / Surgery': {
    type: 'clinical',
    icon: '🔬',
    color: '#0891B2',
    bg: '#ECFEFF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['surgical_queue', 'visit_queue', 'staff'],
    canRefer: false,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Surgical scheduling, pre-op and post-op patient management.',
  },
  'Maternity': {
    type: 'clinical',
    icon: '🤱',
    color: '#DB2777',
    bg: '#FDF2F8',
    dataSources: ['visits', 'admissions', 'staff'],
    uiSections: ['admitted_patients', 'visit_queue', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Antenatal, delivery, and postnatal care.',
  },
  'Paediatrics': {
    type: 'clinical',
    icon: '👶',
    color: '#059669',
    bg: '#ECFDF5',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Child and infant medical care.',
  },
  'Cardiology': {
    type: 'clinical',
    icon: '❤️',
    color: '#DC2626',
    bg: '#FEF2F2',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Heart and cardiovascular care.',
  },
  'Dental': {
    type: 'clinical',
    icon: '🦷',
    color: '#F97316',
    bg: '#FFF7ED',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Dental care, oral surgery, and preventive dentistry.',
  },
  'Physiotherapy': {
    type: 'clinical',
    icon: '🦾',
    color: '#9333EA',
    bg: '#F5F3FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: false,
    description: 'Rehabilitation and physical therapy services.',
  },
  'Nutrition & Dietetics': {
    type: 'clinical',
    icon: '🥗',
    color: '#0F766E',
    bg: '#ECFDF5',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: false,
    canPrescribe: false,
    description: 'Nutritional assessment, therapeutic diets, and dietary counseling.',
  },
  'Mental Health & Psychiatry': {
    type: 'clinical',
    icon: '🧠',
    color: '#7C3AED',
    bg: '#EEF2FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Psychiatric assessment, therapy, and mental health support.',
  },
  'Eye Clinic': {
    type: 'clinical',
    icon: '👁️',
    color: '#2563EB',
    bg: '#EFF6FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Eye care, vision screening, and ophthalmic services.',
  },
  'Community Health': {
    type: 'clinical',
    icon: '🌍',
    color: '#059669',
    bg: '#ECFDF5',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: false,
    description: 'Community outreach, preventive care, and public health services.',
  },
  'General Medicine': {
    type: 'clinical',
    icon: '🩺',
    color: '#0369A1',
    bg: '#F0F9FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'General internal medicine, diagnosis and management of adult conditions.',
  },
  'Surgery': {
    type: 'clinical',
    icon: '🔪',
    color: '#BE185D',
    bg: '#FDF2F8',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Surgical assessment, pre-op preparation, and post-operative care.',
  },
  'Orthopaedics': {
    type: 'clinical',
    icon: '🦴',
    color: '#B45309',
    bg: '#FFFBEB',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Bone, joint, and musculoskeletal disorders.',
  },
  'ENT': {
    type: 'clinical',
    icon: '👂',
    color: '#0F766E',
    bg: '#F0FDFA',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Ear, nose, and throat assessment and treatment.',
  },
  'Ophthalmology': {
    type: 'clinical',
    icon: '👁️',
    color: '#4F46E5',
    bg: '#EEF2FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Eye disease diagnosis and ophthalmic surgery.',
  },
  'Dermatology': {
    type: 'clinical',
    icon: '🫶',
    color: '#D97706',
    bg: '#FFFBEB',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Skin, hair, and nail conditions.',
  },
  'Neurology': {
    type: 'clinical',
    icon: '🧠',
    color: '#7C3AED',
    bg: '#F5F3FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Nervous system disorders including brain, spine, and peripheral nerves.',
  },
  'Psychiatry': {
    type: 'clinical',
    icon: '💭',
    color: '#0891B2',
    bg: '#ECFEFF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Psychiatric evaluation, diagnosis, and mental health treatment.',
  },
  'Oncology': {
    type: 'clinical',
    icon: '🎗️',
    color: '#BE123C',
    bg: '#FFF1F2',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Cancer diagnosis, treatment planning, and chemotherapy management.',
  },
  'Urology': {
    type: 'clinical',
    icon: '🫀',
    color: '#1D4ED8',
    bg: '#EFF6FF',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Urinary tract and male reproductive system disorders.',
  },
  'Obstetrics & Gynaecology': {
    type: 'clinical',
    icon: '🤰',
    color: '#DB2777',
    bg: '#FDF2F8',
    dataSources: ['visits', 'consultations', 'staff'],
    uiSections: ['visit_queue', 'consultations', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Obstetric and gynaecological care for women.',
  },
  'ICU / HDU': {
    type: 'clinical',
    icon: '🚨',
    color: '#DC2626',
    bg: '#FEF2F2',
    dataSources: ['visits', 'admissions', 'staff'],
    uiSections: ['admitted_patients', 'visit_queue', 'staff'],
    canRefer: true,
    canOrderLab: true,
    canPrescribe: true,
    description: 'Intensive and high-dependency care for critically ill patients.',
  },

  // ── DIAGNOSTIC ────────────────────────────────────────────
  'Laboratory': {
    type: 'diagnostic',
    icon: '🧪',
    color: '#D97706',
    bg: '#FFFBEB',
    dataSources: ['lab_tests', 'staff'],
    uiSections: ['lab_queue', 'completed_tests', 'staff'],
    canPostResults: true,
    description: 'Blood, urine, and specimen analysis.',
    testFilter: (t) => {
      const cat = (t.category || '').toLowerCase()
      const type = (t.test_type || '').toLowerCase()
      return cat !== 'radiology' && !type.includes('x-ray') && !type.includes('ct scan') && !type.includes('mri') && !type.includes('ultrasound')
    },
  },
  'Radiology & Imaging': {
    type: 'diagnostic',
    icon: '🩻',
    color: '#6366F1',
    bg: '#EEF2FF',
    dataSources: ['lab_tests', 'staff'],
    uiSections: ['imaging_queue', 'completed_tests', 'staff'],
    canPostResults: true,
    description: 'X-ray, CT, MRI, and ultrasound imaging.',
    testFilter: (t) => {
      const cat = (t.category || '').toLowerCase()
      const type = (t.test_type || '').toLowerCase()
      return cat === 'radiology' || type.includes('x-ray') || type.includes('ct') || type.includes('mri') || type.includes('ultrasound')
    },
  },

  // ── PHARMACY ──────────────────────────────────────────────
  'Pharmacy': {
    type: 'pharmacy',
    icon: '💊',
    color: '#16A34A',
    bg: '#F0FDF4',
    dataSources: ['prescriptions', 'staff'],
    uiSections: ['prescription_queue', 'dispensed', 'staff'],
    canDispense: true,
    description: 'Prescription fulfillment, stock management, dispensing.',
  },

  // ── ADMIN / SUPPORT ───────────────────────────────────────
  'Human Resources': {
    type: 'admin',
    icon: '👥',
    color: '#0369A1',
    bg: '#F0F9FF',
    dataSources: ['staff'],
    uiSections: ['staff_full', 'roles', 'shifts'],
    description: 'Staff records, scheduling, and HR management.',
  },
  'Finance & Billing': {
    type: 'admin',
    icon: '💰',
    color: '#B45309',
    bg: '#FFFBEB',
    dataSources: ['invoices', 'staff'],
    uiSections: ['billing_summary', 'invoices_table', 'staff'],
    description: 'Invoices, payments, and financial reconciliation.',
  },
  'Administration': {
    type: 'admin',
    icon: '🏢',
    color: '#374151',
    bg: '#F9FAFB',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'Hospital administration and office management.',
  },

  // ── SUPPORT SERVICES ──────────────────────────────────────
  'Transport': {
    type: 'support',
    icon: '🚐',
    color: '#0891B2',
    bg: '#ECFEFF',
    dataSources: ['transport_requests', 'staff'],
    uiSections: ['transport_queue', 'staff'],
    description: 'Patient transfers, ambulance dispatch, and vehicle management.',
  },
  'Kitchen / Catering': {
    type: 'support',
    icon: '🍽️',
    color: '#EA580C',
    bg: '#FFF7ED',
    dataSources: ['meal_orders', 'staff'],
    uiSections: ['meal_queue', 'staff'],
    description: 'Patient meal planning and dietary services.',
  },
  'Housekeeping': {
    type: 'support',
    icon: '🧹',
    color: '#65A30D',
    bg: '#F7FEE7',
    dataSources: ['cleaning_tasks', 'staff'],
    uiSections: ['cleaning_queue', 'staff'],
    description: 'Ward cleaning, linen management, and sanitation.',
  },
  'Maintenance & Engineering': {
    type: 'support',
    icon: '🔧',
    color: '#F97316',
    bg: '#FFFAEB',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'Facility maintenance, repairs, and engineering services.',
  },
  'Medical Records': {
    type: 'admin',
    icon: '🗄️',
    color: '#475569',
    bg: '#F8FAFC',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'Patient record management, archiving, and medical documentation.',
  },
  'IT & Systems': {
    type: 'support',
    icon: '💻',
    color: '#4F46E5',
    bg: '#EEF2FF',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'System maintenance, user support, and infrastructure.',
  },
  'Security': {
    type: 'support',
    icon: '🔐',
    color: '#6B7280',
    bg: '#F9FAFB',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'Hospital security, access control, and incident management.',
  },
  'Mortuary': {
    type: 'support',
    icon: '🏥',
    color: '#374151',
    bg: '#F9FAFB',
    dataSources: ['staff'],
    uiSections: ['staff_full'],
    description: 'Deceased patient handling and documentation.',
  },
}

const aliasMap = {
  'outpatient (opd)': 'OPD / Outpatient',
  'emergency & casualty': 'Emergency',
  'inpatient — medical ward': 'Inpatient / Wards',
  'inpatient — surgical ward': 'Inpatient / Wards',
  'inpatient — paediatric ward': 'Paediatrics',
  'maternity & labour ward': 'Maternity',
  'icu / hdu': 'ICU / HDU',
  'finance & accounts': 'Finance & Billing',
  'kitchen & catering': 'Kitchen / Catering',
  'housekeeping & laundry': 'Housekeeping',
  'maintenance & engineering': 'Maintenance & Engineering',
  'medical records': 'Medical Records',
  'community health': 'Community Health',
  'nutrition & dietetics': 'Nutrition & Dietetics',
  'mental health & psychiatry': 'Mental Health & Psychiatry',
  'dental': 'Dental',
  'dentistry': 'Dental',
  'eye clinic': 'Eye Clinic',
  'eye / optical': 'Eye Clinic',
  'ophthalmology': 'Ophthalmology',
  'physiotherapy': 'Physiotherapy',
  'general medicine': 'General Medicine',
  'surgery': 'Surgery',
  'orthopaedics': 'Orthopaedics',
  'ent': 'ENT',
  'dermatology': 'Dermatology',
  'neurology': 'Neurology',
  'psychiatry': 'Psychiatry',
  'oncology': 'Oncology',
  'urology': 'Urology',
  'obstetrics & gynaecology': 'Obstetrics & Gynaecology',
  'obs & gynae': 'Obstetrics & Gynaecology',
  'obstetrics and gynaecology': 'Obstetrics & Gynaecology',
}

const reverseAliasMap = {
  'OPD / Outpatient': ['Outpatient (OPD)'],
  'Emergency': ['Emergency & Casualty'],
  'Inpatient / Wards': ['Inpatient — Medical Ward', 'Inpatient — Surgical Ward', 'ICU / HDU'],
  'Paediatrics': ['Inpatient — Paediatric Ward'],
  'Maternity': ['Maternity & Labour Ward'],
  'Finance & Billing': ['Finance & Accounts'],
  'Kitchen / Catering': ['Kitchen & Catering'],
  'Housekeeping': ['Housekeeping & Laundry'],
}

function normalizeDepartment(department) {
  if (!department) return department
  return aliasMap[department.trim().toLowerCase()] || department
}

function getDepartmentSearchKeys(department) {
  const normalized = normalizeDepartment(department)
  const keys = new Set([department, normalized])
  const reverse = reverseAliasMap[normalized]
  if (reverse) reverse.forEach(alias => keys.add(alias))
  return Array.from(keys)
}

function isVisitForDepartment(department, visit) {
  const dept = normalizeDepartment(department).toLowerCase()
  const status = (visit.status || '').toLowerCase()
  const speciality = (visit.speciality || '').toLowerCase()

  if (dept === 'opd / outpatient') return ['doctor', 'opd'].includes(status) || speciality === 'general'
  if (dept === 'emergency') return status === 'emergency'
  if (dept === 'inpatient / wards') return status === 'admitted' || status === 'admission requested'
  if (dept === 'icu / hdu') return status === 'icu' || speciality === 'icu / hdu' || speciality === 'icu'
  if (dept === 'theatre / surgery') return status === 'theatre'
  if (dept === 'maternity') return status === 'maternity' || speciality === 'maternity'
  if (dept === 'paediatrics') return status === 'paediatrics' || speciality === 'paediatrics'
  if (dept === 'laboratory') return status === 'lab' || speciality === 'laboratory'
  if (dept === 'radiology & imaging') return speciality === 'radiology' || (status === 'referred' && speciality === 'radiology & imaging')
  if (dept === 'pharmacy') return status === 'pharmacy' || speciality === 'pharmacy'
  if (['human resources', 'finance & billing', 'administration', 'security', 'it & systems', 'mortuary', 'transport', 'kitchen / catering', 'housekeeping'].includes(dept)) return false

  // For all specialist departments (Surgery, Orthopaedics, ENT, Cardiology, etc.)
  // A patient is in their queue when status is 'referred' or 'doctor' AND speciality matches this dept
  const deptName = normalizeDepartment(department).toLowerCase()
  return speciality === deptName || status === deptName || (status === 'referred' && speciality === deptName) || (status === 'doctor' && speciality === deptName)
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const css = {
  page: { minHeight: '100vh', background: '#F4F6FB', fontFamily: "'DM Sans','Segoe UI',sans-serif", color: '#111827' },
  wrap: { padding: '20px 24px', maxWidth: '1300px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' },
  titleRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  iconBox: (bg, color) => ({ width: '48px', height: '48px', borderRadius: '12px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', border: `1.5px solid ${color}20` }),
  h1: { fontSize: '22px', fontWeight: 700, margin: 0 },
  subtext: { fontSize: '12px', color: '#6B7280', marginTop: '4px' },
  typeBadge: (bg, color) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', background: bg, color: color, fontSize: '11px', fontWeight: 600, marginTop: '6px', textTransform: 'uppercase', letterSpacing: '.5px' }),
  backBtn: { padding: '8px 16px', borderRadius: '8px', border: '1.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginBottom: '20px' },
  statCard: (accent) => ({ background: '#fff', border: `1.5px solid ${accent}30`, borderRadius: '12px', padding: '16px 18px', borderLeft: `4px solid ${accent}` }),
  statNum: { fontSize: '28px', fontWeight: 800, lineHeight: 1.1 },
  statLbl: { fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: '4px' },
  card: { background: '#fff', border: '1px solid #E8ECF2', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' },
  sectionTitle: { fontWeight: 700, fontSize: '14px', marginBottom: '4px' },
  sectionNote: { fontSize: '12px', color: '#6B7280', marginBottom: '14px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '9px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', borderBottom: '2px solid #E8ECF2', background: '#F8FAFC' },
  td: { padding: '11px 14px', borderBottom: '1px solid #F3F4F6', fontSize: '13px' },
  statusPill: (color, bg) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', background: bg, color: color, fontSize: '11px', fontWeight: 600 }),
  emptyBox: { textAlign: 'center', padding: '40px 20px', color: '#9CA3AF' },
  emptyIcon: { fontSize: '36px', marginBottom: '8px' },
  emptyText: { fontSize: '13px' },
  divider: { borderBottom: '1px solid #F3F4F6', margin: '16px 0' },
  roleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F9FAFB' },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '10px' },
  infoItem: { background: '#F8FAFC', borderRadius: '8px', padding: '10px 14px' },
  infoLabel: { fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.5px' },
  infoValue: { fontSize: '14px', fontWeight: 600, marginTop: '2px' },
}

function StatusPill({ status }) {
  const map = {
    'Active': ['#16A34A', '#F0FDF4'],
    'Pending': ['#D97706', '#FFFBEB'],
    'Completed': ['#2563EB', '#EFF6FF'],
    'Released': ['#7C3AED', '#F5F3FF'],
    'Admitted': ['#0891B2', '#ECFEFF'],
    'Referred': ['#6366F1', '#EEF2FF'],
    'Lab': ['#D97706', '#FFFBEB'],
    'Pharmacy': ['#16A34A', '#F0FDF4'],
    'Doctor': ['#374151', '#F3F4F6'],
  }
  const [color, bg] = map[status] || ['#6B7280', '#F3F4F6']
  return <span style={css.statusPill(color, bg)}>{status || '—'}</span>
}

function EmptyState({ icon, message }) {
  return (
    <div style={css.emptyBox}>
      <div style={css.emptyIcon}>{icon}</div>
      <div style={css.emptyText}>{message}</div>
    </div>
  )
}

function SectionCard({ title, note, children }) {
  return (
    <div style={css.card}>
      <div style={css.sectionTitle}>{title}</div>
      {note && <div style={css.sectionNote}>{note}</div>}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SECTION COMPONENTS
// ─────────────────────────────────────────────────────────────

function StaffSection({ staff, full = false }) {
  const roles = useMemo(() => {
    const map = {}
    staff.forEach(s => {
      const r = s.role_category || 'Unassigned'
      if (!map[r]) map[r] = []
      map[r].push(s)
    })
    return map
  }, [staff])

  if (staff.length === 0) return <EmptyState icon="👥" message="No staff assigned to this department." />

  if (!full) {
    return (
      <table style={css.table}>
        <thead>
          <tr>
            <th style={css.th}>Name</th>
            <th style={css.th}>Role</th>
            <th style={css.th}>Status</th>
            <th style={css.th}>Shift</th>
          </tr>
        </thead>
        <tbody>
          {staff.map(s => (
            <tr key={s.id}>
              <td style={css.td}>{s.full_name}</td>
              <td style={css.td}>{s.job_title || s.role || '—'}</td>
              <td style={css.td}><StatusPill status={s.status} /></td>
              <td style={css.td}>{s.current_shift || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <>
      {Object.entries(roles).map(([role, members]) => (
        <div key={role} style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '6px' }}>{role} ({members.length})</div>
          <table style={css.table}>
            <thead>
              <tr>
                <th style={css.th}>Name</th>
                <th style={css.th}>Job Title</th>
                <th style={css.th}>Status</th>
                <th style={css.th}>Shift</th>
                <th style={css.th}>Phone</th>
              </tr>
            </thead>
            <tbody>
              {members.map(s => (
                <tr key={s.id}>
                  <td style={css.td}>{s.full_name}</td>
                  <td style={css.td}>{s.job_title || '—'}</td>
                  <td style={css.td}><StatusPill status={s.status} /></td>
                  <td style={css.td}>{s.current_shift || '—'}</td>
                  <td style={css.td}>{s.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

function VisitQueueSection({ visits, invoices, department }) {
  if (visits.length === 0) return <EmptyState icon="🏥" message="No patients currently in queue." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Visit ID</th>
          <th style={css.th}>Patient</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Speciality</th>
          <th style={css.th}>Doctor</th>
          <th style={css.th}>Billing Balance</th>
        </tr>
      </thead>
      <tbody>
        {visits.map(v => {
          const vid = v.visit_id || v.id
          const inv = invoices.filter(i => i.visit_id === vid)
          const balance = inv.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0)
          return (
            <tr key={v.id}>
              <td style={{ ...css.td, fontFamily: 'monospace', fontSize: '12px' }}>{vid}</td>
              <td style={css.td}>{v.patient_name || v.patient_id || '—'}</td>
              <td style={css.td}><StatusPill status={v.status} /></td>
              <td style={css.td}>{v.speciality || '—'}</td>
              <td style={css.td}>{v.assigned_doctor_name || '—'}</td>
              <td style={{ ...css.td, fontWeight: 600, color: balance > 0 ? '#DC2626' : '#16A34A' }}>
                KES {balance.toLocaleString()}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ConsultationsSection({ consultations }) {
  if (consultations.length === 0) return <EmptyState icon="🩺" message="No consultations recorded." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Patient</th>
          <th style={css.th}>Doctor</th>
          <th style={css.th}>Disposition</th>
          <th style={css.th}>Refer To</th>
          <th style={css.th}>Date</th>
        </tr>
      </thead>
      <tbody>
        {consultations.map(c => (
          <tr key={c.id}>
            <td style={css.td}>{c.patient_name || c.patient_id || '—'}</td>
            <td style={css.td}>{c.doctor_name || '—'}</td>
            <td style={css.td}><StatusPill status={c.disposition} /></td>
            <td style={css.td}>{c.refer_to || '—'}</td>
            <td style={{ ...css.td, color: '#9CA3AF', fontSize: '12px' }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LabQueueSection({ labOrders, label = 'Lab' }) {
  if (labOrders.length === 0) return <EmptyState icon="🧪" message={`No ${label.toLowerCase()} orders pending.`} />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Patient</th>
          <th style={css.th}>Test</th>
          <th style={css.th}>Category</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Ordered At</th>
          <th style={css.th}>Result</th>
        </tr>
      </thead>
      <tbody>
        {labOrders.map(t => (
          <tr key={t.id}>
            <td style={css.td}>{t.patient_name || '—'}</td>
            <td style={css.td}>{t.test_type || '—'}</td>
            <td style={css.td}>{t.category || '—'}</td>
            <td style={css.td}><StatusPill status={t.status} /></td>
            <td style={{ ...css.td, color: '#9CA3AF', fontSize: '12px' }}>{t.ordered_at ? new Date(t.ordered_at).toLocaleDateString() : '—'}</td>
            <td style={{ ...css.td, color: t.result ? '#16A34A' : '#9CA3AF' }}>{t.result || 'Awaiting'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PharmacySection({ orders }) {
  if (orders.length === 0) return <EmptyState icon="💊" message="No prescriptions pending dispensing." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Patient</th>
          <th style={css.th}>Drug</th>
          <th style={css.th}>Dosage</th>
          <th style={css.th}>Qty</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Prescribed By</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(rx => (
          <tr key={rx.id}>
            <td style={css.td}>{rx.patient_name || '—'}</td>
            <td style={css.td}>{rx.drug_name || '—'}</td>
            <td style={css.td}>{rx.dosage || '—'}</td>
            <td style={css.td}>{rx.quantity || '—'}</td>
            <td style={css.td}><StatusPill status={rx.status || 'Pending'} /></td>
            <td style={css.td}>{rx.prescribed_by || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BillingSummarySection({ invoices }) {
  const total = invoices.reduce((s, i) => s + (Number(i.amount_kes) || 0), 0)
  const paid = invoices.reduce((s, i) => s + (Number(i.paid_kes) || 0), 0)
  const balance = invoices.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0)
  const unpaid = invoices.filter(i => (Number(i.balance_kes) || 0) > 0).length

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Billed', value: `KES ${total.toLocaleString()}`, color: '#2563EB' },
          { label: 'Paid', value: `KES ${paid.toLocaleString()}`, color: '#16A34A' },
          { label: 'Outstanding', value: `KES ${balance.toLocaleString()}`, color: '#DC2626' },
          { label: 'Unpaid Invoices', value: unpaid, color: '#D97706' },
        ].map(s => (
          <div key={s.label} style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: s.color, marginTop: '4px' }}>{s.value}</div>
          </div>
        ))}
      </div>
      {invoices.length === 0
        ? <EmptyState icon="💰" message="No invoices found." />
        : (
          <table style={css.table}>
            <thead>
              <tr>
                <th style={css.th}>Invoice ID</th>
                <th style={css.th}>Visit ID</th>
                <th style={css.th}>Patient</th>
                <th style={css.th}>Amount</th>
                <th style={css.th}>Paid</th>
                <th style={css.th}>Balance</th>
                <th style={css.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td style={{ ...css.td, fontFamily: 'monospace', fontSize: '12px' }}>{inv.invoice_number || inv.id}</td>
                  <td style={{ ...css.td, fontFamily: 'monospace', fontSize: '12px' }}>{inv.visit_id || '—'}</td>
                  <td style={css.td}>{inv.patient_name || inv.patient_id || '—'}</td>
                  <td style={css.td}>KES {Number(inv.amount_kes || 0).toLocaleString()}</td>
                  <td style={{ ...css.td, color: '#16A34A' }}>KES {Number(inv.paid_kes || 0).toLocaleString()}</td>
                  <td style={{ ...css.td, color: Number(inv.balance_kes) > 0 ? '#DC2626' : '#16A34A', fontWeight: 600 }}>KES {Number(inv.balance_kes || 0).toLocaleString()}</td>
                  <td style={css.td}><StatusPill status={inv.status || 'Pending'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  )
}

function TransportSection({ requests }) {
  if (requests.length === 0) return <EmptyState icon="🚐" message="No transport requests pending." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Patient</th>
          <th style={css.th}>From</th>
          <th style={css.th}>To</th>
          <th style={css.th}>Vehicle</th>
          <th style={css.th}>Driver</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Scheduled</th>
        </tr>
      </thead>
      <tbody>
        {requests.map(r => (
          <tr key={r.id}>
            <td style={css.td}>{r.patient_name || r.patient_id || '—'}</td>
            <td style={css.td}>{r.from_location || '—'}</td>
            <td style={css.td}>{r.to_location || '—'}</td>
            <td style={css.td}>{r.vehicle_number || '—'}</td>
            <td style={css.td}>{r.driver_name || '—'}</td>
            <td style={css.td}><StatusPill status={r.status || 'Pending'} /></td>
            <td style={{ ...css.td, color: '#9CA3AF', fontSize: '12px' }}>{r.scheduled_time ? new Date(r.scheduled_time).toLocaleString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MealOrdersSection({ orders }) {
  if (orders.length === 0) return <EmptyState icon="🍽️" message="No meal orders for today." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Patient</th>
          <th style={css.th}>Ward / Bed</th>
          <th style={css.th}>Meal Type</th>
          <th style={css.th}>Diet</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Delivery Time</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td style={css.td}>{o.patient_name || o.patient_id || '—'}</td>
            <td style={css.td}>{o.ward || '—'} / {o.bed_number || '—'}</td>
            <td style={css.td}>{o.meal_type || '—'}</td>
            <td style={css.td}>{o.diet_type || 'Regular'}</td>
            <td style={css.td}><StatusPill status={o.status || 'Pending'} /></td>
            <td style={{ ...css.td, color: '#9CA3AF', fontSize: '12px' }}>{o.delivery_time || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CleaningTasksSection({ tasks }) {
  if (tasks.length === 0) return <EmptyState icon="🧹" message="No cleaning tasks assigned." />
  return (
    <table style={css.table}>
      <thead>
        <tr>
          <th style={css.th}>Location</th>
          <th style={css.th}>Task Type</th>
          <th style={css.th}>Assigned To</th>
          <th style={css.th}>Priority</th>
          <th style={css.th}>Status</th>
          <th style={css.th}>Due</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(t => (
          <tr key={t.id}>
            <td style={css.td}>{t.location || '—'}</td>
            <td style={css.td}>{t.task_type || '—'}</td>
            <td style={css.td}>{t.assigned_to || '—'}</td>
            <td style={css.td}><StatusPill status={t.priority || 'Normal'} /></td>
            <td style={css.td}><StatusPill status={t.status || 'Pending'} /></td>
            <td style={{ ...css.td, color: '#9CA3AF', fontSize: '12px' }}>{t.due_time || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─────────────────────────────────────────────────────────────
// REFERRAL DEPARTMENTS (for further referrals from specialist)
// ─────────────────────────────────────────────────────────────
const REFERRAL_DEPARTMENTS = [
  { group: 'General & Emergency', options: ['General Medicine', 'OPD / Outpatient', 'Emergency'] },
  { group: 'Medical Specialties', options: ['Cardiology', 'Neurology', 'Dermatology', 'Psychiatry', 'Mental Health & Psychiatry', 'Oncology', 'Urology', 'Paediatrics'] },
  { group: 'Surgical Specialties', options: ['Surgery', 'Orthopaedics', 'ENT', 'Ophthalmology', 'Eye Clinic', 'Theatre / Surgery'] },
  { group: 'Women & Children', options: ['Obstetrics & Gynaecology', 'Maternity', 'Paediatrics'] },
  { group: 'Allied Health', options: ['Physiotherapy', 'Nutrition & Dietetics', 'Community Health', 'Dental'] },
  { group: 'Diagnostic', options: ['Laboratory', 'Radiology & Imaging'] },
  { group: 'Inpatient & Critical Care', options: ['Inpatient / Wards', 'ICU / HDU'] },
  { group: 'Pharmacy', options: ['Pharmacy'] },
]

const DEPT_DISPOSITIONS = ['Send Home','Admit - Inpatient','Refer to Specialist','Send to Lab','Send to Pharmacy','Emergency Admit']

// ─────────────────────────────────────────────────────────────
// SPECIALIST CONSULTATION PANEL
// Full independent clinical workflow for any specialist dept
// ─────────────────────────────────────────────────────────────
function SpecialistConsultationPanel({ visit, hospitalId, department, config, referralGroups, onComplete }) {
  const { userRole } = useHospital()
  const accentColor = config.color || '#0F6E56'
  const accentBg = config.bg || '#E1F5EE'
  const canWriteDiagnosis = canPerformAction(userRole, 'write_diagnosis')

  const [tab, setTab] = useState('consult')
  const [saving, setSaving] = useState(false)

  const emptyForm = {
    doctor_name: '', speciality: department,
    presenting_complaint: '', history: '', examination_findings: '',
    diagnosis: '', icd_code: '', treatment_plan: '', notes: '',
    disposition: '', refer_department: '', refer_to: '', follow_up_date: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [showRx, setShowRx] = useState(false)
  const [showLab, setShowLab] = useState(false)
  const [rxList, setRxList] = useState([{ drug_name: '', dosage: '', frequency: '', duration: '', quantity: '' }])
  const [labOrders, setLabOrders] = useState([{ test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }])
  const [inventory, setInventory] = useState([])
  const [patientLabs, setPatientLabs] = useState([])
  const [patientConsults, setPatientConsults] = useState([])
  const [vitals, setVitals] = useState(null)
  const [wardsList, setWardsList] = useState([])
  const [referWard, setReferWard] = useState('')

  useEffect(() => {
    if (!hospitalId || !visit) return
    // Fetch inventory
    supabase.from('pharmacy_inventory').select('id,drug_name,generic_name,strength,quantity_in_stock')
      .eq('hospital_id', hospitalId).eq('is_active', true).order('drug_name')
      .then(({ data }) => setInventory(data || []))
    // Fetch vitals
    supabase.from('vitals').select('*').eq('visit_id', visit.id)
      .order('recorded_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setVitals(data || null))
    // Fetch patient's previous labs (returned to this dept or this visit)
    supabase.from('lab_tests').select('*').eq('hospital_id', hospitalId)
      .eq('patient_id', visit.patient_id).order('ordered_at', { ascending: false }).limit(20)
      .then(({ data }) => setPatientLabs(data || []))
    // Fetch patient's previous consultations
    supabase.from('consultations').select('*').eq('hospital_id', hospitalId)
      .eq('patient_id', visit.patient_id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setPatientConsults(data || []))
    // Fetch wards
    supabase.from('wards').select('id,name,ward_type').eq('hospital_id', hospitalId).order('name')
      .then(({ data }) => setWardsList(data || []))
  }, [hospitalId, visit])

  const thisVisitLabs = patientLabs.filter(l => l.visit_id === visit?.id)
  const completedLabs = thisVisitLabs.filter(l => l.status === 'Complete')
  const pendingLabs = thisVisitLabs.filter(l => l.status === 'Pending' || l.status === 'In Progress')

  function updateRx(i, key, val) {
    setRxList(prev => {
      const next = [...prev]
      const row = { ...(next[i] || {}) }
      row[key] = val
      if (key === 'drug_name') {
        const match = findInventoryMatch(val, inventory)
        if (!row.dosage && match?.strength) row.dosage = match.strength
      }
      next[i] = row
      return next
    })
  }

  function stockInfo(name, qty) {
    const match = findInventoryMatch(name, inventory)
    const needed = Number(qty || 1)
    if (!match) return { label: 'No inventory match', color: '#B91C1C' }
    const bal = Number(match.quantity_in_stock || 0)
    if (bal <= 0) return { label: 'Out of stock', color: '#B91C1C' }
    if (bal < needed) return { label: `Low stock — ${bal} available`, color: '#C2410C' }
    return { label: `In stock — ${bal} available`, color: '#16A34A' }
  }

  function interpColor(interp) {
    if (!interp) return null
    const l = interp.toLowerCase()
    if (l.includes('abnormal') || l.includes('positive')) return { bg: '#FCEBEB', color: '#A32D2D' }
    if (l.includes('normal') || l.includes('negative')) return { bg: '#E1F5EE', color: '#0F6E56' }
    return { bg: '#FFF3DC', color: '#C07000' }
  }

  // ── Billing helpers ───────────────────────────────────────────────────────

  function getDeptChargeCode(dept) {
    const map = {
      'Cardiology':                 'CONS-CARDIO',
      'Neurology':                  'CONS-NEURO',
      'Surgery':                    'CONS-SURG',
      'Theatre / Surgery':          'CONS-SURG',
      'Orthopaedics':               'CONS-ORTHO',
      'ENT':                        'CONS-ENT',
      'Ophthalmology':              'CONS-OPHTHAL',
      'Eye Clinic':                 'CONS-OPHTHAL',
      'Dermatology':                'CONS-DERM',
      'Psychiatry':                 'CONS-PSYCH',
      'Mental Health & Psychiatry': 'CONS-PSYCH',
      'Oncology':                   'CONS-ONCO',
      'Urology':                    'CONS-UROL',
      'Obstetrics & Gynaecology':   'CONS-OBGYN',
      'Maternity':                  'CONS-OBGYN',
      'Paediatrics':                'CONS-PAEDS',
      'Dental':                     'CONS-DENTAL',
      'Physiotherapy':              'CONS-PHYSIO',
      'Nutrition & Dietetics':      'CONS-NUTR',
      'General Medicine':           'CONS-GENMED',
      'Emergency':                  'CONS-EMERGENCY',
      'OPD / Outpatient':           'CONS-OPD',
    }
    return map[dept] || 'CONS-OPD'
  }

  async function autoCreateSpecialistInvoice({ consultationId }) {
    try {
      // Skip if already billed for this visit + department
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('hospital_id', hospitalId)
        .eq('visit_id', visit.id)
        .ilike('notes', `WF|${SERVICE_SOURCES.CONSULTATION}|${consultationId}|%`)
        .maybeSingle()

      if (existing) return

      const chargeCode = getDeptChargeCode(department)
      const { data: cc } = await supabase
        .from('charge_codes')
        .select('id, unit_price_kes, name')
        .eq('hospital_id', hospitalId)
        .eq('code', chargeCode)
        .maybeSingle()

      const amount = cc?.unit_price_kes || 0
      const serviceLabel = cc?.name || `${department} Consultation`
      const NON_INSURANCE = ['Cash', 'M-Pesa']
      const payMethod = visit.admission_payment_method || 'Cash'
      const alreadyPaid = 0 // specialist visits don't have upfront admission_fee
      const balance = Math.max(0, amount - alreadyPaid)
      const status = amount === 0 ? 'Pending' : (balance <= 0 ? 'Paid' : 'Pending')

      await supabase.from('invoices').insert({
        hospital_id: hospitalId,
        patient_id: visit.patient_id,
        patient_name: visit.patients?.full_name || visit.patient_name || '',
        visit_id: visit.id,
        invoice_no: `INV-${Date.now().toString().slice(-6)}`,
        services: stringifyServiceLines([createServiceLine({
          label: serviceLabel,
          qty: 1,
          unitPrice: amount,
          total: amount,
          source: SERVICE_SOURCES.CONSULTATION,
          sourceId: consultationId,
          visitId: visit.id,
          meta: { speciality: department, charge_code: chargeCode },
        })]),
        amount_kes: amount,
        paid_kes: alreadyPaid,
        balance_kes: balance,
        payment_method: payMethod,
        insurer: !NON_INSURANCE.includes(payMethod) ? payMethod : null,
        status,
        notes: buildWorkflowInvoiceNote({
          source: SERVICE_SOURCES.CONSULTATION,
          sourceId: consultationId,
          visitId: visit.id,
          summary: serviceLabel,
        }),
        paid_at: status === 'Paid' ? new Date().toISOString() : null,
      })

      try {
        window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
          detail: { visit_id: visit.id, source: 'dept-auto-billing', department },
        }))
      } catch (_) {}
    } catch (e) {
      console.error('autoCreateSpecialistInvoice failed:', e)
    }
  }

  async function handleSave() {
    if (!canWriteDiagnosis) {
      window.notifyFromLegacyAlert('Only doctors and clinical officers can open specialist consultations')
      return
    }
    if (!form.diagnosis) { window.notifyFromLegacyAlert('Diagnosis is required.'); return }
    if (!form.disposition) { window.notifyFromLegacyAlert('Select a disposition.'); return }
    if (!form.doctor_name) { window.notifyFromLegacyAlert('Enter doctor/specialist name.'); return }
    if (form.disposition === 'Refer to Specialist' && !form.refer_department) {
      window.notifyFromLegacyAlert('Select a department to refer to.'); return
    }
    setSaving(true)
    try {
      // 1. Save specialist consultation record
      const { error: cErr } = await supabase.from('consultations').insert({
        hospital_id: hospitalId,
        visit_id: visit.id,
        patient_id: visit.patient_id,
        doctor_name: form.doctor_name,
        speciality: department,
        presenting_complaint: form.presenting_complaint,
        history: form.history,
        examination_findings: form.examination_findings,
        diagnosis: form.diagnosis,
        icd_code: form.icd_code,
        treatment_plan: form.treatment_plan,
        notes: form.notes,
        disposition: form.disposition,
        refer_to: form.refer_to || null,
        follow_up_date: form.follow_up_date || null,
        created_at: new Date().toISOString(),
      })
      if (cErr) { window.notifyFromLegacyAlert('Error saving consultation: ' + cErr.message); setSaving(false); return }

      // 1b. Auto-create specialist consultation invoice
      const { data: newConsult } = await supabase
        .from('consultations')
        .select('id')
        .eq('visit_id', visit.id)
        .eq('hospital_id', hospitalId)
        .eq('speciality', department)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      await autoCreateSpecialistInvoice({ consultationId: newConsult?.id || null })

      // 2. Save prescriptions (if any)
      const validRx = rxList
        .map(r => ({ ...r, drug_name: canonicalizePrescriptionDrug((r.drug_name || '').trim(), inventory), quantity: Math.max(1, parseInt(r.quantity, 10) || 1) }))
        .filter(r => r.drug_name)
      if (validRx.length > 0) {
        const { error: rxErr } = await supabase.from('prescriptions').insert(
          validRx.map(r => ({
            hospital_id: hospitalId, visit_id: visit.id, patient_id: visit.patient_id,
            patient_name: visit.patients?.full_name || visit.patient_name || '',
            drug_name: r.drug_name, dosage: r.dosage, frequency: r.frequency,
            duration: r.duration, quantity: r.quantity,
            status: 'Pending', prescribed_by: form.doctor_name,
            created_at: new Date().toISOString(),
          }))
        )
        if (rxErr) { window.notifyFromLegacyAlert('Error saving prescriptions: ' + rxErr.message); setSaving(false); return }
        try { window.dispatchEvent(new CustomEvent('remedacare:prescriptions_changed', { detail: { visit_id: visit.id } })) } catch (e) {}
      }

      // 3. Save lab orders (tagged with dept so results return here)
      const validLabs = labOrders.filter(l => (l.test_type || '').trim())
      if (validLabs.length > 0) {
        const { error: labErr } = await supabase.from('lab_tests').insert(
          validLabs.map(l => ({
            hospital_id: hospitalId, visit_id: visit.id, patient_id: visit.patient_id,
            patient_name: visit.patients?.full_name || visit.patient_name || '',
            test_type: l.test_type, category: l.category || 'Other',
            priority: l.priority, notes: l.notes,
            status: 'Pending', source: department,
            ordered_by: form.doctor_name, ordered_at: new Date().toISOString(),
          }))
        )
        if (labErr) { window.notifyFromLegacyAlert('Error saving lab orders: ' + labErr.message); setSaving(false); return }
        try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: visit.id } })) } catch (e) {}
      }

      // 4. Map disposition → visit status
      const isPharmacy = form.disposition.includes('Pharmacy')
      const isLab = form.disposition.includes('Lab')
      const isAdmit = form.disposition.includes('Admit')
      const isRefer = form.disposition === 'Refer to Specialist'
      const isHome = form.disposition === 'Send Home'

      let newStatus = 'Completed'
      if (isLab) newStatus = 'Lab'
      else if (isPharmacy) newStatus = 'Prescription'
      else if (isAdmit) newStatus = 'Admission Requested'
      else if (isRefer) newStatus = 'Doctor'

      const { error: vErr } = await supabase.from('visits').update({
        status: newStatus,
        speciality: isRefer ? (form.refer_department || department) : department,
        assigned_doctor_name: isRefer ? (form.refer_to || form.doctor_name) : form.doctor_name,
        doctor_notes: form.diagnosis,
        ...(referWard ? { ward: referWard } : {}),
        ...(validLabs.length > 0 ? { lab_requested: true } : {}),
      }).eq('id', visit.id).eq('hospital_id', hospitalId)

      if (vErr) { window.notifyFromLegacyAlert('Error updating visit: ' + vErr.message); setSaving(false); return }

      try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: visit.id, status: newStatus } })) } catch (e) {}

      onComplete?.()
    } catch (e) {
      window.notifyFromLegacyAlert('Error: ' + e.message)
    }
    setSaving(false)
  }

  const p = (visit.patients || {})
  const sp = { fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '99px' }
  const inp = { width: '100%', padding: '9px 11px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' }
  const lbl = { fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px', fontWeight: '500' }
  const fg = { marginBottom: '12px' }
  const g2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }
  const slbl = { fontSize: '11px', fontWeight: '700', color: accentColor, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '10px', marginTop: '2px', paddingBottom: '5px', borderBottom: `1px solid ${accentBg}` }

  return (
    <div style={{ background: '#fff', border: `2px solid ${accentColor}30`, borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
      {/* Patient header strip */}
      <div style={{ background: accentBg, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${accentColor}20` }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
          {(p.full_name || visit.patient_name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{p.full_name || visit.patient_name || 'Patient'}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {p.age && `${p.age}y`}{p.gender ? ` • ${p.gender}` : ''} • {visit.visit_number || visit.id?.slice(0,8)} • {visit.visit_type || 'Visit'}
            {visit.chief_complaint ? ` • 💬 ${visit.chief_complaint}` : ''}
          </div>
        </div>
        {completedLabs.length > 0 && (
          <div style={{ ...sp, background: '#E1F5EE', color: '#0F6E56', cursor: 'pointer' }} onClick={() => setTab('labs')}>
            🔬 {completedLabs.length} lab{completedLabs.length > 1 ? 's' : ''} ready
          </div>
        )}
        {pendingLabs.length > 0 && (
          <div style={{ ...sp, background: '#FFF3DC', color: '#C07000' }}>
            ⏳ {pendingLabs.length} pending
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #f0f0f0', padding: '0 18px' }}>
        {[
          ['consult', `${config.icon || '🩺'} Consultation`],
          ['vitals', '📊 Vitals'],
          ['labs', `🔬 Lab Results${thisVisitLabs.length > 0 ? ` (${thisVisitLabs.length})` : ''}`],
          ['history', `📁 History${patientConsults.length > 0 ? ` (${patientConsults.length})` : ''}`],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '12px', fontWeight: tab === k ? 700 : 500,
            color: tab === k ? accentColor : '#888',
            borderBottom: tab === k ? `2px solid ${accentColor}` : '2px solid transparent',
            marginBottom: '-2px',
          }}>
            {label}
            {k === 'labs' && completedLabs.length > 0 && (
              <span style={{ ...sp, background: '#E1F5EE', color: '#0F6E56', marginLeft: 4, fontSize: 10 }}>✓{completedLabs.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: '18px 20px' }}>

        {/* ── VITALS TAB ── */}
        {tab === 'vitals' && (
          <div>
            {!vitals ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
                <div style={{ fontSize: 28 }}>📊</div>
                <div style={{ marginTop: 8, fontSize: 13 }}>No vitals recorded for this visit</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {[
                  ['⚖ Weight', vitals.weight_kg ? `${vitals.weight_kg} kg` : '—'],
                  ['📏 Height', vitals.height_cm ? `${vitals.height_cm} cm` : '—'],
                  ['📐 BMI', vitals.bmi || '—'],
                  ['❤ BP', vitals.bp_systolic ? `${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg` : '—'],
                  ['💓 Pulse', vitals.pulse_bpm ? `${vitals.pulse_bpm} bpm` : '—'],
                  ['🌡 Temp', vitals.temperature_c ? `${vitals.temperature_c}°C` : '—'],
                  ['🫁 SpO2', vitals.oxygen_sat ? `${vitals.oxygen_sat}%` : '—'],
                  ['🫀 RR', vitals.respiratory_rate ? `${vitals.respiratory_rate}/min` : '—'],
                  [' Sugar', vitals.blood_sugar ? `${vitals.blood_sugar} mmol/L` : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: accentBg, borderRadius: 10, padding: '12px', textAlign: 'center', border: `1px solid ${accentColor}20` }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: accentColor }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── LAB RESULTS TAB ── */}
        {tab === 'labs' && (
          <div>
            {thisVisitLabs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
                <div style={{ fontSize: 28 }}>🔬</div>
                <div style={{ marginTop: 8, fontSize: 13 }}>No lab tests for this visit yet</div>
              </div>
            ) : (
              thisVisitLabs.map(lab => {
                const sc = { Pending: { bg: '#FFF3DC', color: '#C07000' }, 'In Progress': { bg: '#E3F0FB', color: '#1a6fb5' }, Complete: { bg: '#E1F5EE', color: '#0F6E56' }, Critical: { bg: '#FCEBEB', color: '#A32D2D' } }[lab.status] || {}
                const ic = interpColor(lab.interpretation)
                return (
                  <div key={lab.id} style={{ background: '#f9fafb', borderRadius: 10, padding: 14, border: '1px solid #eee', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{lab.test_type}</span>
                      <span style={{ ...sp, background: sc.bg, color: sc.color }}>{lab.status}</span>
                      {lab.category && <span style={{ ...sp, background: '#f0f0f0', color: '#666' }}>{lab.category}</span>}
                      {lab.source && lab.source !== 'Doctor' && <span style={{ ...sp, background: '#E3F0FB', color: '#1a6fb5' }}>From: {lab.source}</span>}
                    </div>
                    {lab.status === 'Complete' ? (
                      <div>
                        {lab.result_value && <div style={{ fontSize: 20, fontWeight: 800, color: accentColor }}>{lab.result_value}{lab.reference_range && <span style={{ fontSize: 12, color: '#888', fontWeight: 400, marginLeft: 8 }}>Ref: {lab.reference_range}</span>}</div>}
                        {lab.result_text && <div style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#333', border: '1px solid #e8e8e8', marginTop: 6, whiteSpace: 'pre-wrap' }}>{lab.result_text}</div>}
                        {lab.interpretation && ic && <span style={{ ...sp, ...ic, fontSize: 12, padding: '4px 10px', display: 'inline-block', marginTop: 6 }}>{lab.interpretation}</span>}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#aaa', fontStyle: 'italic' }}>
                        {lab.status === 'In Progress' ? '🔄 Processing...' : '⏳ Awaiting processing'}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === 'history' && (
          <div>
            {patientConsults.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
                <div style={{ fontSize: 28 }}>📁</div>
                <div style={{ marginTop: 8, fontSize: 13 }}>No previous consultations found</div>
              </div>
            ) : (
              patientConsults.map(c => (
                <div key={c.id} style={{ background: '#f9fafb', borderRadius: 10, padding: 14, border: '1px solid #eee', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.diagnosis || 'No diagnosis'}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        Dr. {c.doctor_name || '—'} • {c.speciality || '—'} • {c.created_at ? new Date(c.created_at).toLocaleDateString('en-KE') : '—'}
                      </div>
                    </div>
                    <span style={{ ...sp, background: accentBg, color: accentColor }}>{c.disposition || '—'}</span>
                  </div>
                  {c.presenting_complaint && <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}><strong>Complaint:</strong> {c.presenting_complaint}</div>}
                  {c.treatment_plan && <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}><strong>Treatment:</strong> {c.treatment_plan}</div>}
                  {c.notes && <div style={{ fontSize: 12, color: '#555' }}><strong>Notes:</strong> {c.notes}</div>}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── CONSULTATION TAB ── */}
        {tab === 'consult' && (
          <div>
            {/* Lab alert banner */}
            {completedLabs.length > 0 && (
              <div style={{ background: `linear-gradient(135deg, ${accentBg}, #f0f8ff)`, border: `1.5px solid ${accentColor}40`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => setTab('labs')}>
                <span style={{ fontSize: 18 }}>🔬</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: accentColor }}>Lab Results Ready — {completedLabs.length} test(s) completed</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>{completedLabs.map(l => l.test_type).join(', ')}</div>
                </div>
                <span style={{ fontSize: 12, color: accentColor, fontWeight: 600 }}>View →</span>
              </div>
            )}
            {pendingLabs.length > 0 && (
              <div style={{ background: '#FFF3DC', border: '1px solid #FAC775', borderRadius: 10, padding: '8px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>⏳</span>
                <div style={{ fontSize: 12, color: '#C07000', fontWeight: 600 }}>{pendingLabs.length} lab test(s) still pending: {pendingLabs.map(l => l.test_type).join(', ')}</div>
              </div>
            )}

            {/* Referral context banner — who sent this patient and why */}
            {(visit.assigned_doctor_name || visit.doctor_notes || visit.chief_complaint) && (
              <div style={{ background: '#F0F4FF', border: '1.5px solid #C7D7FD', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#3B4FD8', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
                  📋 Referral from Consultant
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {visit.assigned_doctor_name && (
                    <div style={{ background: '#fff', borderRadius: 8, padding: '8px 12px', border: '1px solid #E0E7FF' }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Referred by</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>Dr. {visit.assigned_doctor_name}</div>
                    </div>
                  )}
                  {visit.speciality && (
                    <div style={{ background: '#fff', borderRadius: 8, padding: '8px 12px', border: '1px solid #E0E7FF' }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Referred to</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a8a' }}>{visit.speciality}</div>
                    </div>
                  )}
                </div>
                {visit.chief_complaint && (
                  <div style={{ marginTop: 8, background: '#fff', borderRadius: 8, padding: '8px 12px', border: '1px solid #E0E7FF' }}>
                    <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Chief Complaint</div>
                    <div style={{ fontSize: 13, color: '#111' }}>💬 {visit.chief_complaint}</div>
                  </div>
                )}
                {visit.doctor_notes && (
                  <div style={{ marginTop: 8, background: '#EEF2FF', borderRadius: 8, padding: '10px 12px', border: '1px solid #C7D7FD' }}>
                    <div style={{ fontSize: 11, color: '#3B4FD8', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4, fontWeight: 700 }}>Consultant's Notes / Diagnosis</div>
                    <div style={{ fontSize: 13, color: '#1e3a8a', fontStyle: 'italic', lineHeight: 1.5 }}>"{visit.doctor_notes}"</div>
                  </div>
                )}
              </div>
            )}

            {/* Doctor details */}
            <div style={slbl}>Specialist Details</div>
            <div style={g2}>
              <div style={fg}>
                <label style={lbl}>Specialist / Doctor Name *</label>
                <input style={inp} placeholder={`Dr. — ${department}`} value={form.doctor_name} onChange={e => setForm({ ...form, doctor_name: e.target.value })} />
              </div>
              <div style={fg}>
                <label style={lbl}>Sub-speciality (optional)</label>
                <input style={inp} placeholder={`e.g. ${department} sub-unit`} value={form.speciality} onChange={e => setForm({ ...form, speciality: e.target.value })} />
              </div>
            </div>

            {/* Clinical info */}
            <div style={slbl}>Clinical Assessment</div>
            <div style={fg}>
              <label style={lbl}>Presenting Complaint / Reason for Referral</label>
              <input style={inp} placeholder="What is the patient presenting with?" value={form.presenting_complaint} onChange={e => setForm({ ...form, presenting_complaint: e.target.value })} />
            </div>
            <div style={fg}>
              <label style={lbl}>History & Specialist Findings</label>
              <textarea style={{ ...inp, height: 75, resize: 'vertical' }} placeholder="Specialist's history, relevant background, onset..." value={form.history} onChange={e => setForm({ ...form, history: e.target.value })} />
            </div>
            <div style={fg}>
              <label style={lbl}>Examination Findings</label>
              <textarea style={{ ...inp, height: 70, resize: 'vertical' }} placeholder="Specialist examination findings specific to this department..." value={form.examination_findings} onChange={e => setForm({ ...form, examination_findings: e.target.value })} />
            </div>

            {/* Diagnosis */}
            <div style={slbl}>Diagnosis</div>
            <div style={g2}>
              <div style={fg}>
                <label style={lbl}>Diagnosis *</label>
                <input style={{ ...inp, fontWeight: 600 }} placeholder="Primary diagnosis..." value={form.diagnosis} onChange={e => setForm({ ...form, diagnosis: e.target.value })} />
              </div>
              <div style={fg}>
                <label style={lbl}>ICD-10 Code (optional)</label>
                <input style={inp} placeholder="e.g. I21.0" value={form.icd_code} onChange={e => setForm({ ...form, icd_code: e.target.value })} />
              </div>
            </div>
            <div style={fg}>
              <label style={lbl}>Treatment Plan & Management</label>
              <textarea style={{ ...inp, height: 65, resize: 'vertical' }} placeholder="Specialist's recommended treatment, procedures, interventions..." value={form.treatment_plan} onChange={e => setForm({ ...form, treatment_plan: e.target.value })} />
            </div>
            <div style={fg}>
              <label style={lbl}>Additional Notes</label>
              <textarea style={{ ...inp, height: 55, resize: 'vertical' }} placeholder="Any further notes or observations..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>

            {/* Prescriptions */}
            {config.canPrescribe !== false && (
              <>
                <div style={{ ...slbl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span> Prescriptions</span>
                  <button onClick={() => setShowRx(!showRx)} style={{ fontSize: 12, padding: '3px 10px', border: `1px solid ${accentColor}`, borderRadius: 6, background: '#fff', color: accentColor, cursor: 'pointer', fontWeight: 600 }}>
                    {showRx ? '− Hide' : '+ Add Prescription'}
                  </button>
                </div>
                {showRx && (
                  <div style={{ marginBottom: 14 }}>
                    {rxList.map((rx, i) => (
                      <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, border: '1px solid #eee', marginBottom: 8 }}>
                        <div style={g2}>
                          <div style={fg}>
                            <label style={lbl}>Drug Name</label>
                            <input list={`dept-rx-${i}`} style={inp} placeholder="e.g. Atenolol 50mg" value={rx.drug_name} onChange={e => updateRx(i, 'drug_name', e.target.value)} />
                            <datalist id={`dept-rx-${i}`}>
                              {inventory.slice(0, 250).map(item => <option key={item.id} value={item.drug_name}>{item.generic_name || ''}</option>)}
                            </datalist>
                            {rx.drug_name && <div style={{ fontSize: 11, marginTop: 4, color: stockInfo(rx.drug_name, rx.quantity).color }}>{stockInfo(rx.drug_name, rx.quantity).label}</div>}
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Dosage</label>
                            <input style={inp} placeholder="e.g. 50mg" value={rx.dosage} onChange={e => updateRx(i, 'dosage', e.target.value)} />
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Frequency</label>
                            <select style={inp} value={rx.frequency} onChange={e => updateRx(i, 'frequency', e.target.value)}>
                              <option value="">-- Select --</option>
                              {['Once daily','Twice daily','Three times daily','Four times daily','Every 8 hours','Every 6 hours','At night','As needed','Stat (once)'].map(f => <option key={f}>{f}</option>)}
                            </select>
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Duration</label>
                            <input style={inp} placeholder="e.g. 14 days" value={rx.duration} onChange={e => updateRx(i, 'duration', e.target.value)} />
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Quantity</label>
                            <input style={inp} type="number" placeholder="e.g. 30" value={rx.quantity} onChange={e => updateRx(i, 'quantity', e.target.value)} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}>
                            {rxList.length > 1 && <button style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #F09595', borderRadius: 6, background: '#fff', color: '#A32D2D', cursor: 'pointer' }} onClick={() => setRxList(rxList.filter((_, j) => j !== i))}> Remove</button>}
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setRxList([...rxList, { drug_name: '', dosage: '', frequency: '', duration: '', quantity: '' }])} style={{ fontSize: 13, padding: '7px 14px', border: '1px dashed #9FE1CB', borderRadius: 8, background: '#f9fafb', color: accentColor, cursor: 'pointer', fontWeight: 600, width: '100%', marginBottom: 6 }}>
                      + Add Another Drug
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Lab Orders */}
            {config.canOrderLab !== false && (
              <>
                <div style={{ ...slbl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🔬 Lab / Imaging Orders</span>
                  <button onClick={() => setShowLab(!showLab)} style={{ fontSize: 12, padding: '3px 10px', border: `1px solid ${accentColor}`, borderRadius: 6, background: '#fff', color: accentColor, cursor: 'pointer', fontWeight: 600 }}>
                    {showLab ? '− Hide' : '+ Order Tests'}
                  </button>
                </div>
                {showLab && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ background: '#E3F0FB', border: '1px solid #93C5FD', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#1e40af', marginBottom: 10 }}>
                      💡 Lab results ordered from this department will return to this department's queue — not just OPD.
                    </div>
                    {labOrders.map((lab, i) => (
                      <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, border: '1px solid #eee', marginBottom: 8 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                          <div style={fg}>
                            <label style={lbl}>Category</label>
                            <select style={inp} value={lab.category} onChange={e => { const l = [...labOrders]; l[i].category = e.target.value; setLabOrders(l) }}>
                              {LAB_TEST_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Test Name</label>
                            <input list={`dept-lab-${i}`} style={inp} placeholder="e.g. ECG, Echo..." value={lab.test_type}
                              onChange={e => { const l = [...labOrders]; l[i].test_type = e.target.value; setLabOrders(l) }} />
                            <datalist id={`dept-lab-${i}`}>
                              {getLabTestsForCategory(lab.category).map(t => <option key={t} value={t} />)}
                            </datalist>
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Priority</label>
                            <select style={inp} value={lab.priority} onChange={e => { const l = [...labOrders]; l[i].priority = e.target.value; setLabOrders(l) }}>
                              <option>Routine</option><option>Urgent</option><option>STAT</option>
                            </select>
                          </div>
                          <div style={fg}>
                            <label style={lbl}>Notes</label>
                            <input style={inp} placeholder="Instructions" value={lab.notes}
                              onChange={e => { const l = [...labOrders]; l[i].notes = e.target.value; setLabOrders(l) }} />
                          </div>
                        </div>
                        {labOrders.length > 1 && <button style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #F09595', borderRadius: 6, background: '#fff', color: '#A32D2D', cursor: 'pointer' }} onClick={() => setLabOrders(labOrders.filter((_, j) => j !== i))}> Remove</button>}
                      </div>
                    ))}
                    <button onClick={() => setLabOrders([...labOrders, { test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }])} style={{ fontSize: 13, padding: '7px 14px', border: '1px dashed #9FE1CB', borderRadius: 8, background: '#f9fafb', color: accentColor, cursor: 'pointer', fontWeight: 600, width: '100%' }}>
                      + Add Another Test
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Disposition */}
            <div style={slbl}>Disposition *</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
              {DEPT_DISPOSITIONS.map(d => (
                <div key={d} onClick={() => {
                  setForm({ ...form, disposition: d })
                  if (d.includes('Lab')) setShowLab(true)
                  if (d.includes('Pharmacy') || d.includes('Admit')) setShowRx(true)
                }} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '10px 6px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: form.disposition === d ? `2px solid ${accentColor}` : '2px solid #eee',
                  background: form.disposition === d ? accentBg : '#fafafa',
                  fontSize: 12, fontWeight: 500,
                }}>
                  <span style={{ fontSize: 15 }}>
                    {d.includes('Home') ? '🏠' : d.includes('Admit') ? '' : d.includes('Refer') ? '↗' : d.includes('Lab') ? '🔬' : d.includes('Pharmacy') ? '' : '🚨'}
                  </span>
                  {d}
                </div>
              ))}
            </div>

            {/* Referral details */}
            {form.disposition === 'Refer to Specialist' && (
              <div style={{ background: '#F0EAFC', border: '1.5px solid #C4B5FD', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#7B5EA7', marginBottom: 10 }}>↗ Referral Details</div>
                <div style={g2}>
                  <div style={fg}>
                    <label style={lbl}>Refer to Department *</label>
                    <select style={{ ...inp, borderColor: '#C4B5FD' }} value={form.refer_department}
                      onChange={e => setForm({ ...form, refer_department: e.target.value })}>
                      <option value="">-- Select Department --</option>
                      {referralGroups.map(group => (
                        <optgroup key={group.group} label={group.group}>
                          {group.options.filter(o => o !== department).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div style={fg}>
                    <label style={lbl}>Ward / Unit (optional)</label>
                    <select style={{ ...inp, borderColor: '#C4B5FD' }} value={referWard} onChange={e => setReferWard(e.target.value)}>
                      <option value="">-- Select Ward --</option>
                      {wardsList.length > 0
                        ? wardsList.map(w => <option key={w.id} value={w.name}>{w.name}{w.ward_type ? ` (${w.ward_type})` : ''}</option>)
                        : ['General Ward','Maternity Ward','Paediatric Ward','ICU / HDU','Surgical Ward','Private Ward','Casualty'].map(w => <option key={w} value={w}>{w}</option>)
                      }
                    </select>
                  </div>
                </div>
                <div style={fg}>
                  <label style={lbl}>Attention / Specialist Name (optional)</label>
                  <input style={{ ...inp, borderColor: '#C4B5FD' }} placeholder="e.g. Dr. Otieno — Neurology"
                    value={form.refer_to} onChange={e => setForm({ ...form, refer_to: e.target.value })} />
                  {form.refer_department && <div style={{ fontSize: 11, color: '#7B5EA7', marginTop: 4 }}>Patient will appear in the {form.refer_department} department queue.</div>}
                </div>
              </div>
            )}

            <div style={fg}>
              <label style={lbl}>Follow-up Date (if applicable)</label>
              <input style={inp} type="date" value={form.follow_up_date} onChange={e => setForm({ ...form, follow_up_date: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button style={{ padding: '10px 18px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555' }}
                onClick={() => onComplete?.()}>Cancel</button>
              <button style={{ flex: 1, padding: '10px 20px', border: 'none', borderRadius: 8, background: accentColor, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
                onClick={handleSave} disabled={saving || !canWriteDiagnosis}>
                {saving ? 'Saving...' : `${config.icon || '🩺'} Complete Specialist Consultation`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function DepartmentDetail({ department, onBack }) {
  const { hospitalId, userRole, departments: configuredDepartments = [], refreshDepartments } = useHospital()
  const normalizedDepartment = normalizeDepartment(department)
  const [, setDepartmentConfig] = useState(null)
  const departmentRecord = useMemo(
    () => configuredDepartments.find(dept => dept?.name === department || normalizeDepartment(dept?.name) === normalizedDepartment) || null,
    [configuredDepartments, department, normalizedDepartment]
  )
  const config = useMemo(() => {
    const codeConfig = DEPARTMENT_CONFIG[normalizedDepartment] || DEFAULT_CONFIG
    if (!departmentRecord) return codeConfig

    return {
      type: departmentRecord.dept_type || codeConfig.type || DEFAULT_CONFIG.type,
      icon: departmentRecord.icon || codeConfig.icon || DEFAULT_CONFIG.icon,
      color: departmentRecord.color_hex || codeConfig.color || DEFAULT_CONFIG.color,
      bg: codeConfig.bg || DEFAULT_CONFIG.bg,
      description: departmentRecord.description || codeConfig.description || DEFAULT_CONFIG.description,
      canRefer: departmentRecord.can_refer ?? codeConfig.canRefer ?? DEFAULT_CONFIG.canRefer,
      canOrderLab: departmentRecord.can_order_lab ?? codeConfig.canOrderLab ?? DEFAULT_CONFIG.canOrderLab,
      canPrescribe: departmentRecord.can_prescribe ?? codeConfig.canPrescribe ?? DEFAULT_CONFIG.canPrescribe,
      dataSources: departmentRecord.data_sources?.length ? departmentRecord.data_sources : (codeConfig.dataSources || DEFAULT_CONFIG.dataSources),
      uiSections: departmentRecord.ui_sections?.length ? departmentRecord.ui_sections : (codeConfig.uiSections || DEFAULT_CONFIG.uiSections),
    }
  }, [departmentRecord, normalizedDepartment])
  const [loading, setLoading] = useState(true)

  // data state
  const [staff, setStaff] = useState([])
  const [visits, setVisits] = useState([])
  const [consultations, setConsultations] = useState([])
  const [labOrders, setLabOrders] = useState([])
  const [pharmacyOrders, setPharmacyOrders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [transportRequests, setTransportRequests] = useState([])
  const [mealOrders, setMealOrders] = useState([])
  const [cleaningTasks, setCleaningTasks] = useState([])

  // Active specialist consultation
  const [activeSpecialistVisit, setActiveSpecialistVisit] = useState(null)
  const canWriteDiagnosis = canPerformAction(userRole, 'write_diagnosis')

  useEffect(() => {
    if (!hospitalId || !department) return
    setDepartmentConfig(null)
    setActiveSpecialistVisit(null)
    const loadDepartment = async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('hospital_id', hospitalId)
        .eq('name', normalizedDepartment)
        .single()
      if (error && error.code !== 'PGRST116') {
        console.error('Failed to load department config', error)
        return
      }
      if (data) {
        // Derive bg from DEPARTMENT_CONFIG fallback since DB has no bg column
        const codeConfig = DEPARTMENT_CONFIG[normalizedDepartment] || DEFAULT_CONFIG
        setDepartmentConfig({
          type: data.dept_type || 'admin',
          icon: data.icon || '🏢',
          color: data.color_hex || '#374151',
          bg: codeConfig.bg || '#F9FAFB',
          description: data.description || DEFAULT_CONFIG.description,
          canRefer: codeConfig.canRefer !== false,
          canOrderLab: codeConfig.canOrderLab !== false,
          canPrescribe: codeConfig.canPrescribe !== false,
          dataSources: codeConfig.dataSources || DEFAULT_CONFIG.dataSources,
          uiSections: codeConfig.uiSections || DEFAULT_CONFIG.uiSections,
        })
      }
    }
    loadDepartment()
  }, [hospitalId, department, normalizedDepartment])

  const referralGroups = useMemo(() => {
    const grouped = new Map()
    configuredDepartments.forEach(dept => {
      if (!dept?.name) return
      const labelMap = {
        clinical: 'Clinical',
        diagnostic: 'Diagnostic',
        pharmacy: 'Pharmacy',
        admin: 'Admin',
        support: 'Support',
      }
      const key = labelMap[dept.dept_type] || 'Other'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(dept.name)
    })

    if (!grouped.has('Other')) grouped.set('Other', [])
    if (department && !configuredDepartments.some(dept => dept?.name === department)) {
      grouped.get('Other').push(department)
    }

    return [...grouped.entries()]
      .map(([group, options]) => ({ group, options: [...new Set(options)].sort() }))
      .filter(group => group.options.length > 0)
  }, [configuredDepartments, department])

  async function handleDeleteDepartment() {
    if (!departmentRecord) {
      window.notifyFromLegacyAlert('This department is not stored in HR departments yet.')
      return
    }
    if (!['Admin', 'admin'].includes(userRole || '')) {
      window.notifyFromLegacyAlert('Only Admin users can delete departments.')
      return
    }
    if (!await window.openConfirmDialog(`Delete department '${departmentRecord.name}'? This will not remove existing staff assignments.`)) return
    const { error } = await supabase.from('departments').delete().eq('hospital_id', hospitalId).eq('id', departmentRecord.id)
    if (error) {
      window.notifyFromLegacyAlert(error.message)
      return
    }
    await refreshDepartments?.()
    onBack?.()
  }

  const loadData = useCallback(async () => {
    if (!hospitalId || !department) return
    setLoading(true)
    const { dataSources } = config
    const dept = normalizedDepartment.toLowerCase()

    const staffDepartments = getDepartmentSearchKeys(department)
    const fetches = {
      staff: () => {
        const query = supabase.from('staff').select('*').eq('hospital_id', hospitalId).order('full_name')
        return query.in('department', staffDepartments)
      },
      visits: () => supabase.from('visits').select('*, patients(id, full_name, age, gender, phone, dob)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      consultations: () => supabase.from('consultations').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      lab_tests: () => supabase.from('lab_tests').select('*, visits(visit_id,status,speciality)').eq('hospital_id', hospitalId).order('ordered_at', { ascending: false }),
      prescriptions: () => supabase.from('prescriptions').select('*, visits(visit_id,status,speciality)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      invoices: () => supabase.from('invoices').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      transport_requests: () => supabase.from('transport_requests').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      meal_orders: () => supabase.from('meal_orders').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
      cleaning_tasks: () => supabase.from('cleaning_tasks').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
    }

    const needed = new Set(dataSources)
    if (needed.has('visits') || config.type === 'clinical') needed.add('visits')
    if (needed.has('consultations') || config.type === 'clinical') needed.add('consultations')
    if (needed.has('invoices') || config.type === 'admin') needed.add('invoices')
    needed.add('staff')

    const results = {}
    await Promise.all(
      [...needed].filter(k => fetches[k]).map(async k => {
        const res = await fetches[k]()
        results[k] = res.data || []
      })
    )

    setStaff(results.staff || [])
    setInvoices(results.invoices || [])
    setTransportRequests(results.transport_requests || [])
    setMealOrders(results.meal_orders || [])
    setCleaningTasks(results.cleaning_tasks || [])

    const allVisits = results.visits || []
    if (config.type === 'clinical') {
      setVisits(allVisits.filter(v => isVisitForDepartment(normalizedDepartment, v)))

      const allConsults = results.consultations || []
      const deptLower = normalizedDepartment.toLowerCase()
      setConsultations(allConsults.filter(c => {
        const s = (c.speciality || '').toLowerCase()
        const rd = (c.refer_to || '').toLowerCase()
        return s === deptLower || rd === deptLower || (normalizedDepartment === 'OPD / Outpatient' && s === 'general')
      }))
    } else {
      setVisits([])
      setConsultations([])
    }

    const allLabs = results.lab_tests || []
    if (config.type === 'diagnostic' && config.testFilter) {
      setLabOrders(allLabs.filter(config.testFilter))
    } else {
      setLabOrders([])
    }

    const allRx = results.prescriptions || []
    if (config.type === 'pharmacy') {
      setPharmacyOrders(allRx.filter(rx => {
        const st = (rx.visits?.status || '').toLowerCase()
        return st === 'pharmacy' || (rx.status && rx.status !== 'Released')
      }))
    } else {
      setPharmacyOrders([])
    }

    setLoading(false)
  }, [hospitalId, department, normalizedDepartment, config])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    const refresh = () => loadData()
    window.addEventListener('remedacare:workflow_changed', refresh)
    window.addEventListener('remedacare:prescriptions_changed', refresh)
    window.addEventListener('remedacare:antibiogram_updated', refresh)
    return () => {
      window.removeEventListener('remedacare:workflow_changed', refresh)
      window.removeEventListener('remedacare:prescriptions_changed', refresh)
      window.removeEventListener('remedacare:antibiogram_updated', refresh)
    }
  }, [loadData])

  const stats = useMemo(() => {
    const base = [
      { label: 'Staff assigned', value: staff.length, color: config.color },
      { label: 'Active staff', value: staff.filter(s => s.status === 'Active').length, color: '#16A34A' },
    ]
    if (config.type === 'clinical') {
      base.push({ label: 'Visit queue', value: visits.length, color: '#2563EB' })
      base.push({ label: 'Consultations', value: consultations.length, color: '#7C3AED' })
    }
    if (config.type === 'diagnostic') {
      base.push({ label: 'Pending tests', value: labOrders.filter(t => t.status !== 'Completed').length, color: '#D97706' })
      base.push({ label: 'Completed today', value: labOrders.filter(t => t.status === 'Completed').length, color: '#16A34A' })
    }
    if (config.type === 'pharmacy') {
      base.push({ label: 'Pending orders', value: pharmacyOrders.filter(r => r.status !== 'Released').length, color: '#D97706' })
      base.push({ label: 'Released today', value: pharmacyOrders.filter(r => r.status === 'Released').length, color: '#16A34A' })
    }
    if (config.type === 'admin' && department === 'Finance & Billing') {
      const balance = invoices.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0)
      base.push({ label: 'Open invoices', value: invoices.filter(i => Number(i.balance_kes) > 0).length, color: '#DC2626' })
      base.push({ label: 'Outstanding', value: `KES ${balance.toLocaleString()}`, color: '#DC2626' })
    }
    if (config.type === 'support' && department === 'Transport') {
      base.push({ label: 'Active requests', value: transportRequests.filter(r => r.status !== 'Completed').length, color: '#0891B2' })
    }
    if (config.type === 'support' && department === 'Kitchen / Catering') {
      base.push({ label: "Today's meal orders", value: mealOrders.length, color: '#EA580C' })
    }
    if (config.type === 'support' && department === 'Housekeeping') {
      base.push({ label: 'Pending tasks', value: cleaningTasks.filter(t => t.status !== 'Completed').length, color: '#65A30D' })
    }
    return base
  }, [staff, visits, consultations, labOrders, pharmacyOrders, invoices, transportRequests, mealOrders, cleaningTasks, config, department])

  if (!department) {
    return (
      <div style={css.page}>
        <div style={css.wrap}>
          <div style={css.card}>
            <EmptyState icon="🏢" message="Choose a department to open its dedicated screen." />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={css.page}>
      <div style={css.wrap}>

        <DepartmentHeader
          css={css}
          config={config}
          department={department}
          userRole={userRole}
          departmentRecord={departmentRecord}
          onBack={onBack}
          onDelete={handleDeleteDepartment}
        />

        <DepartmentMetrics css={css} stats={stats} />

        {loading ? (
          <div style={css.card}><EmptyState icon="⏳" message="Loading department data…" /></div>
        ) : (
          <>
            {/* ── CLINICAL SECTIONS ───────────────────────── */}
            {config.type === 'clinical' && (
              <>
                {/* Active specialist consultation */}
                {activeSpecialistVisit && (
                  <SpecialistConsultationPanel
                    visit={activeSpecialistVisit}
                    hospitalId={hospitalId}
                    department={normalizedDepartment}
                    config={config}
                    referralGroups={referralGroups}
                    onComplete={() => { setActiveSpecialistVisit(null); loadData() }}
                  />
                )}

                {config.uiSections.includes('visit_queue') && (
                  <SectionCard
                    title="Patient Queue"
                    note={`${visits.length} patient(s) routed to ${department}. Click a row to open the specialist consultation.`}
                  >
                    {visits.length === 0 ? (
                      <EmptyState icon="🏥" message="No patients currently in this department's queue." />
                    ) : (
                      <table style={css.table}>
                        <thead>
                          <tr>
                            <th style={css.th}>Patient</th>
                            <th style={css.th}>Visit #</th>
                            <th style={css.th}>Status</th>
                            <th style={css.th}>Speciality</th>
                            <th style={css.th}>Doctor</th>
                            <th style={css.th}>Billing Balance</th>
                            <th style={css.th}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visits.map(v => {
                            const vid = v.visit_id || v.id
                            const inv = invoices.filter(i => i.visit_id === vid)
                            const balance = inv.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0)
                            const isActive = activeSpecialistVisit?.id === v.id
                            return (
                              <tr key={v.id} style={{ background: isActive ? `${config.bg}` : 'transparent', transition: 'background 0.15s' }}>
                                <td style={css.td}>
                                  <div style={{ fontWeight: 700 }}>{v.patients?.full_name || v.patient_name || '—'}</div>
                                  <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                    {v.patients?.age ? `${v.patients.age}y` : ''}{v.patients?.gender ? ` • ${v.patients.gender}` : ''}
                                  </div>
                                  {v.chief_complaint && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>💬 {v.chief_complaint}</div>}
                                </td>
                                <td style={{ ...css.td, fontFamily: 'monospace', fontSize: 12 }}>{v.visit_number || vid?.slice(0,8)}</td>
                                <td style={css.td}><StatusPill status={v.status} /></td>
                                <td style={css.td}>
                                  <div style={{ fontWeight: 500 }}>{v.speciality || '—'}</div>
                                  {v.assigned_doctor_name && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Referred by: {v.assigned_doctor_name}</div>}
                                  {v.doctor_notes && <div style={{ fontSize: 11, color: '#0F6E56', marginTop: 2, fontStyle: 'italic' }}>"{v.doctor_notes}"</div>}
                                </td>
                                <td style={css.td}>{v.assigned_doctor_name || '—'}</td>
                                <td style={{ ...css.td, fontWeight: 600, color: balance > 0 ? '#DC2626' : '#16A34A' }}>KES {balance.toLocaleString()}</td>
                                <td style={css.td}>
                                  <button
                                    onClick={() => setActiveSpecialistVisit(isActive ? null : v)}
                                    disabled={!canWriteDiagnosis}
                                    title="Only doctors and clinical officers can open specialist consultations"
                                    style={{
                                      padding: '5px 12px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700,
                                      background: isActive ? '#FCEBEB' : config.color,
                                      color: isActive ? '#A32D2D' : '#fff',
                                      opacity: canWriteDiagnosis ? 1 : 0.55,
                                      cursor: canWriteDiagnosis ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {isActive ? '✕ Close' : `👁 Review Patient`}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </SectionCard>
                )}

                <DepartmentBeds
                  config={config}
                  SectionCard={SectionCard}
                  VisitQueueSection={VisitQueueSection}
                  visits={visits}
                  invoices={invoices}
                  department={department}
                />

                {config.uiSections.includes('consultations') && (
                  <SectionCard title="Consultation History" note="All consultation records handled by this department.">
                    <ConsultationsSection consultations={consultations} />
                  </SectionCard>
                )}
              </>
            )}

            {/* ── DIAGNOSTIC SECTIONS ─────────────────────── */}
            {config.type === 'diagnostic' && (
              <>
                <SectionCard
                  title={department === 'Radiology & Imaging' ? 'Imaging Queue' : 'Lab Test Queue'}
                  note="Requests from doctors that need to be processed and results posted."
                >
                  <LabQueueSection labOrders={labOrders.filter(t => t.status !== 'Completed')} label={department === 'Radiology & Imaging' ? 'Imaging' : 'Lab'} />
                </SectionCard>
                <SectionCard title="Completed Tests" note="Tests with results already posted.">
                  <LabQueueSection labOrders={labOrders.filter(t => t.status === 'Completed')} label="Completed" />
                </SectionCard>
              </>
            )}

            {/* ── PHARMACY SECTIONS ───────────────────────── */}
            {config.type === 'pharmacy' && (
              <>
                <SectionCard title="Prescription Queue" note="Prescriptions sent to pharmacy awaiting dispensing.">
                  <PharmacySection orders={pharmacyOrders.filter(r => r.status !== 'Released')} />
                </SectionCard>
                <SectionCard title="Dispensed Today" note="Prescriptions already released to patients.">
                  <PharmacySection orders={pharmacyOrders.filter(r => r.status === 'Released')} />
                </SectionCard>
              </>
            )}

            {/* ── FINANCE SECTIONS ────────────────────────── */}
            {config.type === 'admin' && department === 'Finance & Billing' && (
              <SectionCard title="Billing Overview" note="Invoice and payment summary across the hospital.">
                <BillingSummarySection invoices={invoices} />
              </SectionCard>
            )}

            {/* ── TRANSPORT SECTIONS ──────────────────────── */}
            {config.type === 'support' && department === 'Transport' && (
              <SectionCard title="Transport Requests" note="Patient transfers and ambulance dispatch requests.">
                <TransportSection requests={transportRequests} />
              </SectionCard>
            )}

            {/* ── KITCHEN SECTIONS ────────────────────────── */}
            {config.type === 'support' && department === 'Kitchen / Catering' && (
              <SectionCard title="Meal Orders" note="Today's patient meal orders from wards and admissions.">
                <MealOrdersSection orders={mealOrders} />
              </SectionCard>
            )}

            {/* ── HOUSEKEEPING SECTIONS ───────────────────── */}
            {config.type === 'support' && department === 'Housekeeping' && (
              <SectionCard title="Cleaning Tasks" note="Ward and room cleaning assignments for today.">
                <CleaningTasksSection tasks={cleaningTasks} />
              </SectionCard>
            )}

            {/* ── STAFF SECTION (all departments) ─────────── */}
            <DepartmentStaff config={config} SectionCard={SectionCard} StaffSection={StaffSection} staff={staff} />
          </>
        )}
      </div>
    </div>
  )
}
