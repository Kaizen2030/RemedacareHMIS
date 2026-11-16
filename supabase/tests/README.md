# Payments tests

| What | Command (from the project root) | Needs |
|---|---|---|
| Database rules — runs the real migration on PGlite (Postgres 16 in WebAssembly) and asserts roles, split payments, reference rules, refunds, the legacy bridge, back-fill and re-runs | `npm run test:db` (first time: `npm --prefix supabase/tests/db install`) | Node 18+ only — no Postgres, Docker or Supabase |
| Edge functions — gateway adapters (Daraja, Paystack, Flutterwave, Pesapal) and `applyResult` with mocked HTTP | `npm test` (file `supabase/tests/edge-payments.test.ts`) | — |
| Browser — validation, money maths, receipts, payment screen | `npm test` (`src/utils/payments/*.test.js`, `src/components/PaymentModal.test.jsx`) | — |

`db/stub.sql` imitates the Supabase pieces the migration relies on (`auth.users`, `auth.uid()`, roles, and the
app's own `hospitals`, `hospital_users`, `staff`, `invoices`, `mpesa_transactions` tables) with the same role
data shapes the app writes. If your real schema differs, change the stub first and the tests will tell you
what breaks.

Nothing here talks to a live gateway. Sandbox testing against Daraja / Paystack / Flutterwave / Pesapal is
still required before go-live (see docs/payments.md).
