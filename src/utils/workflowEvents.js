// Events reach every screen in this tab, and (via BroadcastChannel) every other RemedacareHMS tab
// on this computer — e.g. the cashier's queue refreshes the moment the lab orders a test.
// Other computers are updated by Supabase Realtime subscriptions on each screen.
let channel = null
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('remedacare-workflow')
    channel.onmessage = (msg) => {
      const { name, detail } = msg?.data || {}
      if (typeof name === 'string' && name.startsWith('remedacare:')) {
        try { window.dispatchEvent(new CustomEvent(name, { detail: { ...(detail || {}), fromOtherTab: true } })) } catch (_) {}
      }
    }
  }
} catch (_) { channel = null }

// Forward every hospital event raised in this tab — including the many screens that call
// window.dispatchEvent directly — to the other tabs. Events that came from another tab are not echoed.
const SHARED_EVENTS = ['remedacare:workflow_changed', 'remedacare:prescriptions_changed', 'remedacare:antibiogram_updated', 'remedacare:stewardship_changed']
if (channel && typeof window !== 'undefined') {
  for (const name of SHARED_EVENTS) {
    window.addEventListener(name, (event) => {
      if (event?.detail?.fromOtherTab) return
      try { channel.postMessage({ name, detail: JSON.parse(JSON.stringify(event?.detail || {})) }) } catch (_) {}
    })
  }
}

function dispatchHospitalEvent(name, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  } catch (_) {}
}

export function broadcastWorkflowChanged(detail = {}) {
  dispatchHospitalEvent('remedacare:workflow_changed', detail)
}

export function broadcastPrescriptionsChanged(detail = {}) {
  dispatchHospitalEvent('remedacare:prescriptions_changed', detail)
}

export function broadcastAntibiogramUpdated(detail = {}) {
  dispatchHospitalEvent('remedacare:antibiogram_updated', detail)
}

export function broadcastStewardshipChanged(detail = {}) {
  dispatchHospitalEvent('remedacare:stewardship_changed', detail)
}
