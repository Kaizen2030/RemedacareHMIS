export default function DepartmentBeds({ config, SectionCard, VisitQueueSection, visits, invoices, department }) {
  if (!config.uiSections.includes('admitted_patients')) return null

  return (
    <SectionCard title="Admitted Patients" note="Patients currently admitted under this department.">
      <VisitQueueSection visits={visits} invoices={invoices} department={department} />
    </SectionCard>
  )
}
