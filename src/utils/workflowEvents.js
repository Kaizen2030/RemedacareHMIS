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
