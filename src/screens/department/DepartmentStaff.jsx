export default function DepartmentStaff({ config, SectionCard, StaffSection, staff }) {
  return (
    <SectionCard title="Staff" count={staff.length}>
      <StaffSection staff={staff} full={config.uiSections.includes('staff_full')} />
    </SectionCard>
  )
}
