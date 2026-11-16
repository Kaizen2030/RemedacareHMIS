export function getWorkflowVisitUpdate(config, status) {
  const route = config?.visitRouting?.[status]
  if (!route) return null
  return {
    status: route.status,
    speciality: route.speciality,
    ...(route.assignedDoctor === null ? { assigned_doctor_name: null } : {}),
  }
}
