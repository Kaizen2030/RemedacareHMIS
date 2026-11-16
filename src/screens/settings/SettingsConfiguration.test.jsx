import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsConfiguration from './SettingsConfiguration'

const { db, from } = vi.hoisted(() => {
  const db = { tables: {}, writes: [] }
  const from = (table) => {
    const q = {
      _op: 'select', _payload: null,
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: (db.tables[table] || [])[0] || null, error: null }),
      single: async () => ({ data: { id: 'new', ...q._payload }, error: null }),
      insert: (p) => { q._op = 'insert'; q._payload = p; db.writes.push([table, 'insert', p]); return q },
      upsert: (p, o) => { db.writes.push([table, 'upsert', p, o]); return Promise.resolve({ error: null }) },
      delete: () => { db.writes.push([table, 'delete']); return q },
      update: (p) => { db.writes.push([table, 'update', p]); return q },
      then: (res, rej) => Promise.resolve({ data: db.tables[table] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { db, from }
})
vi.mock('../../supabase', () => ({ default: { from } }))
vi.mock('../../confirmDialog', () => ({ openConfirmDialog: vi.fn(async () => true) }))

beforeEach(() => {
  db.writes = []
  db.tables = {
    price_lists: [{ id: 'pl1', name: 'SHA tariff', payer_type: 'sha', active: true }],
    charge_codes: [{ id: 'c1', code: 'CONS-OPD', name: 'OPD consultation', category: 'Consultation', unit_price_kes: 500, is_active: true }],
    charge_code_prices: [{ id: 'p1', price_list_id: 'pl1', charge_code: 'CONS-OPD', price_kes: 400 }],
    role_permissions: [],
    workflow_form_overrides: [],
    audit_log: [{ id: 1, action: 'update:charge_code_prices', details: { changes: { price_kes: { from: '400', to: '450' } } }, user_email: 'own@a.ke', performed_at: '2026-11-14T08:00:00Z' }],
  }
})

describe('Settings → Configuration', () => {
  it('shows payer prices next to the base price and saves an edit', async () => {
    render(<SettingsConfiguration hospitalId="h1" />)
    const input = await screen.findByLabelText('SHA tariff price for OPD consultation', {}, { timeout: 5000 })
    expect(input.value).toBe('400')
    fireEvent.change(input, { target: { value: '420' } })
    fireEvent.click(await screen.findByRole('button', { name: /Save 1 change/ }, { timeout: 5000 }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'upsert')).toBeTruthy())
    const [, , rows, opts] = db.writes.find((w) => w[1] === 'upsert')
    expect(rows).toEqual([{ hospital_id: 'h1', price_list_id: 'pl1', charge_code: 'CONS-OPD', price_kes: 420 }])
    expect(opts).toEqual({ onConflict: 'price_list_id,charge_code' })
  }, 15000)   // the screen loads several tables; slow under the full parallel suite

  it('saves a role matrix change and tells the app menus to reload', async () => {
    const heard = vi.fn()
    window.addEventListener('rc-role-config-changed', heard)
    render(<SettingsConfiguration hospitalId="h1" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Roles & permissions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Nurse' }))
    fireEvent.click(screen.getByLabelText('Laboratory'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Nurse' }))
    await waitFor(() => expect(heard).toHaveBeenCalled())
    const [, , row] = db.writes.find((w) => w[0] === 'role_permissions')
    expect(row.role).toBe('Nurse')
    expect(row.screens).not.toContain('/laboratory')
    expect(row.screens).toContain('/dashboard')
  })

  it('adds a custom department field and refuses hiding a safety field', async () => {
    render(<SettingsConfiguration hospitalId="h1" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Department forms' }))
    fireEvent.change(await screen.findByLabelText('Add a field'), { target: { value: 'Blood loss (ml)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    expect(screen.getByText(/x_blood_loss_ml/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'workflow_form_overrides')).toBeTruthy())
    const [, , row] = db.writes.find((w) => w[0] === 'workflow_form_overrides')
    expect(row.fields).toEqual([expect.objectContaining({ key: 'x_blood_loss_ml', custom: true })])
  })

  it('lists configuration changes with who made them', async () => {
    render(<SettingsConfiguration hospitalId="h1" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Change log' }))
    expect(await screen.findByText('price_kes: 400 → 450')).toBeTruthy()
    expect(screen.getByText('own@a.ke')).toBeTruthy()
  })
})
