import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SettingsFhir from './SettingsFhir'

const { rpc, updates } = vi.hoisted(() => ({ rpc: vi.fn(), updates: [] }))
vi.mock('../../confirmDialog', () => ({ openConfirmDialog: vi.fn(async () => true) }))
vi.mock('../../supabase', () => {
  const tables = {
    fhir_clients: [{ id: 'k1', name: 'KHIS', key_prefix: 'rcf_ab12cd34', scopes: ['Patient'], active: true, expires_at: '2099-01-01', last_used_at: null }],
    fhir_audit_log: [{ id: 1, created_at: '2026-11-14T08:00:00Z', client_name: 'KHIS', action: 'search', resource_type: 'Patient', query: '?identifier=1', result_count: 1, status: 'ok', caller_ip: '41.90.1.1' }],
  }
  const from = (t) => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      update: (p) => { updates.push([t, p]); return q },
      then: (res, rej) => Promise.resolve({ data: tables[t], error: null }).then(res, rej) }
    return q
  }
  return { default: { from, rpc } }
})

describe('Settings → FHIR API', () => {
  it('lists keys and calls, creates a key that is shown once, and revokes', async () => {
    rpc.mockResolvedValue({ data: { id: 'k2', key: 'rcf_' + 'a'.repeat(64) }, error: null })
    render(<SettingsFhir hospitalId="h1" />)
    expect(await screen.findByText('rcf_ab12cd34…')).toBeTruthy()
    expect(screen.getByText('search Patient ?identifier=1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('System name'), { target: { value: 'Partner EMR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByText('rcf_' + 'a'.repeat(64))).toBeTruthy()
    expect(screen.getByText(/will not be shown again/)).toBeTruthy()
    expect(rpc).toHaveBeenCalledWith('fhir_client_create', expect.objectContaining({ p_hospital: 'h1', p_name: 'Partner EMR', p_days: 365, p_allow_confidential: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(updates[0][1]).toMatchObject({ active: false }))
  })
})
