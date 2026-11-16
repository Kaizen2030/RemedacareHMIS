// Specialty content for a clinical department: its care pathways and clinical guides, one click away.
import { CARE_PATHWAYS } from '../../data/carePathways'
import { CLINICAL_GUIDES } from '../../data/clinicalGuides'

export const DEPARTMENT_RESOURCES = {
  'General Medicine': { pathways: ['sepsis-adult', 'pneumonia-adult', 'type2-diabetes', 'hypertension', 'malaria-uncomplicated'], guides: ['sepsis', 'pneumonia', 'malaria', 'uti', 'typhoid'] },
  'OPD / Outpatient': { pathways: ['hypertension', 'type2-diabetes', 'malaria-uncomplicated', 'tb-presumptive'], guides: ['malaria', 'uti', 'typhoid', 'urinalysis'] },
  Emergency: { pathways: ['sepsis-adult', 'malaria-severe', 'dka-adult', 'pph'], guides: ['sepsis', 'meningitis', 'malaria'] },
  'ICU / HDU': { pathways: ['sepsis-adult', 'hap-vap', 'dka-adult'], guides: ['sepsis', 'resistant-organisms', 'meningitis'] },
  Paediatrics: { pathways: ['pneumonia-paediatric', 'diarrhoea-child', 'malaria-severe'], guides: ['pneumonia', 'malaria', 'meningitis'] },
  Maternity: { pathways: ['pre-eclampsia', 'pph', 'sepsis-adult'], guides: ['sepsis', 'malaria', 'uti'] },
  'Obstetrics & Gynaecology': { pathways: ['pre-eclampsia', 'pph'], guides: ['uti', 'sepsis'] },
  Cardiology: { pathways: ['hypertension', 'type2-diabetes'], guides: ['endocarditis-emboli'] },
  'Theatre / Surgery': { pathways: ['sepsis-adult'], guides: ['surgical-prophylaxis', 'sepsis'] },
  Surgery: { pathways: ['sepsis-adult'], guides: ['surgical-prophylaxis', 'sepsis'] },
  Orthopaedics: { pathways: [], guides: ['surgical-prophylaxis'] },
  'Community Health': { pathways: ['tb-presumptive', 'hiv-initiation', 'hiv-monitoring', 'hypertension'], guides: ['tb-drugs', 'hiv-oi'] },
  Neurology: { pathways: [], guides: ['meningitis'] },
  Urology: { pathways: [], guides: ['uti', 'urinalysis'] },
  Oncology: { pathways: ['sepsis-adult'], guides: ['sepsis', 'resistant-organisms'] },
}

export default function DepartmentResources({ department, navigate, css }) {
  const r = DEPARTMENT_RESOURCES[department]
  if (!r) return null
  const pathways = r.pathways.map((id) => CARE_PATHWAYS.find((p) => p.id === id)).filter(Boolean)
  const guides = r.guides.map((id) => CLINICAL_GUIDES.find((g) => g.id === id)).filter(Boolean)
  if (!pathways.length && !guides.length) return null
  return (
    <section style={css.card} aria-label="Clinical resources">
      <div style={css.sectionTitle}>Clinical resources</div>
      <div style={{ height: 8 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        {pathways.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#344054', minWidth: 110 }}>Care pathways</span>
            {pathways.map((p) => (
              <button key={p.id} type="button" style={css.resource} onClick={() => navigate?.('care-pathways', { suggestedProtocol: p.id, source: 'department' })}>{p.title}</button>
            ))}
          </div>
        )}
        {guides.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#344054', minWidth: 110 }}>Clinical guides</span>
            {guides.map((g) => <a key={g.id} href={`#/references?guide=${g.id}`} style={css.resource}>{g.title}</a>)}
          </div>
        )}
      </div>
    </section>
  )
}
