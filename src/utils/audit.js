export async function logAudit(supabase, {
  hospitalId, userRole, action,
  targetTable, targetId, details,
}) {
  try {
    await supabase.from('audit_log').insert({
      hospital_id: hospitalId,
      user_role: userRole,
      action,
      target_table: targetTable,
      target_id: targetId,
      details: JSON.stringify(details || {}),
      performed_at: new Date().toISOString(),
    })
  } catch (_) {
    // fire and forget — never block the UI
  }
}
