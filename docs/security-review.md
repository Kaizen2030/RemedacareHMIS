# RemedacareHMS — security and privacy review (14 Nov 2026)

Scope: the code in this repository and the parts of the live Supabase project visible through the check
scripts. The live access rules for older tables (patients, visits, consultations…) are not in this repository:
run `docs/sql/12_security_check.sql` to list them and send the result for fixing.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | Any user could make themselves admin or join another hospital (`hospital_users` / `staff` policies) | **Fixed** — `03_security_hardening.sql` (installed) |
| 2 | Critical | A member could take over a hospital via `hospitals.owner_email` / `network_id` | **Fixed** — `03` (installed) |
| 3 | High | Pharmacy released drugs before payment; lab / registration marked bills paid with no money | **Fixed** — cashier-only flow, pay-before-dispense |
| 4 | High | Audit log could be edited or deleted from the browser and recorded only a role, not a person | **Fixed** — `11_audit_privacy.sql`: append-only, user id + e-mail stamped, admins-only read |
| 5 | High | No record of who **viewed** a patient | **Fixed** — `patient_access_log` (Consultation, Wards, chronic care, HIV, maternity) |
| 6 | High | AI proxy usable by any signed-up account, any model, unlimited size; clinical text sent with phone / ID numbers | **Fixed** — hospital members only, model allow-list, 200 kB cap, identifiers redacted (redeploy needed) |
| 7 | High | Clinical changes not audited unless a screen remembered to | **Fixed** — triggers on patients, visits, consultations, prescriptions, labs, admissions, staff, HIV, TB, ANC, deliveries, NCD, MAR |
| 8 | High | HIV, TB and maternity data visible to every member (HR, cashiers) | **Fixed** — clinical-only RLS (`clin_can_access`) in `08` |
| 9 | Medium | No break-glass for sensitive patients | **Fixed** — confidential flag; reason required, 2-hour access, reviewed in Settings → Privacy |
| 10 | Medium | No Data Protection Act request handling | **Fixed** — request register with due dates, admin export (JSON), de-identification on erasure (clinical record retained) |
| 11 | Medium | Prescribing safety alerts never shown; pharmacy release impossible (no PIN field) | **Fixed** — decision support + PIN field |
| 12 | Medium | Offline queue retried refusals forever and could duplicate records | **Fixed** — network-only queueing, idempotent replay, conflict review |
| 13 | Medium | Payment gateway credentials stored as plain JSON (service-role only) | **Open** — not readable by staff; moving them into `hospital_secrets`/Vault needs a payments change (deferred, payments untouched) |
| 14 | High | Live check (14 Nov): the public key (anon, no login) held write + TRUNCATE rights on 130 tables and could call 60 owner-rights functions; `ppb_dispensing_flags` open to every hospital; `get_user_id_by_email` let anyone look up accounts | **Fixed** — `13_lockdown_public.sql`: anon loses all table/function access, TRUNCATE removed, PPB flags and purchase-order lines scoped to the hospital, e-mail lookup server-only; check now also flags views that skip RLS; `v_live_antibiogram` switched to security_invoker (it showed every hospital's lab data to logged-in users) |
| 18 | Critical | Four FHIR functions (fhir-patient, fhir-encounter, fhir-bundle, fhir-claim) live since May 2026 with **no sign-in check** and the service key: anyone with a hospital id could read patients and visits or submit claims; ids were pasted into database filters | **Fixed in code** — replaced by the authenticated FHIR API (`fhir`), fhir-bundle/fhir-claim now require sign-in, the other two return 410. Live until `deploy-payments.ps1` is re-run. Review `fhir_audit_log` for calls before the fix |
| 19 | High | All integration credentials (eTIMS secret, SHA API key and FHIR client secret, M-Pesa consumer secret/passkey, SMS key, NHIF password) and the admin Settings PIN were in hospital settings every member can read; the PIN was checked in the browser | **Fixed** — `16_secrets_and_referral_links.sql`: moved to server-only `hospital_secrets` (Supabase Vault when enabled), never sent back to browsers; PIN hashed, checked by the server, locks after 5 wrong tries; a trigger moves any credential written to settings again |
| 20 | Medium | Referral letter QR pointed to an endpoint that is now (correctly) login-only | **Fixed** — per-referral share link: random token, one visit only, 30-day expiry, 100 openings, revocable, every opening logged |
| 21 | Medium | Switching facility kept the home facility's role for menus | **Fixed** — role follows the active facility's staff record (the database already enforced it) |
| 22 | High | Supabase lets signed-in users run every new function by default; server-only functions (portal sign-in codes, create_gateway_refund / create_online_payment which trust a p_user argument, referral link and API-key lookups) were callable by any staff account. Found by the 17 install check | **Fixed** — `18_server_only_functions.sql`; new test reproduces Supabase default privileges |
| 15 | Low | Last role / hospital cached in `localStorage` (used for menus only; the database still decides access) | Accepted |
| 16 | Low | Password-reset token kept in `localStorage` during the reset flow | Open — move to `sessionStorage` and clear after use |
| 17 | Process | Penetration test, ODPC registration, DPIA, breach-notification procedure (72 h to ODPC) | **Open** — organisational, outside the code |

## How the controls work

- **Who can do what** is enforced in the database (row-level security + security-definer functions), not only in
  `src/access.js`. The screens hide buttons; the database refuses the action.
- **Audit**: every audited row records action, table, record id, changed fields (from → to), user id, e-mail and
  role. Rows cannot be changed or deleted through the API.
- **Access log**: a view is recorded once per user, patient and screen per 10 minutes; prints, exports,
  break-glass and de-identification are always recorded.
- **Break-glass**: confidential patients require a reason of 10+ characters; access lasts 2 hours and every
  break-glass event is listed for the administrator.
- **Erasure**: Kenyan health-record retention rules mean clinical records are kept; contact and identity
  details (phone, e-mail, address, ID, next of kin) are removed and the record is marked confidential.
  Confirm timelines and retention periods with your Data Protection Officer.

- **Fixed 2026-11-15 (docs/sql/32): clinical job titles not recognised.** `pay_canonical_role()` treated "Medical Officer", "Consultant", "Specialist", "General Practitioner", "Registrar", "Microbiologist", "Radiographer" (and others) as `unknown`, so those staff were refused by every clinical table that uses `clin_can_access()`. The app's `resolveRole()` recognised them only with exact capitals. Both now match these titles (ambiguous words only as the whole title, so "IT Specialist" stays non-clinical). Note: re-running 02_install_payments.sql would restore the old function — run 32 again afterwards.
