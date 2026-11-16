export default function DepartmentHeader({ css, config, department, userRole, departmentRecord, moduleLinks = [], onOpenModule, onBack, onDelete }) {
  const isAdmin = ['Admin', 'admin'].includes(userRole || '')
  return (
    <div style={css.header}>
      <div style={{ minWidth: 0 }}>
        <h1 style={css.h1}>{department}</h1>
        {config.description && <div style={css.subtext}>{config.description}</div>}
        <div style={css.typeBadge()}>{config.type}</div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {moduleLinks.map((module) => (
          <button key={module.target} type="button" style={css.backBtn} onClick={() => onOpenModule?.(module.target)}>
            {module.label}
          </button>
        ))}
        {isAdmin && <button type="button" style={css.backBtn} onClick={() => onBack?.()}>Manage staff</button>}
        {isAdmin && departmentRecord && <button type="button" style={css.dangerBtn} onClick={onDelete}>Delete department</button>}
        <button type="button" style={css.backBtn} onClick={() => onBack?.()}>← Back</button>
      </div>
    </div>
  )
}
