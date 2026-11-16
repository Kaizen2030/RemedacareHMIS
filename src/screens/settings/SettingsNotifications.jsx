import { useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { notifyError, notifySuccess, notifyWarning } from '../../notifications'
import {
  DEFAULT_TEMPLATES,
  buildMessage,
  fetchNotificationConfig,
  isAutoIsolateTelegramEnabled,
  isAutoThresholdTelegramEnabled,
  normalizeNotificationConfig,
  saveNotificationConfig,
  sendAntibiogramTelegramNotification,
  sendPatientNotification,
} from '../../utils/notifications'

const VARIABLE_TOKENS = ['{{patient_name}}', '{{hospital_name}}', '{{result}}', '{{amount}}', '{{date_time}}', '{{drug_name}}', '{{test_name}}']

const NOTIFICATION_ROWS = [
  { key: 'lab_result', label: 'Lab result ready', description: 'Notify patients when a lab result is posted and marked Resulted.' },
  { key: 'prescription_ready', label: 'Prescription ready', description: 'Notify patients when the pharmacy releases a prescription for collection.' },
  { key: 'appointment_reminder', label: 'Appointment reminder', description: 'Used by the appointments module for reminder messages.' },
  { key: 'sha_claim_approved', label: 'SHA claim approved', description: 'Notify patients when their SHA claim is approved.' },
  { key: 'sha_claim_rejected', label: 'SHA claim rejected', description: 'Notify patients when their SHA claim is rejected.' },
  { key: 'outstanding_balance', label: 'Outstanding balance', description: 'Notify patients about unpaid balances.' },
]

function StatusBadge({ status, styles }) {
  const palette = status === 'Sent'
    ? { bg: '#E1F5EE', color: '#0F6E56' }
    : status === 'Skipped'
      ? { bg: '#FFF3DC', color: '#C07000' }
      : { bg: '#FCEBEB', color: '#A32D2D' }

  return (
    <span style={{ ...styles.pill, background: palette.bg, color: palette.color }}>
      {status}
    </span>
  )
}

export default function SettingsNotifications({ hospitalId, hospitalName, styles }) {
  const [connectionStatus, setConnectionStatus] = useState({ loading: true, configured: false, error: '' })
  const [notificationConfig, setNotificationConfig] = useState(() => normalizeNotificationConfig({}))
  const [expandedKey, setExpandedKey] = useState('')
  const [savingKey, setSavingKey] = useState('')
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testSending, setTestSending] = useState(false)
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [telegramTestSending, setTelegramTestSending] = useState(false)
  const [telegramTestResult, setTelegramTestResult] = useState(null)

  const patientIds = useMemo(
    () => [...new Set(logRows.map((row) => row.patient_id).filter(Boolean))],
    [logRows],
  )
  const [patientNames, setPatientNames] = useState({})

  useEffect(() => {
    if (!hospitalId) return
    void loadConfig()
    void checkConnection()
    void loadLogs()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId || patientIds.length === 0) {
      setPatientNames({})
      return
    }

    let active = true
    void (async () => {
      const { data } = await supabase
        .from('patients')
        .select('id,full_name')
        .in('id', patientIds)

      if (!active) return
      setPatientNames(Object.fromEntries((data || []).map((patient) => [patient.id, patient.full_name || 'Unknown patient'])))
    })()

    return () => {
      active = false
    }
  }, [hospitalId, patientIds])

  async function loadConfig() {
    const nextConfig = await fetchNotificationConfig(hospitalId)
    setNotificationConfig(nextConfig)
  }

  async function checkConnection() {
    setConnectionStatus({ loading: true, configured: false, error: '' })
    const result = await sendPatientNotification({
      hospitalName,
      hospitalId,
      notificationType: 'connection_check',
      dryRun: true,
    })

    setConnectionStatus({
      loading: false,
      configured: Boolean(result.configured || result.success),
      error: result.error || '',
    })
  }

  async function loadLogs() {
    if (!hospitalId) return
    setLogLoading(true)
    const { data } = await supabase
      .from('notification_log')
      .select('id,hospital_id,patient_id,notification_type,phone,message,status,sent_at,error_message')
      .eq('hospital_id', hospitalId)
      .order('sent_at', { ascending: false })
      .limit(50)
    setLogRows(data || [])
    setLogLoading(false)
  }

  async function persistConfig(nextConfig, successMessage = 'Notification settings saved.') {
    const result = await saveNotificationConfig(hospitalId, nextConfig)
    if (!result.success) {
      notifyError(`Error saving notification settings: ${result.error}`)
      return false
    }
    setNotificationConfig(nextConfig)
    notifySuccess(successMessage)
    return true
  }

  async function handleToggle(key) {
    const nextConfig = {
      ...notificationConfig,
      [key]: {
        ...notificationConfig[key],
        enabled: !notificationConfig[key]?.enabled,
      },
    }
    setSavingKey(key)
    await persistConfig(nextConfig, `${NOTIFICATION_ROWS.find((row) => row.key === key)?.label || 'Notification'} updated.`)
    setSavingKey('')
  }

  async function handleSaveTemplate(key) {
    setSavingKey(key)
    await persistConfig(notificationConfig, 'Notification template saved.')
    setSavingKey('')
  }

  function insertVariable(key, token) {
    setNotificationConfig((current) => ({
      ...current,
      [key]: {
        ...current[key],
        template: `${current[key]?.template || ''}${current[key]?.template?.endsWith(' ') ? '' : ' '}${token}`.trim(),
      },
    }))
  }

  async function handleSendTest() {
    const activeTemplate = notificationConfig.lab_result?.template || DEFAULT_TEMPLATES.lab_result
    const message = buildMessage(activeTemplate, {
      patient_name: 'Test Patient',
      hospital_name: hospitalName || 'RemedacareHMS',
      test_name: 'Full Blood Count',
    })

    setTestSending(true)
    const result = await sendPatientNotification({
      phone: testPhone,
      message,
      hospitalName,
      notificationType: 'lab_result',
      patientId: null,
      hospitalId,
    })
    setTestResult(result)
    setTestSending(false)
    await loadLogs()
  }

  async function handleSendTelegramTest() {
    const chatId = String(notificationConfig.telegram?.chat_id || '').trim()
    if (!chatId) {
      notifyWarning('Enter a Telegram chat ID first.')
      return
    }

    setTelegramTestSending(true)
    const result = await sendAntibiogramTelegramNotification({
      hospitalId,
      hospitalName,
      notificationType: 'telegram_test',
      message: `Test Telegram alert from ${hospitalName || 'RemedacareHMS'}. If you received this, Telegram notifications are configured correctly.`,
    })
    setTelegramTestResult(result)
    setTelegramTestSending(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>📡 Notifications</div>
        <div style={styles.cardBody}>
          <div style={{ ...styles.infoCard, borderColor: connectionStatus.configured ? '#B4E5D0' : '#F6D28B', background: connectionStatus.configured ? '#F0FDF4' : '#FFF8E7' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={styles.infoTitle}>Connection Status</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                  {connectionStatus.loading
                    ? 'Checking Africa\'s Talking Edge Function connection...'
                    : connectionStatus.configured
                      ? 'Connected'
                      : 'Not configured — add AT_API_KEY and AT_USERNAME to Supabase Edge Function secrets.'}
                </div>
                {!connectionStatus.loading && connectionStatus.error && (
                  <div style={{ fontSize: 12, color: '#A32D2D', marginTop: 6 }}>{connectionStatus.error}</div>
                )}
              </div>
              <div style={{ ...styles.pill, background: connectionStatus.configured ? '#E1F5EE' : '#FFF3DC', color: connectionStatus.configured ? '#0F6E56' : '#C07000', padding: '6px 10px' }}>
                {connectionStatus.loading ? 'Checking...' : connectionStatus.configured ? 'Connected' : 'Not configured'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>WhatsApp Business Credentials</div>
        <div style={styles.cardBody}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 }}>Account SID / Provider Account</label>
              <input
                style={styles.input}
                value={notificationConfig.credentials?.account_sid || ''}
                onChange={(event) => setNotificationConfig((prev) => ({
                  ...prev,
                  credentials: { ...(prev.credentials || {}), account_sid: event.target.value },
                }))}
                placeholder="WA-ACCOUNT-SID"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 }}>WhatsApp Phone Number</label>
              <input
                style={styles.input}
                value={notificationConfig.credentials?.phone_number || ''}
                onChange={(event) => setNotificationConfig((prev) => ({
                  ...prev,
                  credentials: { ...(prev.credentials || {}), phone_number: event.target.value },
                }))}
                placeholder="+2547XXXXXXXX"
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            These credentials are stored for your hospital notification configuration. The current notification send path still runs through the secured Supabase Edge Function.
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>Telegram Alerts</div>
        <div style={styles.cardBody}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 }}>Telegram Chat ID</label>
              <input
                style={styles.input}
                value={notificationConfig.telegram?.chat_id || ''}
                onChange={(event) => setNotificationConfig((prev) => ({
                  ...prev,
                  telegram: { ...(prev.telegram || {}), chat_id: event.target.value },
                }))}
                placeholder="-1001234567890"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #EEE', borderRadius: 12, background: '#FAFAFA' }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Auto threshold Telegram alerts</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Send a Telegram alert automatically when a new upload creates a threshold breach.</div>
              </div>
              <div
                style={{ width: 46, height: 26, borderRadius: 99, cursor: 'pointer', transition: 'background .2s', background: isAutoThresholdTelegramEnabled(notificationConfig) ? '#0F6E56' : '#ddd', position: 'relative', flexShrink: 0 }}
                onClick={() => setNotificationConfig((prev) => ({
                  ...prev,
                  telegram: {
                    ...(prev.telegram || {}),
                    auto_threshold_alerts: !isAutoThresholdTelegramEnabled(prev),
                  },
                }))}
              >
                <div style={{ position: 'absolute', top: 3, left: isAutoThresholdTelegramEnabled(notificationConfig) ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #EEE', borderRadius: 12, background: '#FAFAFA' }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Auto isolate Telegram alerts</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Send a Telegram alert for every new isolate saved from a VITEK/PDF upload.</div>
              </div>
              <div
                style={{ width: 46, height: 26, borderRadius: 99, cursor: 'pointer', transition: 'background .2s', background: isAutoIsolateTelegramEnabled(notificationConfig) ? '#0F6E56' : '#ddd', position: 'relative', flexShrink: 0 }}
                onClick={() => setNotificationConfig((prev) => ({
                  ...prev,
                  telegram: {
                    ...(prev.telegram || {}),
                    auto_isolate_upload_alerts: !isAutoIsolateTelegramEnabled(prev),
                  },
                }))}
              >
                <div style={{ position: 'absolute', top: 3, left: isAutoIsolateTelegramEnabled(notificationConfig) ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
              Save the chat ID here. Keep the bot token as a Supabase Edge Function secret named <strong>TELEGRAM_BOT_TOKEN</strong>.
              You can find the chat ID from Telegram or by calling <code>/getUpdates</code> on your bot API.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={styles.addBtn} onClick={() => void persistConfig(notificationConfig, 'Telegram settings saved.')}>
                Save Telegram Settings
              </button>
              <button style={styles.editBtn} onClick={() => void handleSendTelegramTest()} disabled={telegramTestSending || !String(notificationConfig.telegram?.chat_id || '').trim()}>
                {telegramTestSending ? 'Sending...' : 'Send Telegram Test'}
              </button>
            </div>
            {telegramTestResult && (
              <div style={{ marginTop: 4, fontSize: 12, color: telegramTestResult.success ? '#0F6E56' : telegramTestResult.skipped ? '#C07000' : '#A32D2D', fontWeight: 700 }}>
                {telegramTestResult.success ? 'Sent ✓' : telegramTestResult.skipped ? 'Skipped' : 'Failed ✕'}
                {telegramTestResult.error ? ` — ${telegramTestResult.error}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>🔔 Notification Toggles</div>
        <div style={styles.cardBody}>
          {NOTIFICATION_ROWS.map((row, index) => {
            const current = notificationConfig[row.key] || { enabled: false, template: DEFAULT_TEMPLATES[row.key] }
            const charCount = buildMessage(current.template, {
              patient_name: 'Patient',
              hospital_name: hospitalName || 'Hospital',
              amount: '1,000',
              date_time: '2026-05-15 10:00',
              drug_name: 'Amoxicillin',
              test_name: 'Full Blood Count',
            }).length
            const expanded = expandedKey === row.key
            const busy = savingKey === row.key

            return (
              <div key={row.key} style={{ padding: '16px 0', borderBottom: index < NOTIFICATION_ROWS.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{row.label}</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{row.description}</div>
                    <button
                      type="button"
                      style={{ border: 'none', background: 'none', color: '#0F6E56', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 0, marginTop: 8 }}
                      onClick={() => setExpandedKey(expanded ? '' : row.key)}
                    >
                      {expanded ? 'Hide template' : 'Edit template'}
                    </button>
                  </div>
                  <div style={{ width: 46, height: 26, borderRadius: 99, cursor: busy ? 'wait' : 'pointer', transition: 'background .2s', background: current.enabled ? '#0F6E56' : '#ddd', position: 'relative', flexShrink: 0 }} onClick={() => !busy && handleToggle(row.key)}>
                    <div style={{ position: 'absolute', top: 3, left: current.enabled ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                  </div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 14, background: '#FAFAFA', border: '1px solid #EEE', borderRadius: 12, padding: 14 }}>
                    <textarea
                      style={{ ...styles.input, minHeight: 110, resize: 'vertical' }}
                      value={current.template}
                      onChange={(event) => setNotificationConfig((prev) => ({
                        ...prev,
                        [row.key]: { ...prev[row.key], template: event.target.value },
                      }))}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {VARIABLE_TOKENS.map((token) => (
                        <button key={token} type="button" style={{ ...styles.editBtn, fontSize: 11 }} onClick={() => insertVariable(row.key, token)}>
                          {token}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, color: charCount > 160 ? '#A32D2D' : '#666', fontWeight: 600 }}>
                        {charCount}/160 characters
                      </div>
                      <button style={styles.addBtn} onClick={() => handleSaveTemplate(row.key)} disabled={busy}>
                        {busy ? 'Saving...' : 'Save Template'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>🧪 Test SMS</div>
        <div style={styles.cardBody}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,340px) auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 }}>Phone Number</label>
              <input style={styles.input} value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="07XXXXXXXX or +2547XXXXXXXX" />
            </div>
            <button style={styles.addBtn} onClick={handleSendTest} disabled={testSending || !testPhone.trim()}>
              {testSending ? 'Sending...' : 'Send Test SMS'}
            </button>
          </div>
          {testResult && (
            <div style={{ marginTop: 12, fontSize: 12, color: testResult.success ? '#0F6E56' : testResult.skipped ? '#C07000' : '#A32D2D', fontWeight: 700 }}>
              {testResult.success ? 'Sent ✓' : testResult.skipped ? 'Skipped' : 'Failed ✗'}
              {testResult.error ? ` — ${testResult.error}` : ''}
            </div>
          )}
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ ...styles.cardHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>📜 Notification Log</span>
          <button style={styles.editBtn} onClick={loadLogs} disabled={logLoading}>{logLoading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
        <div style={styles.cardBody}>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Type', 'Patient', 'Phone', 'Preview', 'Sent At', 'Status'].map((head) => <th key={head} style={styles.th}>{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {logRows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#888', padding: '24px' }}>
                      {logLoading ? 'Loading notification log...' : 'No notifications logged yet.'}
                    </td>
                  </tr>
                )}
                {logRows.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.td}>{row.notification_type || '—'}</td>
                    <td style={styles.td}>{patientNames[row.patient_id] || 'Unknown patient'}</td>
                    <td style={styles.td}>{row.phone || '—'}</td>
                    <td style={{ ...styles.td, maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.message || ''}>
                      {String(row.message || '').slice(0, 60)}
                    </td>
                    <td style={styles.td}>{row.sent_at ? new Date(row.sent_at).toLocaleString('en-KE') : '—'}</td>
                    <td style={styles.td}><StatusBadge status={row.status || 'Sent'} styles={styles} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

