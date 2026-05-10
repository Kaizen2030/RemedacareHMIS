export default function DepartmentStaff({ config, SectionCard, StaffSection, staff }) {
  return (
    <SectionCard
      title="Department Staff"
      note="Staff members assigned to this department."
    >
      <StaffSection staff={staff} full={config.uiSections.includes('staff_full')} />
    </SectionCard>
  )
}
