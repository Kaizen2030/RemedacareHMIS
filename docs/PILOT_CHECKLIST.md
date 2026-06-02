# Brightpath Travel Scholars Pilot Checklist

## Before go-live

- [ ] Latest desktop installer is deployed to all pilot machines
- [ ] Supabase production project is confirmed
- [ ] Edge Functions are deployed
- [ ] Settings reviewed:
  - [ ] hospital profile
  - [ ] branding
  - [ ] claims
  - [ ] FHIR
  - [ ] notifications
- [ ] Staff accounts created and tested
- [ ] Departments and rooms configured
- [ ] Charge codes and service catalog verified
- [ ] Opening backup exported

## Role testing

- [ ] Reception can register patients and book appointments
- [ ] Nurses can triage and record vitals
- [ ] Doctors can consult, prescribe, refer, use care pathways, and manage chronic follow-up
- [ ] Lab staff can receive and complete test orders
- [ ] Radiology staff can receive and update imaging orders
- [ ] Pharmacy can dispense and manage stock
- [ ] Billing can invoice and receive payments
- [ ] Admin can manage settings, reports, staff, and recovery tools

## End-to-end workflow tests

- [ ] Walk-in outpatient
- [ ] Lab order workflow
- [ ] Radiology order workflow
- [ ] Admission workflow
- [ ] Insurance/SHA claim workflow
- [ ] Referral workflow
- [ ] Chronic disease follow-up visit
- [ ] FHIR export / bundle generation

## Performance checks

- [ ] Patients list paginates correctly
- [ ] Department queues paginate correctly
- [ ] Inventory loads with pagination
- [ ] Radiology, M-Pesa, eTIMS, HR, Referrals, Chronic Disease, and Antibiogram lists page correctly
- [ ] No screen freezes with large record counts

## Go-live day

- [ ] Support log CSV downloaded
- [ ] Module owners assigned
- [ ] Escalation contact list shared
- [ ] First live patient completed successfully
- [ ] Backup export validated at end of day

## After go-live

- [ ] Review support log
- [ ] Fix top recurring issues
- [ ] Re-train teams where needed
- [ ] Export weekly backup
- [ ] Confirm reporting totals match operational activity
