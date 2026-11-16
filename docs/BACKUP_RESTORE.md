# Backup and Restore Guide

## Purpose

RemedacareHMS now includes an admin backup export designed for pilot recovery and operational assurance.

## What the backup includes

The hospital backup package exports hospital-scoped JSON for core operational tables such as:

- hospital profile and settings
- users and departments
- patients and visits
- consultations and vitals
- lab, radiology, prescriptions
- invoices and payments
- claims
- referrals
- chronic disease and care pathways
- audit and error logs
- FHIR audit logs

## How to export

1. Open `Settings`
2. Open the `System` tab
3. Go to `Rollout & Recovery`
4. Click `Export Full Backup Package`
5. Save the generated `.json` file to a secure backup location

## Recommended backup schedule

- Before first go-live
- End of each pilot day
- Before major configuration changes
- Before software upgrades
- Weekly during stable operations

## Storage recommendations

- Keep one copy on the local admin machine
- Keep one encrypted copy on external storage
- Keep one controlled cloud copy if policy allows

## Restore approach

The exported JSON is intended as a recovery artifact and audit-grade data capture for now.

Recommended restore workflow:

1. Identify affected module or data set
2. Open the backup file and confirm the relevant table payload
3. Reinsert or reconcile records via Supabase/admin recovery scripts
4. Validate counts and key records after restore

## Important cautions

- Export files contain sensitive clinical and financial data
- Only Admin users should handle backup files
- Store backups securely and limit access
- Do not email raw backup files without encryption

## Pilot recovery best practice

- Pair every backup with a support log for the same period
- Record why the backup was taken
- Record who exported it
- Keep a simple naming convention by hospital and date
