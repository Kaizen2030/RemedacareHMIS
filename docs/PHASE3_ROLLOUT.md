# Phase 3 Rollout Readiness

Phase 3 turns RemedacareHMS from a feature-rich HMS into a go-live-ready hospital platform.

## Objectives

- Prepare a real facility for pilot deployment with low operational risk.
- Give admins tools for backup, recovery, and support logging.
- Standardize how teams handle training, incidents, and cutover.
- Improve procurement confidence through clear rollout documentation.

## Deliverables

- Rollout and recovery tools in `Settings > System`
  - Download go-live support log
  - Export full backup package
- Pilot readiness checklist
- Backup and restore guide
- Department and high-volume screen pagination
- Offline queue health visibility
- Recent client error visibility

## Go-Live Workstreams

### 1. Environment readiness

- Confirm Supabase production project is correct.
- Confirm all required secrets are present.
- Confirm Edge Functions are deployed.
- Confirm hospital profile, branding, and claims/FHIR settings are complete.

### 2. Data readiness

- Validate departments, branches, rooms, charge codes, and staff.
- Validate opening patient imports if any.
- Verify payer mappings and insurance packages.
- Export baseline backup before first live use.

### 3. User readiness

- Train reception, nursing, doctors, lab, pharmacy, billing, and admin separately.
- Use the go-live support log for every user issue during pilot week.
- Assign an owner for each module during rollout.

### 4. Technical readiness

- Test login and role access for each user category.
- Test printing paths for invoices, referral letters, and summaries.
- Test offline queue behavior on unstable internet.
- Confirm latest packaged `.exe` is installed on all workstations.

### 5. Operational readiness

- Run at least one end-to-end patient journey:
  - registration
  - consultation
  - labs/radiology
  - prescription
  - billing
  - claim/referral if relevant
- Confirm dashboard and reports reflect the transactions.

## Pilot Success Metrics

- No blocking patient-care issue remains unresolved for more than 30 minutes.
- Critical modules can recover from temporary internet interruption.
- Staff can complete core workflows without developer intervention.
- Daily backups are exported successfully.
- Support issues trend down after day 3 of go-live.

## Known Phase 3 Admin Tools

- `Download Go-Live Support Log`
  - gives a CSV template for issue tracking during rollout
- `Export Full Backup Package`
  - exports a hospital-scoped JSON backup bundle for disaster recovery

## Recommended Pilot Order

1. Registration and appointments
2. Consultation and prescriptions
3. Laboratory and radiology
4. Billing and claims
5. Referrals and chronic disease workflows
6. FHIR interoperability and SHA direct submission

## Exit Criteria

Phase 3 is considered complete when:

- the pilot site runs daily operations using RemedacareHMS
- support issues are documented and resolved through the support log
- backup export is validated
- no major screen breaks under realistic data volume
- module owners sign off on their workflows
