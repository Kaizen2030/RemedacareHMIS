# Multi-facility: how it works and how to move existing data

## The model

| Need | How RemedacareHMS does it |
|---|---|
| A facility | One row in `hospitals`. Every record carries that facility's `hospital_id`, so `hospital_id` **is** the facility id. A second `facility_id` column would duplicate it, so none is added. |
| An organisation with several sites | Facilities that share a `network_id` in `hospitals` (named in `hospital_networks`). |
| Access by facility | Row-level security on every table checks membership of the record's `hospital_id` (`pay_is_member`, `clin_can_access`, `priv_is_admin`). Staff at site A cannot read site B unless they are also members of B. |
| Per-site roles | One `hospital_users` row (and one `staff` row) per person per facility. The same person can be a Doctor at A and an Admin at B. Since this step, the app also switches **menus and screens** to the role at the active site. The database already enforced the per-site role. |
| Facility switcher | The top bar lists every facility the user belongs to. Switching changes the active `hospital_id` for all screens and loads that site's role matrix. |
| One patient, several sites | `patients.mpi_id`, the master patient index. Patients → **From another facility** finds a patient at a sister site (by ID, SHA number, phone, patient number or name). It copies their details (not their clinical notes) and links both records. **Records at our other facilities** on the patient shows visits, diagnoses and medicines from the linked sites to clinical staff. Each look is logged at the site that holds the record. |
| Head-office view | Reports → **All facilities**: patients, visits today and this month, and unpaid balances per facility the administrator manages. |

## Moving an existing single-site hospital to several sites

1. **Install** `docs/sql/16` and `17` (Supabase SQL Editor, "Run without RLS").
2. **Create the network** once, in SQL:
   ```sql
   insert into hospital_networks(id, name) values (gen_random_uuid(), 'Your Organisation') returning id;
   update hospitals set network_id = '<that id>' where id = '<main hospital id>';
   ```
3. **Add each new site.** The owner signs up the site (creating a `hospitals` row) and sets the same `network_id`. Only an administrator of a facility in the network can do this; the `sec_guard_hospitals` trigger checks it.
4. **Give staff access.** In Settings → Staff at each site, add the people who work there, with their role at that site. A clinician covering two sites gets a staff record at both.
5. **Prices, forms and roles are per site.** Copy them if the sites should match (Settings → Configuration at each site).
6. **Existing patients stay where they were registered.** Nothing is moved. When a patient first visits another site, reception uses **From another facility** instead of registering them again; this links the two records from then on.
7. **Duplicates registered before linking existed.** Find them with Patients → duplicate check at each site, then link them in SQL:
   ```sql
   update patients set mpi_id = '<id of the patient at the first site>' where id in ('<id at site 2>', '<id at site 3>');
   ```
   Do not delete either record: each keeps its own visits and bills.
8. **Check.** Log in as a member of only one site and confirm that site B's patients do not appear in site A's lists. Then confirm Reports → All facilities shows only the sites you administer.

## What stays separate on purpose

- Bills, payments, stock and cash-up stay per site. Each site has its own cashier queue and ledger.
- Clinical notes are not copied between sites. They are read in place, with an access-log entry at the owning site.
- Confidential patients are never offered for copying and never appear in another site's search or history.
