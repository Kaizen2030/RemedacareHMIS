import supabase from '../supabase'
import { getSusceptibilityEntries } from './hospitalSignals'

export const DEFAULT_TEMPLATES = {
  lab_result: 'Dear {{patient_name}}, your {{test_name}} result from {{hospital_name}} is ready. Please visit to collect your report.',
  prescription_ready: 'Dear {{patient_name}}, your prescription is ready for collection at {{hospital_name}} Pharmacy.',
  appointment_reminder: 'Dear {{patient_name}}, reminder: you have an appointment at {{hospital_name}} on {{date_time}}. Reply CANCEL to cancel.',
  sha_claim_approved: 'Dear {{patient_name}}, your SHA claim of KES {{amount}} at {{hospital_name}} has been APPROVED.',
  sha_claim_rejected: 'Dear {{patient_name}}, your SHA claim at {{hospital_name}} was not approved. Please visit the billing desk.',
  outstanding_balance: 'Dear {{patient_name}}, you have an outstanding balance of KES {{amount}} at {{hospital_name}}. Please settle at your earliest.',
}

const CONFIG_KEYS = Object.keys(DEFAULT_TEMPLATES)

export function getDefaultNotificationConfig() {
  return {
    credentials: {
      provider: 'WhatsApp Business',
      account_sid: '',
      phone_number: '',
    },
    telegram: {
      chat_id: '',
      auto_threshold_alerts: true,
      auto_isolate_upload_alerts: true,
    },
    ...Object.fromEntries(
      CONFIG_KEYS.map((key) => [key, { enabled: false, template: DEFAULT_TEMPLATES[key] }]),
    ),
  }
}

function normalizeNotificationEntry(key, value) {
  return {
    enabled: Boolean(value?.enabled),
    template: String(value?.template || DEFAULT_TEMPLATES[key] || '').trim() || DEFAULT_TEMPLATES[key],
  }
}

export function normalizeNotificationConfig(value) {
  const base = getDefaultNotificationConfig()
  if (!value || typeof value !== 'object') return base

  const telegramSource = value.telegram && typeof value.telegram === 'object'
    ? value.telegram
    : {}
  const telegramChatId = String(
    telegramSource.chat_id
      || telegramSource.chatId
      || value.telegram_chat_id
      || value.telegramChatId
      || value.credentials?.telegram_chat_id
      || value.credentials?.telegramChatId
      || '',
  ).trim()
  const autoThresholdAlerts = telegramSource.auto_threshold_alerts
    ?? telegramSource.autoThresholdAlerts
    ?? value.telegram_auto_threshold_alerts
    ?? value.telegramAutoThresholdAlerts
    ?? true
  const autoIsolateUploadAlerts = telegramSource.auto_isolate_upload_alerts
    ?? telegramSource.autoIsolateUploadAlerts
    ?? value.telegram_auto_isolate_upload_alerts
    ?? value.telegramAutoIsolateUploadAlerts
    ?? true

  const merged = {
    ...base,
    credentials: {
      ...base.credentials,
      ...(value.credentials || {}),
    },
    telegram: {
      ...base.telegram,
      ...(telegramSource || {}),
      chat_id: telegramChatId,
      auto_threshold_alerts: Boolean(autoThresholdAlerts),
      auto_isolate_upload_alerts: Boolean(autoIsolateUploadAlerts),
    },
  }

  CONFIG_KEYS.forEach((key) => {
    merged[key] = normalizeNotificationEntry(key, value[key])
  })

  return merged
}

async function readInvokeError(error) {
  if (!error) return 'Notification request failed.'

  if (error.context && typeof error.context.text === 'function') {
    const raw = await error.context.text()
    try {
      const parsed = JSON.parse(raw)
      return parsed?.error || parsed?.message || raw || error.message
    } catch {
      return raw || error.message
    }
  }

  return error.message || 'Notification request failed.'
}

export async function sendPatientNotification({
  phone,
  message,
  hospitalName,
  notificationType,
  patientId,
  hospitalId,
  dryRun = false,
}) {
  try {
    const { data, error } = await supabase.functions.invoke('send-notification', {
      body: {
        phone,
        message,
        hospital_name: hospitalName,
        notification_type: notificationType,
        patient_id: patientId,
        hospital_id: hospitalId,
        dry_run: dryRun,
      },
    })

    if (error) {
      return {
        success: false,
        skipped: false,
        configured: false,
        messageId: null,
        error: await readInvokeError(error),
      }
    }

    return {
      success: Boolean(data?.success),
      skipped: Boolean(data?.skipped),
      configured: data?.configured ?? true,
      messageId: data?.messageId || null,
      error: data?.error || null,
    }
  } catch (error) {
    return {
      success: false,
      skipped: false,
      configured: false,
      messageId: null,
      error: error instanceof Error ? error.message : 'Notification request failed.',
    }
  }
}

export async function sendAntibiogramTelegramNotification({
  hospitalId,
  hospitalName,
  message,
  notificationType = 'antibiogram_upload',
  parseMode = null,
  dryRun = false,
}) {
  try {
    const { data, error } = await supabase.functions.invoke('telegram-notify', {
      body: {
        hospital_id: hospitalId,
        hospital_name: hospitalName,
        notification_type: notificationType,
        message,
        parse_mode: parseMode || undefined,
        dry_run: dryRun,
      },
    })

    if (error) {
      return {
        success: false,
        skipped: false,
        configured: false,
        messageId: null,
        error: await readInvokeError(error),
      }
    }

    return {
      success: Boolean(data?.success),
      skipped: Boolean(data?.skipped),
      configured: data?.configured ?? true,
      messageId: data?.messageId || null,
      error: data?.error || null,
    }
  } catch (error) {
    return {
      success: false,
      skipped: false,
      configured: false,
      messageId: null,
      error: error instanceof Error ? error.message : 'Telegram request failed.',
    }
  }
}

export function buildMessage(template, variables = {}) {
  const source = String(template || '').trim()
  const merged = Object.entries(variables || {}).reduce((acc, [key, value]) => {
    acc[key] = value == null ? '' : String(value)
    return acc
  }, {})

  let message = source || ''
  ;['patient_name', 'hospital_name', 'result', 'amount', 'date_time', 'drug_name', 'test_name'].forEach((token) => {
    const value = merged[token] || ''
    message = message.replaceAll(`{{${token}}}`, value)
  })

  message = message.replace(/\s+/g, ' ').trim()
  if (message.length <= 160) return message
  return `${message.slice(0, 157).trimEnd()}...`
}

function escapeTelegramHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatTelegramSir(entry) {
  const sir = String(entry?.sir || 'NT').trim().toUpperCase() || 'NT'
  const raw = String(entry?.display || entry?.raw || '').trim()
  const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/)
  if (percentMatch) return `${sir} ${percentMatch[1]}%`
  if (!raw || raw.toUpperCase() === sir) return sir
  return `${sir} ${raw}`
}

function deriveAntibiogramFlag(row) {
  if (!row) return 'CLEAR'
  const organism = String(row.organism_identified || '').trim()
  if (row.esbl && row.mrsa && row.carbapenem_r) return 'ESBL / MRSA / CRE'
  if (row.esbl) return 'ESBL'
  if (row.mrsa) return 'MRSA'
  if (row.carbapenem_r) {
    return /acinetobacter|klebsiella|pseudomonas/i.test(organism) ? 'CRE / CRB' : 'CRE'
  }
  return 'CLEAR'
}

function buildAntibiogramDrugSummary(row, maxDrugs = 6) {
  const entries = getSusceptibilityEntries(row, { includeNotTested: false })
  if (!entries.length) return 'No susceptibility results recorded'

  return entries
    .slice(0, maxDrugs)
    .map((entry) => `${String(entry.label || '').trim()}: ${formatTelegramSir(entry)}`)
    .join(' • ')
}

function buildTelegramTopBlock({ hospitalName, title, fileName, rowIndex, totalRows }) {
  const parts = [
    `<b>${escapeTelegramHtml(title)}</b>`,
    `<b>Hospital:</b> ${escapeTelegramHtml(hospitalName || 'Brightpath Travel Scholars')}`,
  ]
  if (fileName) parts.push(`<b>File:</b> ${escapeTelegramHtml(fileName)}`)
  if (Number.isFinite(rowIndex) && Number.isFinite(totalRows)) parts.push(`<b>Row:</b> ${rowIndex}/${totalRows}`)
  return parts.join('\n')
}

function sirEmoji(sir) {
  const code = String(sir || 'NT').trim().toUpperCase()
  if (code === 'S') return '🟢'
  if (code === 'I') return '🟠'
  if (code === 'R') return '🔴'
  return '⚪'
}

function inferUploadConfidence(row) {
  const entries = getSusceptibilityEntries(row, { includeNotTested: false })
  if (entries.length >= 10) return 'High'
  if (entries.length >= 5) return 'Medium'
  return 'Low'
}

function buildUploadAlertText(flag) {
  const normalized = String(flag || 'CLEAR').trim().toUpperCase()
  if (normalized === 'CLEAR') return 'No critical resistance pattern detected.'
  if (normalized.includes('CRE') || normalized.includes('CRB')) {
    return 'Carbapenem resistance detected. Possible CRE/CRAB/CRPA. Escalate immediately. Contact infection control.'
  }
  if (normalized.includes('MRSA')) {
    return 'Methicillin resistance detected. Escalate according to infection prevention protocol.'
  }
  if (normalized.includes('ESBL')) {
    return 'Extended-spectrum beta-lactamase pattern detected. Review cephalosporin use.'
  }
  return 'Review this isolate manually.'
}

export function buildAntibiogramIsolateTelegramMessage({ hospitalName, fileName, row, rowIndex = null, totalRows = null }) {
  const patient = escapeTelegramHtml(String(row?.patient_name || 'Unknown patient').trim())
  const organism = escapeTelegramHtml(String(row?.organism_identified || 'Unknown organism').trim())
  const specimen = escapeTelegramHtml(String(row?.sample_type || 'Unknown sample').trim())
  const ward = escapeTelegramHtml(String(row?.ward_department || 'Unassigned').trim())
  const growth = escapeTelegramHtml(String(row?.growth || '—').trim())
  const flag = escapeTelegramHtml(deriveAntibiogramFlag(row))
  const summary = buildAntibiogramDrugSummary(row)

  return [
    buildTelegramTopBlock({
      hospitalName,
      title: '🧫 Antibiogram isolate saved',
      fileName,
      rowIndex,
      totalRows,
    }),
    '',
    `<b>Patient:</b> ${patient}`,
    `<b>Organism:</b> ${organism}`,
    `<b>Specimen:</b> ${specimen}`,
    `<b>Ward:</b> ${ward}`,
    `<b>Growth:</b> ${growth}`,
    `<b>Flag:</b> ${flag}`,
    '',
    `<b>S/I/R:</b>`,
    `• ${escapeTelegramHtml(summary).replace(/\n/g, ' ')}`,
    '',
    `<i>Review the Antibiogram screen for the full isolate and grid view.</i>`,
  ].join('\n').trim()
}

export function buildAntibiogramThresholdTelegramMessage({ hospitalName, alert, reviewerName = '', fileName = '' }) {
  const organism = escapeTelegramHtml(String(alert?.organism || 'Unknown organism').trim())
  const antibiotic = escapeTelegramHtml(String(alert?.label || 'Unknown antibiotic').trim())
  const resistant = escapeTelegramHtml(String(alert?.percentResistant ?? '0'))
  const threshold = escapeTelegramHtml(String(alert?.resistance_threshold_pct ?? '0'))
  const sampleCount = escapeTelegramHtml(String(alert?.sampleCount ?? '0'))
  const spec = escapeTelegramHtml(String(alert?.specimen_type || alert?.sampleType || 'All specimens').trim())
  const department = escapeTelegramHtml(String(alert?.department || 'All departments').trim())
  const reviewer = escapeTelegramHtml(String(reviewerName || 'Stewardship team'))

  return [
    buildTelegramTopBlock({
      hospitalName,
      title: '🚨 Threshold breach alert',
      fileName,
    }),
    '',
    `<b>Organism:</b> ${organism}`,
    `<b>Antibiotic:</b> ${antibiotic}`,
    `<b>Resistance:</b> ${resistant}%`,
    `<b>Threshold:</b> ${threshold}%`,
    `<b>Sample count:</b> ${sampleCount}`,
    `<b>Specimen:</b> ${spec}`,
    `<b>Department:</b> ${department}`,
    '',
    `<i>${reviewer}: review stewardship action now.</i>`,
  ].join('\n').trim()
}

export function buildAntibiogramUploadTelegramMessage({ hospitalName, fileName, rows = [] }) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const flagCounts = safeRows.reduce((acc, row) => {
    const flag = deriveAntibiogramFlag(row)
    if (!flag || flag === 'CLEAR') return acc
    acc[flag] = (acc[flag] || 0) + 1
    return acc
  }, {})

  const flagSummary = Object.entries(flagCounts)
    .map(([flag, count]) => `${flag} ${count}`)
    .join(' • ')

  const bodyRows = safeRows.slice(0, 6).map((row) => {
    const patient = escapeTelegramHtml(String(row.patient_name || 'Unknown patient').trim())
    const organism = escapeTelegramHtml(String(row.organism_identified || 'Unknown organism').trim())
    const specimen = escapeTelegramHtml(String(row.sample_type || 'Unknown sample').trim())
    const ward = escapeTelegramHtml(String(row.ward_department || 'Unassigned').trim())
    const growth = escapeTelegramHtml(String(row.growth || '—').trim())
    const flag = escapeTelegramHtml(deriveAntibiogramFlag(row))
    const summary = buildAntibiogramDrugSummary(row)
    return `• <b>${patient}</b> | ${organism} | ${specimen} | ${flag} | ${ward} | ${growth}\n  ${escapeTelegramHtml(summary)}`
  })

  const remaining = safeRows.length - bodyRows.length
  const footer = [
    flagSummary ? `<b>Flags:</b> ${escapeTelegramHtml(flagSummary)}` : '',
    remaining > 0 ? `<i>... and ${remaining} more row(s).</i>` : '',
    '<i>Review the Antibiogram module for the full susceptibility details.</i>',
  ].filter(Boolean)

  return [
    buildTelegramTopBlock({
      hospitalName,
      title: '🧫 Antibiogram upload saved',
      fileName: fileName || 'VITEK PDF',
    }),
    '',
    `<b>Rows saved:</b> ${safeRows.length}`,
    '',
    ...bodyRows,
    '',
    ...footer,
  ].join('\n').trim()
}

export function buildAntibiogramUploadTelegramLegacyMessage({ hospitalName, fileName, rows = [] }) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const flagCounts = safeRows.reduce((acc, row) => {
    const flag = deriveAntibiogramFlag(row)
    if (!flag || flag === 'CLEAR') return acc
    acc[flag] = (acc[flag] || 0) + 1
    return acc
  }, {})

  const flagSummary = Object.entries(flagCounts)
    .map(([flag, count]) => `${flag} ${count}`)
    .join(' • ')

  const sections = safeRows.slice(0, 10).flatMap((row, index) => {
    const patient = escapeTelegramHtml(String(row.patient_name || 'Unknown patient').trim())
    const organism = escapeTelegramHtml(String(row.organism_identified || 'Unknown organism').trim())
    const specimen = escapeTelegramHtml(String(row.sample_type || 'Unknown sample').trim())
    const ward = escapeTelegramHtml(String(row.ward_department || 'Unassigned').trim())
    const growth = escapeTelegramHtml(String(row.growth || '—').trim())
    const flag = escapeTelegramHtml(deriveAntibiogramFlag(row))
    const confidence = escapeTelegramHtml(inferUploadConfidence(row))
    const alertText = escapeTelegramHtml(buildUploadAlertText(flag))
    const entries = getSusceptibilityEntries(row, { includeNotTested: false })
    const limitedEntries = entries.slice(0, 20)
    const remaining = entries.length - limitedEntries.length
    const method = escapeTelegramHtml(String(row.test_method || 'VITEK / PDF upload').trim())

    return [
      index === 0 ? '' : '',
      `<b>🦠 Organism:</b> ${organism}`,
      `<b>🧪 Test Method:</b> ${method}`,
      `<b>👤 Patient:</b> ${patient}`,
      `<b>📊 Confidence:</b> ${confidence}`,
      `<b>🚨 Flag:</b> ${flag}`,
      `<b>📋</b> ${alertText}`,
      '',
      `<b>🔬 Antibiogram Results (${entries.length} antibiotics):</b>`,
      ...limitedEntries.map((entry) => `${sirEmoji(entry.sir)} ${escapeTelegramHtml(String(entry.label || '').trim())} ${escapeTelegramHtml(formatTelegramSir(entry))}`),
      remaining > 0 ? `<i>...and ${remaining} more antibiotic(s).</i>` : '',
      '',
      `<i>Sample:</i> ${specimen} • <i>Ward:</i> ${ward} • <i>Growth:</i> ${growth}`,
      '',
    ].filter(Boolean)
  })

  return [
    `<b>AntibiogramNet</b>`,
    `<b>🏨 ${escapeTelegramHtml(hospitalName || 'Brightpath Travel Scholars')}</b>`,
    `<b>🕐 ${escapeTelegramHtml(new Date().toISOString())}</b>`,
    fileName ? `<b>📄 File:</b> ${escapeTelegramHtml(fileName)}` : '',
    '',
    `<b>Rows saved:</b> ${safeRows.length}`,
    flagSummary ? `<b>Flags:</b> ${escapeTelegramHtml(flagSummary)}` : '',
    '',
    ...sections,
    `<i>This message was sent automatically from Brightpath Travel Scholars.</i>`,
  ].filter(Boolean).join('\n').trim()
}

export function buildAntibiogramUploadTelegramCompactMessage({ hospitalName, fileName, rows = [] }) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const primaryRow = safeRows
    .slice()
    .sort((a, b) => String(b.collection_date || b.reported_date || b.created_at || '').localeCompare(String(a.collection_date || a.reported_date || a.created_at || '')))[0]
    || safeRows[0]

  const patient = String(primaryRow?.patient_name || 'Unknown patient').trim()
  const organism = String(primaryRow?.organism_identified || 'Unknown organism').trim()
  const specimen = String(primaryRow?.sample_type || 'Unknown sample').trim()
  const ward = String(primaryRow?.ward_department || 'Unassigned').trim()
  const growth = String(primaryRow?.growth || '—').trim()
  const flag = deriveAntibiogramFlag(primaryRow)
  const confidence = inferUploadConfidence(primaryRow)
  const alertText = buildUploadAlertText(flag)
  const method = String(primaryRow?.test_method || 'VITEK / PDF upload').trim()
  const entries = primaryRow ? getSusceptibilityEntries(primaryRow, { includeNotTested: false }) : []

  return [
    'AntibiogramNet',
    `Hospital: ${hospitalName || 'Brightpath Travel Scholars'}`,
    `Time: ${new Date().toISOString()}`,
    fileName ? `File: ${fileName}` : '',
    '',
    `Organism: ${organism}`,
    `Test Method: ${method}`,
    `Patient: ${patient}`,
    `Confidence: ${confidence}`,
    `Flag: ${flag}`,
    `Alert: ${alertText}`,
    '',
    `Antibiogram Results (${entries.length} antibiotics):`,
    ...entries.slice(0, 20).map((entry) => `${sirEmoji(entry.sir)} ${String(entry.label || '').trim()} ${formatTelegramSir(entry)}`),
    '',
    `Sample: ${specimen} | Ward: ${ward} | Growth: ${growth}`,
  ].filter(Boolean).join('\n').trim()
}

export async function fetchNotificationConfig(hospitalId) {
  if (!hospitalId) return getDefaultNotificationConfig()

  const { data, error } = await supabase
    .from('hospital_settings')
    .select('notification_config')
    .eq('hospital_id', hospitalId)
    .maybeSingle()

  if (error || !data?.notification_config) {
    return getDefaultNotificationConfig()
  }

  return normalizeNotificationConfig(data.notification_config)
}

export async function saveNotificationConfig(hospitalId, notificationConfig) {
  if (!hospitalId) return { success: false, error: 'Missing hospital identifier.' }

  const payload = {
    hospital_id: hospitalId,
    notification_config: normalizeNotificationConfig(notificationConfig),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('hospital_settings')
    .upsert(payload, { onConflict: 'hospital_id' })

  return { success: !error, error: error?.message || null }
}

export function getNotificationSetting(notificationConfig, key) {
  return normalizeNotificationConfig(notificationConfig)[key] || { enabled: false, template: DEFAULT_TEMPLATES[key] || '' }
}

export function isAutoThresholdTelegramEnabled(notificationConfig) {
  return Boolean(normalizeNotificationConfig(notificationConfig).telegram?.auto_threshold_alerts)
}

export function isAutoIsolateTelegramEnabled(notificationConfig) {
  return Boolean(normalizeNotificationConfig(notificationConfig).telegram?.auto_isolate_upload_alerts)
}

export function buildAntibiogramUploadTelegramCompactMessageLegacy({ hospitalName, fileName, rows = [] }) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const primaryRow = safeRows[0] || null
  const remaining = Math.max(0, safeRows.length - 1)

  const flagCounts = safeRows.reduce((acc, row) => {
    const flag = deriveAntibiogramFlag(row)
    if (!flag || flag === 'CLEAR') return acc
    acc[flag] = (acc[flag] || 0) + 1
    return acc
  }, {})

  const flagSummary = Object.entries(flagCounts)
    .map(([flag, count]) => `${flag} ${count}`)
    .join(' • ')

  const entries = primaryRow ? getSusceptibilityEntries(primaryRow, { includeNotTested: false }) : []
  const patient = String(primaryRow?.patient_name || 'Unknown patient').trim()
  const organism = String(primaryRow?.organism_identified || 'Unknown organism').trim()
  const specimen = String(primaryRow?.sample_type || 'Unknown sample').trim()
  const ward = String(primaryRow?.ward_department || 'Unassigned').trim()
  const growth = String(primaryRow?.growth || '—').trim()
  const flag = deriveAntibiogramFlag(primaryRow)
  const confidence = inferUploadConfidence(primaryRow)
  const alertText = buildUploadAlertText(flag)
  const method = String(primaryRow?.test_method || 'VITEK / PDF upload').trim()
  const maxLines = 12

  return [
    'AntibiogramNet',
    `🏨 ${hospitalName || 'Brightpath Travel Scholars'}`,
    `🕐 ${new Date().toISOString()}`,
    fileName ? `📄 File: ${fileName}` : '',
    '',
    `Rows saved: ${safeRows.length}`,
    remaining > 0 ? `+ ${remaining} more isolate(s) saved in this upload.` : '',
    flagSummary ? `Flags: ${flagSummary}` : '',
    '',
    `🦠 Organism: ${organism}`,
    `🧪 Test Method: ${method}`,
    `👤 Patient: ${patient}`,
    `📊 Confidence: ${confidence}`,
    `🚨 Flag: ${flag}`,
    `📋 ${alertText}`,
    '',
    `🔬 Antibiogram Results (${entries.length} antibiotics):`,
    ...entries.slice(0, maxLines).map((entry) => `${sirEmoji(entry.sir)} ${String(entry.label || '').trim()} ${formatTelegramSir(entry)}`),
    '',
    `Sample: ${specimen} | Ward: ${ward} | Growth: ${growth}`,
    '',
    'This message was sent automatically from Brightpath Travel Scholars.',
  ].filter(Boolean).join('\n').trim()
}
