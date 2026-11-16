import type { Provider, ProviderName } from '../types.ts'
import { daraja } from './daraja.ts'
import { paystack } from './paystack.ts'
import { flutterwave } from './flutterwave.ts'
import { pesapal } from './pesapal.ts'

export const providers: Record<ProviderName, Provider> = { daraja, paystack, flutterwave, pesapal }
export const getProvider = (name: string): Provider => {
  const p = (providers as Record<string, Provider>)[name]
  if (!p) throw new Error(`Unknown payment provider: ${name}`)
  return p
}
