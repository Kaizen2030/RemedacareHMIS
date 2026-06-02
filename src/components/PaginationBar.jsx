import React from 'react'

export function paginateItems(items = [], page = 1, pageSize = 25) {
  const safeItems = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || 25))
  const totalPages = Math.max(1, Math.ceil(safeItems.length / safePageSize))
  const safePage = Math.min(Math.max(1, Number(page || 1)), totalPages)
  const start = (safePage - 1) * safePageSize
  return {
    items: safeItems.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: safeItems.length,
    totalPages,
    start: safeItems.length ? start + 1 : 0,
    end: Math.min(start + safePageSize, safeItems.length),
  }
}

function buildPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1])
  if (currentPage <= 3) [2, 3, 4].forEach((page) => pages.add(page))
  if (currentPage >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((page) => pages.add(page))
  return Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b)
}

export default function PaginationBar({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  styles = {},
  compact = false,
}) {
  const safePageSize = Math.max(1, Number(pageSize || 25))
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / safePageSize))
  const safePage = Math.min(Math.max(1, Number(page || 1)), totalPages)
  const pageNumbers = buildPageNumbers(safePage, totalPages)
  const showSummary = total > 0
  const start = showSummary ? (safePage - 1) * safePageSize + 1 : 0
  const end = showSummary ? Math.min(safePage * safePageSize, total) : 0

  const wrapperStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: compact ? 12 : 16,
    ...styles.wrapper,
  }
  const buttonStyle = {
    padding: compact ? '6px 10px' : '7px 12px',
    borderRadius: 8,
    border: '1px solid #D6E2DB',
    background: '#fff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    ...styles.button,
  }
  const activeButtonStyle = {
    background: '#5B21B6',
    color: '#fff',
    border: '1px solid #5B21B6',
    ...styles.activeButton,
  }
  const disabledStyle = {
    opacity: 0.55,
    cursor: 'not-allowed',
  }

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600, ...styles.summary }}>
          {showSummary ? `Showing ${start}-${end} of ${total}` : 'No records'}
        </span>
        {onPageSizeChange ? (
          <select
            value={safePageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={{ padding: compact ? '6px 8px' : '7px 10px', borderRadius: 8, border: '1px solid #D6E2DB', fontSize: 12, ...styles.select }}
          >
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option} / page</option>)}
          </select>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...buttonStyle, ...(safePage <= 1 ? disabledStyle : null) }} disabled={safePage <= 1} onClick={() => onPageChange?.(safePage - 1)}>
          Prev
        </button>
        {pageNumbers.map((pageNumber, index) => {
          const previous = pageNumbers[index - 1]
          const gapBefore = previous && pageNumber - previous > 1
          return (
            <React.Fragment key={pageNumber}>
              {gapBefore ? <span style={{ fontSize: 12, color: '#94A3B8', padding: '0 2px' }}>…</span> : null}
              <button
                type="button"
                style={{ ...buttonStyle, ...(pageNumber === safePage ? activeButtonStyle : null) }}
                onClick={() => onPageChange?.(pageNumber)}
              >
                {pageNumber}
              </button>
            </React.Fragment>
          )
        })}
        <button type="button" style={{ ...buttonStyle, ...(safePage >= totalPages ? disabledStyle : null) }} disabled={safePage >= totalPages} onClick={() => onPageChange?.(safePage + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}
