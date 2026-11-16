function popupOrNotify(title = 'Print Preview') {
  const popup = window.open('', '_blank', 'width=980,height=840')
  if (!popup) {
    window.notifyFromLegacyAlert?.(`Popup blocked. Please allow popups to preview ${title}.`)
    return null
  }
  return popup
}

export function buildLetterheadMarkup(hospitalProfile = {}) {
  const logo = hospitalProfile.logoBase64
    ? `<img src="${hospitalProfile.logoBase64}" alt="Hospital logo" style="width:64px;height:64px;object-fit:cover;border-radius:14px;border:1px solid #E5E7EB;" />`
    : `<div style="width:64px;height:64px;border-radius:14px;border:1px solid #E5E7EB;display:flex;align-items:center;justify-content:center;font-weight:800;color:#0F6E56;background:#EFF6F2;">RC</div>`

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:2px solid #E5E7EB;padding-bottom:14px;margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:14px;">
        ${logo}
        <div>
          <div style="font-size:22px;font-weight:800;color:#111827;">${hospitalProfile.name || 'RemedacareHMS'}</div>
          <div style="font-size:12px;color:#6B7280;">${hospitalProfile.address || ''} ${hospitalProfile.county ? `• ${hospitalProfile.county}` : ''}</div>
          <div style="font-size:12px;color:#6B7280;">${hospitalProfile.phone || ''} ${hospitalProfile.email ? `• ${hospitalProfile.email}` : ''}</div>
        </div>
      </div>
      <div style="font-size:11px;color:#6B7280;text-align:right;">
        <div>${hospitalProfile.facilityCode ? `MOH Code: ${hospitalProfile.facilityCode}` : ''}</div>
        <div>${hospitalProfile.shaProviderNumber ? `SHA Provider: ${hospitalProfile.shaProviderNumber}` : ''}</div>
      </div>
    </div>
  `
}

export function buildPrintPreviewDocument({ title, hospitalProfile, bodyHtml }) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F3F4F6; color: #111827; }
          .toolbar { position: sticky; top: 0; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 18px; background:#111827; color:#fff; z-index:10; }
          .toolbar button { border:none; border-radius:10px; padding:10px 14px; cursor:pointer; font-weight:700; }
          .toolbar .primary { background:#0F6E56; color:#fff; }
          .toolbar .secondary { background:#E5E7EB; color:#111827; }
          .sheet { max-width: 210mm; margin: 20px auto; background:#fff; min-height: 297mm; padding: 18mm 14mm; box-shadow: 0 18px 40px rgba(0,0,0,0.12); }
          @media print {
            .toolbar { display:none !important; }
            body { background:#fff; }
            .sheet { margin:0; max-width:none; min-height:auto; box-shadow:none; padding: 12mm; }
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div>
            <div style="font-size:16px;font-weight:800;">${title}</div>
            <div style="font-size:12px;color:#CBD5E1;">Preview before printing</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="secondary" onclick="window.close()">Close</button>
            <button class="primary" onclick="window.print()">Print</button>
          </div>
        </div>
        <div class="sheet">
          ${buildLetterheadMarkup(hospitalProfile)}
          ${bodyHtml}
        </div>
      </body>
    </html>
  `
}

export function openPrintPreview({ title = 'Print Preview', hospitalProfile = {}, bodyHtml = '' }) {
  const popup = popupOrNotify(title)
  if (!popup) return false
  popup.document.write(buildPrintPreviewDocument({ title, hospitalProfile, bodyHtml }))
  popup.document.close()
  popup.focus()
  return true
}

export const printTemplates = {
  receipt: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'Receipt Preview', hospitalProfile, bodyHtml }),
  labReport: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'Lab Report Preview', hospitalProfile, bodyHtml }),
  prescription: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'Prescription Preview', hospitalProfile, bodyHtml }),
  referralLetter: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'Referral Letter Preview', hospitalProfile, bodyHtml }),
  lpo: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'LPO Preview', hospitalProfile, bodyHtml }),
  dischargeSummary: (bodyHtml, hospitalProfile) => openPrintPreview({ title: 'Discharge Summary Preview', hospitalProfile, bodyHtml }),
}
