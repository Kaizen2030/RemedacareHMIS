export type PaymentMethod =
  | 'cash' | 'mpesa' | 'mpesa_manual' | 'airtel_money' | 'card_online'
  | 'card_pos' | 'bank_transfer' | 'cheque' | 'other'

export type ProviderName = 'daraja' | 'paystack' | 'flutterwave' | 'pesapal'

export interface PaymentRow {
  id: string
  hospital_id: string
  invoice_id: string
  patient_id: string | null
  visit_id: string | null
  kind: 'payment' | 'refund'
  method: PaymentMethod
  provider: ProviderName | 'manual'
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'reversed'
  amount: number | string
  currency: string
  reference: string | null
  provider_reference: string | null
  payer_name: string | null
  payer_phone: string | null
  payer_email: string | null
  provider_payload: Record<string, unknown> | null
  created_at: string
  last_checked_at?: string | null
  needs_review?: boolean
  review_note?: string | null
}

export interface Credentials {
  environment: 'sandbox' | 'live'
  [key: string]: string
}

export interface InitiateContext {
  creds: Credentials
  payment: PaymentRow
  callbackUrl: string // server-to-server webhook URL
  returnUrl: string // where the browser returns after hosted checkout
  email: string
  description: string
}

export interface InitiateResult {
  providerReference: string
  action: { type: 'stk_push' | 'redirect'; url?: string; message: string }
  safe?: Record<string, unknown>
}

export interface VerifyResult {
  status: 'completed' | 'failed' | 'pending'
  amount?: number
  currency?: string
  receipt?: string // human reference (M-Pesa code etc.)
  fee?: number
  failureReason?: string
  channelMethod?: PaymentMethod
  cardBrand?: string
  cardLast4?: string
  extra?: Record<string, unknown> // whitelisted, non-sensitive provider fields
}

export interface Provider {
  initiate(ctx: InitiateContext): Promise<InitiateResult>
  verify(creds: Credentials, payment: PaymentRow): Promise<VerifyResult>
  refund?(creds: Credentials, payment: PaymentRow, amount: number, reason: string):
    Promise<{ providerReference: string }>
}
