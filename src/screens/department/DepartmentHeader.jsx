export default function DepartmentHeader({ css, config, department, userRole, departmentRecord, onBack, onDelete }) {
  return (
    <div style={css.header}>
      <div style={css.titleRow}>
        <div style={css.iconBox(config.bg, config.color)}>{config.icon}</div>
        <div>
          <h1 style={css.h1}>{department}</h1>
          <div style={css.subtext}>{config.description}</div>
          <div style={css.typeBadge(config.bg, config.color)}>{config.type}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {['Admin', 'admin'].includes(userRole || '') && (
          <>
            <button style={{ ...css.backBtn, background: '#FFF3DC', color: '#C07000', borderColor: '#FAC775' }} onClick={() => onBack?.()}>
              Manage in HR
            </button>
            {departmentRecord && (
              <button style={{ ...css.backBtn, background: '#FEF2F2', color: '#DC2626', borderColor: '#FCA5A5' }} onClick={onDelete}>
                Delete Department
              </button>
            )}
          </>
        )}
        <button style={css.backBtn} onClick={() => onBack?.()}>← Back</button>
      </div>
    </div>
  )
}
