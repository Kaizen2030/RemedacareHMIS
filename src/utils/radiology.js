import { openPrintPreview } from './printSystem'

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function openRadiologyReportPrintWindow(report = {}, hospitalName = 'RemedacareHMS') {
  const patient = report.patients || {}
  const bodyHtml = `
    <h1 style="margin:0 0 18px;font-size:22px;">Radiology Report</h1>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tbody>
        <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #E5E7EB;">Patient</th><td style="padding:8px;border-bottom:1px solid #E5E7EB;">${escapeHtml(patient.full_name || report.patient_name || '—')}</td></tr>
        <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #E5E7EB;">Modality</th><td style="padding:8px;border-bottom:1px solid #E5E7EB;">${escapeHtml(report.modality || '—')}</td></tr>
        <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #E5E7EB;">Body region</th><td style="padding:8px;border-bottom:1px solid #E5E7EB;">${escapeHtml(report.body_region || '—')}</td></tr>
        <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #E5E7EB;">Report date</th><td style="padding:8px;border-bottom:1px solid #E5E7EB;">${escapeHtml(report.report_date ? new Date(report.report_date).toLocaleDateString('en-KE') : '—')}</td></tr>
        <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #E5E7EB;">Status</th><td style="padding:8px;border-bottom:1px solid #E5E7EB;">${escapeHtml(report.status || '—')}</td></tr>
      </tbody>
    </table>
    <h2 style="font-size:16px;">Findings</h2>
    <p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(report.report_text || 'No findings recorded.')}</p>
    <h2 style="font-size:16px;">Impression</h2>
    <p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(report.impression || 'No impression recorded.')}</p>
  `

  return openPrintPreview({
    title: 'Radiology Report',
    hospitalProfile: { name: hospitalName },
    bodyHtml,
  })
}