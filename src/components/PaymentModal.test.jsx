import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  cancelPendingPayment: vi.fn(), errorMessage: vi.fn(async (e) => e.message), fetchPaymentStatus: vi.fn(),
  getPaymentSettings: vi.fn(), listInvoicePayments: vi.fn(), newIdempotencyKey: vi.fn(() => 'key-' + Math.random().toString(36).slice(2)),
  pollUntilSettled: vi.fn(), recordManualPayments: vi.fn(), refundPayment: vi.fn(), resolvePendingPayment: vi.fn(), startOnlinePayment: vi.fn(),
}))
vi.mock('../utils/payments/api', () => api)
vi.mock('../utils/payments/receipt', () => ({ printPaymentReceipt: vi.fn() }))

import PaymentModal from './PaymentModal'
import { printPaymentReceipt } from '../utils/payments/receipt'

const invoice = { id: 'inv-1', invoice_no: 'INV-1', patient_name: 'Jane Wanjiru', amount_kes: 5000, paid_kes: 0, balance_kes: 5000, status: 'Pending' }
const ENABLED = ['cash', 'mpesa', 'mpesa_manual', 'card_pos', 'bank_transfer', 'cheque']

function setup(role = 'Receptionist', payments = []) {
  api.getPaymentSettings.mockResolvedValue({ enabled_methods: ENABLED, allow_partial: true })
  api.listInvoicePayments.mockResolvedValue(payments)
  const onChanged = vi.fn()
  render(<PaymentModal invoice={invoice} hospitalId="h1" userRole={role} hospitalProfile={{ name: 'H' }} onClose={() => {}} onChanged={onChanged} />)
  return { onChanged }
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset?.()); api.errorMessage.mockImplementation(async (e) => e.message); api.newIdempotencyKey.mockImplementation(() => 'key-' + Math.random().toString(36).slice(2)) })

describe('PaymentModal', () => {
  it('prefills the open balance and records a cash payment', async () => {
    api.recordManualPayments.mockResolvedValue([{ id: 'p1', status: 'completed', receipt_no: 'RCP-2026-000001', method: 'cash', amount: 5000 }])
    setup()
    const amount = await screen.findByPlaceholderText('0')
    expect(amount.value).toBe('5000')
    fireEvent.click(screen.getByRole('button', { name: /Record KES 5,000/ }))
    await waitFor(() => expect(api.recordManualPayments).toHaveBeenCalledTimes(1))
    const arg = api.recordManualPayments.mock.calls[0][0]
    expect(arg.invoiceId).toBe('inv-1')
    expect(arg.lines).toHaveLength(1)
    expect(arg.lines[0]).toMatchObject({ method: 'cash', amount: '5000' })
    expect(arg.idempotencyKey).toBeTruthy()
    expect(await screen.findByText(/RCP-2026-000001/)).toBeTruthy()
  })

  it('blocks an invalid M-Pesa code client-side (no RPC call)', async () => {
    setup()
    await screen.findByPlaceholderText('0')
    fireEvent.click(screen.getByRole('button', { name: /M-Pesa \(code from till\/paybill\)/ }))
    const code = await screen.findByPlaceholderText('SGH7K2L9QX')
    fireEvent.change(code, { target: { value: 'BAD' } })
    fireEvent.click(screen.getByRole('button', { name: /^Record/ }))
    expect(await screen.findByText(/10 letters\/digits/)).toBeTruthy()
    expect(api.recordManualPayments).not.toHaveBeenCalled()
  })

  it('records a split (cash + M-Pesa code) in ONE call', async () => {
    api.recordManualPayments.mockResolvedValue([{ id: 'a', status: 'completed', receipt_no: 'R1' }, { id: 'b', status: 'completed', receipt_no: 'R2' }])
    setup()
    const first = await screen.findByPlaceholderText('0')
    fireEvent.change(first, { target: { value: '3500' } })
    fireEvent.click(screen.getByText(/Split payment/))
    // second line appears with the remaining 1500 prefilled; switch it to manual M-Pesa
    const selects = await screen.findAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], { target: { value: 'mpesa_manual' } })
    fireEvent.change(await screen.findByPlaceholderText('SGH7K2L9QX'), { target: { value: 'sgh7k2l9qx' } })
    expect(screen.getByText(/Left after this/).textContent).toMatch(/KES 0/)
    fireEvent.click(screen.getByRole('button', { name: /Record KES 5,000/ }))
    await waitFor(() => expect(api.recordManualPayments).toHaveBeenCalledTimes(1))
    const { lines } = api.recordManualPayments.mock.calls[0][0]
    expect(lines.map((l) => [l.method, String(l.amount)])).toEqual([['cash', '3500'], ['mpesa_manual', '1500']])
    expect(lines[1].reference).toBe('sgh7k2l9qx')
  })

  it('refuses to overpay', async () => {
    setup()
    const amount = await screen.findByPlaceholderText('0')
    fireEvent.change(amount, { target: { value: '5001' } })
    fireEvent.click(screen.getByRole('button', { name: /^Record/ }))
    expect(await screen.findByText(/more than the open balance/)).toBeTruthy()
    expect(api.recordManualPayments).not.toHaveBeenCalled()
  })

  it('M-Pesa STK: starts the request, shows waiting state, then confirms when paid', async () => {
    api.startOnlinePayment.mockResolvedValue({ payment: { id: 'stk-1', status: 'pending', amount: 5000, method: 'mpesa' }, action: { type: 'stk_push', message: 'Prompt sent' } })
    let settle
    api.pollUntilSettled.mockImplementation(() => new Promise((r) => { settle = r }))
    setup()
    await screen.findByPlaceholderText('0')
    fireEvent.click(screen.getByRole('button', { name: /M-Pesa \(STK Push\)/ }))
    fireEvent.change(await screen.findByPlaceholderText('0712 345 678'), { target: { value: '0712345678' } })
    fireEvent.click(screen.getByRole('button', { name: /Send payment request/ }))
    await waitFor(() => expect(api.startOnlinePayment).toHaveBeenCalledTimes(1))
    expect(api.startOnlinePayment.mock.calls[0][0]).toMatchObject({ invoiceId: 'inv-1', method: 'mpesa', amount: 5000, phone: '0712345678' })
    expect(await screen.findByText(/Waiting for the patient/)).toBeTruthy()
    api.listInvoicePayments.mockResolvedValue([{ id: 'stk-1', status: 'completed', kind: 'payment', amount: 5000, method: 'mpesa', receipt_no: 'RCP-9' }])
    settle({ id: 'stk-1', status: 'completed', receipt_no: 'RCP-9', amount: 5000 })
    expect(await screen.findByText(/Payment received/)).toBeTruthy()
  })

  it('STK: whole shillings only', async () => {
    setup()
    const amount = await screen.findByPlaceholderText('0')
    fireEvent.click(screen.getByRole('button', { name: /M-Pesa \(STK Push\)/ }))
    fireEvent.change(amount, { target: { value: '100.50' } })
    fireEvent.change(await screen.findByPlaceholderText('0712 345 678'), { target: { value: '0712345678' } })
    fireEvent.click(screen.getByRole('button', { name: /Send payment request/ }))
    expect(await screen.findByText(/whole shillings/)).toBeTruthy()
    expect(api.startOnlinePayment).not.toHaveBeenCalled()
  })

  it('roles without payment permission cannot record', async () => {
    setup('Nurse')
    expect(await screen.findByText(/cannot record payments/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Record/ })).toBeNull()
  })

  it('history: only finance roles see Refund; receptionist does not', async () => {
    const done = [{ id: 'p1', kind: 'payment', status: 'completed', method: 'cash', amount: 2000, receipt_no: 'RCP-1', created_at: '2026-11-14T08:00:00Z' }]
    setup('Receptionist', done)
    fireEvent.click(await screen.findByRole('button', { name: /History/ }))
    expect(await screen.findByText('RCP-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
  })
})

describe('PaymentModal receipts and permissions', () => {
  beforeEach(() => printPaymentReceipt.mockClear())

  it('prints the receipt with the invoice totals AFTER the payment, not the stale ones', async () => {
    const saved = { id: 'p1', kind: 'payment', status: 'completed', receipt_no: 'RCP-2026-000001', method: 'cash', amount: 5000 }
    api.recordManualPayments.mockResolvedValue([saved])
    setup()
    await screen.findByPlaceholderText('0')
    api.listInvoicePayments.mockResolvedValue([saved])
    fireEvent.click(screen.getByRole('button', { name: /Record KES 5,000/ }))
    await waitFor(() => expect(printPaymentReceipt).toHaveBeenCalledTimes(1))
    const { invoice: printed, lines } = printPaymentReceipt.mock.calls[0][0]
    expect(printed).toMatchObject({ paid_kes: 5000, balance_kes: 0, status: 'Paid' })
    expect(lines).toHaveLength(1)
  })

  it('prints every tender of a split on one receipt', async () => {
    const rows = [
      { id: 'a', kind: 'payment', status: 'completed', receipt_no: 'R1', method: 'cash', amount: 3500 },
      { id: 'b', kind: 'payment', status: 'completed', receipt_no: 'R2', method: 'mpesa_manual', amount: 1500, reference: 'SGH7K2L9QX' },
    ]
    api.recordManualPayments.mockResolvedValue(rows)
    setup()
    const first = await screen.findByPlaceholderText('0')
    fireEvent.change(first, { target: { value: '3500' } })
    fireEvent.click(screen.getByText(/Split payment/))
    const selects = await screen.findAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], { target: { value: 'mpesa_manual' } })
    fireEvent.change(await screen.findByPlaceholderText('SGH7K2L9QX'), { target: { value: 'SGH7K2L9QX' } })
    api.listInvoicePayments.mockResolvedValue(rows)
    fireEvent.click(screen.getByRole('button', { name: /Record KES 5,000/ }))
    await waitFor(() => expect(printPaymentReceipt).toHaveBeenCalledTimes(1))
    expect(printPaymentReceipt.mock.calls[0][0].lines.map((l) => l.receipt_no)).toEqual(['R1', 'R2'])
  })

  it('shows the server review warning when a code was re-used for the same patient', async () => {
    api.recordManualPayments.mockResolvedValue([{ id: 'p', kind: 'payment', status: 'completed', receipt_no: 'R9', method: 'mpesa_manual', amount: 5000, needs_review: true, review_note: 'Same reference also used on invoice INV-7' }])
    setup()
    await screen.findByPlaceholderText('0')
    fireEvent.click(screen.getByRole('button', { name: /M-Pesa \(code from till\/paybill\)/ }))
    fireEvent.change(await screen.findByPlaceholderText('SGH7K2L9QX'), { target: { value: 'SGH7K2L9QX' } })
    fireEvent.click(screen.getByRole('button', { name: /^Record/ }))
    expect(await screen.findByText(/also used on invoice INV-7/)).toBeTruthy()
  })

  it('a cashier (resolves to Accountant for screens) still cannot refund', async () => {
    const done = [{ id: 'p1', kind: 'payment', status: 'completed', method: 'cash', amount: 2000, receipt_no: 'RCP-1', created_at: '2026-11-14T08:00:00Z' }]
    setup('Cashier', done)
    fireEvent.click(await screen.findByRole('button', { name: /History/ }))
    expect(await screen.findByText('RCP-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
  })

  it('front desk cannot cancel a pending cheque (finance clears or bounces it)', async () => {
    const cheque = [{ id: 'c1', kind: 'payment', status: 'pending', method: 'cheque', amount: 1000, cheque_no: '004512', reference: '004512', created_at: '2026-11-14T08:00:00Z' }]
    setup('Receptionist', cheque)
    fireEvent.click(await screen.findByRole('button', { name: /History/ }))
    expect(await screen.findByText('004512')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cleared' })).toBeNull()
  })
})

describe('PaymentModal (finance role)', () => {
  it('accountant can refund a completed payment through the API', async () => {
    const done = [{ id: 'p1', kind: 'payment', status: 'completed', method: 'cash', provider: 'manual', amount: 2000, receipt_no: 'RCP-1', created_at: '2026-11-14T08:00:00Z' }]
    api.refundPayment.mockResolvedValue({ receipt_no: 'RFD-1' })
    setup('Accountant', done)
    fireEvent.click(await screen.findByRole('button', { name: /History/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    expect(await screen.findByText(/Enter a refund reason/)).toBeTruthy()
    const reason = screen.getAllByRole('textbox').find((i) => i.value === '' )
    fireEvent.change(within(document.body).getByText(/Reason \(required/).parentElement.querySelector('input'), { target: { value: 'Overcharged' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(1))
    expect(api.refundPayment.mock.calls[0][0]).toMatchObject({ amount: 2000, reason: 'Overcharged' })
    expect(reason).toBeDefined()
  })
})
