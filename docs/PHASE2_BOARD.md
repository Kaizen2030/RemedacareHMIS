# Brightpath Travel Scholars Phase 2 Board

Phase 2 is about enterprise hardening: trust, recoverability, traceability, and operational visibility.

## In Progress

- [x] Harden offline queue metadata and retry backoff
- [x] Surface offline queue failures in Settings
- [x] Surface recent client errors in Settings

## Reliability

- [ ] Add manual "retry now" and "clear failed action" controls for offline queue
- [ ] Add background retry worker for notification jobs
- [ ] Add background retry worker for referral FHIR sends
- [ ] Add background retry worker for SHA direct FHIR submissions
- [ ] Add submission/job health dashboard for integrations
- [ ] Add startup self-check for required tables and hospital settings

## Permissions and Audit

- [ ] Expand audit logging to all sensitive writes:
  - [ ] patient merge
  - [ ] prescription override
  - [ ] referral status changes
  - [ ] chronic disease enrollment edits
  - [ ] settings changes by section
- [ ] Add admin-only audit filters by user, patient, table, and date
- [ ] Add approval flow for selected destructive actions

## Data Quality

- [ ] Normalize patient phone and national ID matching everywhere
- [ ] Add duplicate-patient detection dashboard
- [ ] Add charge-code validation and missing-code alerts
- [ ] Add drug dictionary cleanup workflow for inconsistent medication names

## Performance

- [ ] Review all remaining summary widgets for server-side aggregation
- [ ] Add virtualization to very large registry-style tables
- [ ] Add memoized chart/data selectors for heavy analytics screens
- [ ] Add pagination to any newly introduced table by default

## Clinical Safety

- [ ] Expand CDS rule library and severity tuning
- [ ] Add renal/pregnancy warnings where applicable
- [ ] Add protocol adherence stats for Care Pathways
- [ ] Add missed follow-up reminders for chronic disease cohorts

## Reporting and Monitoring

- [ ] Add system-health export for offline queue, client errors, and integration failures
- [ ] Add scheduled executive summary report
- [ ] Add facility-level KPI dashboard:
  - [ ] chronic follow-up overdue
  - [ ] pending referrals
  - [ ] failed claims
  - [ ] failed eTIMS submissions

## Rollout Readiness

- [ ] Pilot checklist for one live facility
- [ ] Admin troubleshooting guide
- [ ] Data backup and restore procedure
- [ ] Go-live support log template

## Suggested Implementation Order

1. Manual retry/clear controls for failed offline actions
2. Broader audit log coverage
3. Job dashboards for SHA / FHIR / notifications
4. Deduplication and data quality tools
5. KPI and operations reporting
