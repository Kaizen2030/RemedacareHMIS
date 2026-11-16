// Sources behind the clinical rules in RemedacareHMS, grouped by topic. Shown on the Clinical references page
// (/references) and linked from the screens that use them. When a rule is changed, update its source here.
// `url` is a stable home page or DOI; `where` names the screens and docs/sql files that implement the rule.

export const REFERENCE_TOPICS = [
  ['microbiology', 'Microbiology & AMR'],
  ['laboratory', 'Laboratory, critical results & TDM'],
  ['renal', 'Renal function & dialysis'],
  ['hiv_tb', 'HIV, TB & maternal health'],
  ['nursing', 'Nursing, emergency & critical care'],
  ['clinics', 'Specialty clinics & growth'],
  ['infection', 'Infection prevention'],
  ['reporting', 'Coding, reporting & standards'],
  ['law', 'Kenyan law & administration'],
  ['reading', 'Further reading (external sites)'],
]

// External articles are linked, not copied: their owners reserve all rights (e.g. Manual of Medicine's terms
// prohibit republishing, reproducing or redistributing its content). Descriptions below are our own.
const MOM = 'Manual of Medicine (manualofmedicine.com) — read on the publisher\'s site; content not reproduced'

export const CLINICAL_REFERENCES = [
  // ---------------------------------------------------------------- microbiology
  { topic: 'microbiology', title: 'EUCAST Clinical Breakpoint Tables, version 16.1 (valid from 24 June 2026)', publisher: 'European Committee on Antimicrobial Susceptibility Testing', year: 2026,
    url: 'https://www.eucast.org/clinical_breakpoints/', where: 'Microbiology surveillance → Breakpoints; docs/sql/39',
    note: 'MIC and zone breakpoints for Enterobacterales, Pseudomonas, Acinetobacter, staphylococci, enterococci, streptococci, S. pneumoniae and H. influenzae. Cite as: The European Committee on Antimicrobial Susceptibility Testing. Breakpoint tables for interpretation of MICs and zone diameters. Version 16.1, 2026. Re-use permitted with reference to EUCAST; not for resale.' },
  { topic: 'microbiology', title: 'EUCAST Expected Resistant Phenotypes and Expert Rules', publisher: 'EUCAST', year: 2023, url: 'https://www.eucast.org/',
    where: 'Microbiology surveillance (intrinsic resistance, MRSA / ESBL / carbapenem rules)', note: 'Organisms reported resistant to agents they are naturally resistant to; susceptible results for those agents are flagged for checking.' },
  { topic: 'microbiology', title: 'Multidrug-resistant, extensively drug-resistant and pandrug-resistant bacteria: an international expert proposal for interim standard definitions for acquired resistance',
    publisher: 'Magiorakos AP et al. Clinical Microbiology and Infection 2012;18:268–281', year: 2012, url: 'https://doi.org/10.1111/j.1469-0691.2011.03570.x',
    where: 'Microbiology surveillance (MDR / possible XDR / XDR / PDR)', note: 'Antimicrobial categories per organism group. Because EUCAST I means "susceptible, increased exposure", only R is counted as non-susceptible.' },
  { topic: 'microbiology', title: 'CLSI M39 — Analysis and Presentation of Cumulative Antimicrobial Susceptibility Test Data', publisher: 'Clinical and Laboratory Standards Institute', year: null,
    url: 'https://clsi.org/', where: 'Microbiology surveillance → Antibiogram', note: 'First isolate per patient per organism per period; organisms with fewer than 30 isolates flagged.' },
  { topic: 'microbiology', title: 'WHONET — microbiology laboratory database software and BacLink', publisher: 'WHO Collaborating Centre for Surveillance of Antimicrobial Resistance (Brigham and Women\'s Hospital)', year: null,
    url: 'https://whonet.org/', where: 'Microbiology surveillance → WHONET export', note: 'Organism codes (eco, kpn, sau …) and field names (CIP_EM, AMP_ED10 …) follow WHONET conventions. WHONET reference files are not bundled (non-commercial licence).' },
  { topic: 'microbiology', title: 'Global Antimicrobial Resistance and Use Surveillance System (GLASS)', publisher: 'World Health Organization', year: null,
    url: 'https://www.who.int/initiatives/glass', where: 'WHONET export for national reporting', note: 'Kenya reports AMR data through the national programme to GLASS.' },
  { topic: 'microbiology', title: 'ASTM E1394 / CLSI LIS02 — transfer of information between clinical instruments and computer systems', publisher: 'ASTM International / CLSI', year: null,
    url: 'https://www.astm.org/', where: 'Microbiology surveillance → Instrument import', note: 'Record layout (H, P, O, R, L) used to read instrument files. Vendor-specific interface documents (e.g. bioMérieux BCI) are available to customers from the vendor.' },

  // ---------------------------------------------------------------- laboratory
  { topic: 'laboratory', title: 'National Patient Safety Goal NPSG.02.03.01 — report critical results of tests and diagnostic procedures on a timely basis', publisher: 'The Joint Commission', year: null,
    url: 'https://www.jointcommission.org/', where: 'Critical results & TDM → Critical results; docs/sql/40', note: 'Written procedure, defined time frames, documentation of who was told and read-back of verbal results.' },
  { topic: 'laboratory', title: 'Basic Skills in Interpreting Laboratory Data, 7th edition', publisher: 'Lee M (ed.). American Society of Health-System Pharmacists', year: 2022, url: null,
    where: 'Critical results & TDM → Drug levels; drug–lab advisories', note: 'Therapeutic ranges (aminoglycosides, vancomycin, digoxin, lithium, phenytoin, carbamazepine, valproate, theophylline) and drug-induced laboratory changes. Ranges vary by laboratory — confirm locally.' },
  { topic: 'laboratory', title: 'Therapeutic monitoring of vancomycin for serious MRSA infections: a revised consensus guideline', publisher: 'Rybak MJ et al. ASHP / IDSA / PIDS / SIDP. Am J Health-Syst Pharm 2020;77:835–864', year: 2020,
    url: 'https://doi.org/10.1093/ajhp/zxaa036', where: 'Drug levels — vancomycin', note: 'AUC/MIC 400–600 preferred over trough-only monitoring.' },
  { topic: 'laboratory', title: 'Testing.com — laboratory test information', publisher: 'OneCare Media (formerly Lab Tests Online)', year: null,
    url: 'https://www.testing.com/', where: 'Reference ranges background', note: 'Patient-friendly explanation of common tests.' },
  { topic: 'laboratory', title: 'Delta checks, auto-verification and turnaround-time monitoring (CLSI EP33 and AUTO10 concepts)', publisher: 'Clinical and Laboratory Standards Institute', year: null,
    url: 'https://clsi.org/', where: 'Laboratory → Quality; docs/sql/34', note: 'Built-in limits are defaults; each laboratory sets its own.' },

  // ---------------------------------------------------------------- renal
  { topic: 'renal', title: 'New creatinine- and cystatin C-based equations to estimate GFR without race (CKD-EPI 2021)', publisher: 'Inker LA et al. N Engl J Med 2021;385:1737–1749', year: 2021,
    url: 'https://doi.org/10.1056/NEJMoa2102953', where: 'Drug levels (eGFR)', note: 'Race-free creatinine equation, adults.' },
  { topic: 'renal', title: 'Prediction of creatinine clearance from serum creatinine', publisher: 'Cockcroft DW, Gault MH. Nephron 1976;16:31–41', year: 1976,
    url: 'https://doi.org/10.1159/000180580', where: 'Drug levels (CrCl)', note: 'Used by most drug labels for renal dose adjustment.' },
  { topic: 'renal', title: 'Second generation logarithmic estimates of single-pool variable volume Kt/V', publisher: 'Daugirdas JT. J Am Soc Nephrol 1993;4:1205–1213', year: 1993,
    url: null, where: 'Dialysis → sessions (URR, Kt/V); docs/sql/29', note: null },
  { topic: 'renal', title: 'ISO 23500 — preparation and quality management of fluids for haemodialysis and related therapies', publisher: 'International Organization for Standardization (with AAMI)', year: null,
    url: 'https://www.iso.org/', where: 'Dialysis → Water quality; docs/sql/38', note: 'Total chlorine < 0.1 mg/L; bacteria < 100 CFU/mL (action 50); endotoxin < 0.25 EU/mL (action 0.125).' },

  // ---------------------------------------------------------------- HIV / TB / maternal
  { topic: 'hiv_tb', title: 'Kenya HIV Prevention and Treatment Guidelines (2022 edition)', publisher: 'Ministry of Health Kenya — NASCOP', year: 2022, url: 'https://www.nascop.or.ke/',
    where: 'HIV & TB care (ART, viral load schedule, TPT); docs/sql/08, 37', note: 'Viral load at 3 months then 6- or 12-monthly; < 50 copies LDL; EAC when ≥ 200.' },
  { topic: 'hiv_tb', title: 'Kenya HIV Testing Services guidelines (serial testing algorithm)', publisher: 'Ministry of Health Kenya — NASCOP', year: null, url: 'https://www.nascop.or.ke/',
    where: 'HIV & TB care → HIV testing', note: 'Screening test then confirmatory test; discordant = inconclusive, retest.' },
  { topic: 'hiv_tb', title: 'National TB, Leprosy and Lung Disease Programme guidelines', publisher: 'Ministry of Health Kenya — NTLD-P', year: null, url: null,
    where: 'HIV & TB care → TB treatment, defaulter tracing', note: 'Phases, follow-up sputum at months 2, 5 and 6, treatment outcomes.' },
  { topic: 'hiv_tb', title: 'PEPFAR Monitoring, Evaluation and Reporting (MER) indicator reference guide', publisher: 'U.S. President\'s Emergency Plan for AIDS Relief', year: null, url: null,
    where: 'HIV & TB care → Programme indicators', note: 'HTS_TST, TX_NEW, TX_CURR, TX_ML, TX_RTT, TX_PVLS, TX_TB, TB_PREV definitions.' },
  { topic: 'hiv_tb', title: 'WHO recommendations on antenatal care for a positive pregnancy experience', publisher: 'World Health Organization', year: 2016,
    url: 'https://www.who.int/publications/i/item/9789241549912', where: 'Maternity → ANC (8 contacts)', note: null },
  { topic: 'hiv_tb', title: 'MOH 405 (ANC register), MOH 406 (maternity register), MOH 711 and MOH 731 reporting tools', publisher: 'Ministry of Health Kenya — Division of Health Informatics (KHIS)', year: null, url: null,
    where: 'Maternity registers; Reports → MOH; docs/sql/10, 28', note: null },

  // ---------------------------------------------------------------- nursing / emergency / ICU
  { topic: 'nursing', title: 'National Early Warning Score (NEWS2)', publisher: 'Royal College of Physicians, London', year: 2017, url: 'https://www.rcp.ac.uk/',
    where: 'Wards → Observations; docs/sql/23', note: null },
  { topic: 'nursing', title: 'Brighton Paediatric Early Warning Score (PEWS)', publisher: 'Monaghan A. Paediatric Nursing 2005;17(1):32–35', year: 2005, url: null, where: 'Wards → Observations (children)', note: null },
  { topic: 'nursing', title: 'Braden Scale for predicting pressure sore risk; Morse Fall Scale', publisher: 'Bergstrom N, Braden B et al. (1987); Morse JM et al. (1989)', year: null, url: null, where: 'Wards → Risk assessments', note: null },
  { topic: 'nursing', title: 'South African Triage Scale (SATS / TEWS) and WHO Emergency Triage Assessment and Treatment (ETAT+)', publisher: 'Emergency Medicine Society of South Africa; World Health Organization', year: null, url: null,
    where: 'Emergency → Triage; docs/sql/20', note: null },
  { topic: 'nursing', title: 'The SOFA (Sepsis-related Organ Failure Assessment) score', publisher: 'Vincent JL et al. Intensive Care Med 1996;22:707–710', year: 1996, url: 'https://doi.org/10.1007/BF01709751',
    where: 'ICU → daily SOFA; docs/sql/24', note: null },
  { topic: 'nursing', title: 'WHO Surgical Safety Checklist', publisher: 'World Health Organization', year: 2009, url: 'https://www.who.int/', where: 'Theatre; docs/sql/21', note: null },

  // ---------------------------------------------------------------- clinics
  { topic: 'clinics', title: 'WHO Child Growth Standards (0–5 years) and the WHO anthro reference data', publisher: 'World Health Organization', year: 2006,
    url: 'https://www.who.int/tools/child-growth-standards', where: 'Consultation → Growth chart; docs/sql/31', note: 'LMS z-scores; data from github.com/WorldHealthOrganization/anthro.' },
  { topic: 'clinics', title: 'PHQ-9 and GAD-7', publisher: 'Kroenke K et al. J Gen Intern Med 2001;16:606–613; Spitzer RL et al. Arch Intern Med 2006;166:1092–1097', year: null, url: null, where: 'Specialty templates → Mental health', note: null },
  { topic: 'clinics', title: 'Columbia Suicide Severity Rating Scale (screen) and AUDIT-C', publisher: 'Posner K et al. (Columbia University); Bush K et al. 1998', year: null, url: null, where: 'Specialty templates → Mental health', note: null },
  { topic: 'clinics', title: 'CHA2DS2-VASc stroke risk score; NYHA functional class', publisher: 'Lip GYH et al. Chest 2010;137:263–272; New York Heart Association', year: null, url: null, where: 'Specialty templates → Cardiology', note: null },
  { topic: 'clinics', title: 'WHO classification of visual impairment (ICD-11)', publisher: 'World Health Organization', year: null, url: null, where: 'Specialty templates → Eye', note: null },
  { topic: 'clinics', title: 'Barthel Index of activities of daily living', publisher: 'Mahoney FI, Barthel DW. Md State Med J 1965;14:61–65', year: 1965, url: null, where: 'Specialty templates → Physiotherapy', note: null },

  // ---------------------------------------------------------------- infection prevention
  { topic: 'infection', title: 'Guideline for Isolation Precautions: Preventing Transmission of Infectious Agents in Healthcare Settings', publisher: 'Siegel JD et al. CDC / HICPAC', year: 2007, url: 'https://www.cdc.gov/',
    where: 'Wards → Isolation (contact, droplet, airborne, protective); docs/sql/38', note: null },
  { topic: 'infection', title: 'Kenya National Infection Prevention and Control Guidelines for Health Care Services', publisher: 'Ministry of Health Kenya', year: null, url: null, where: 'Isolation, visitor restrictions, cluster alerts', note: null },

  // ---------------------------------------------------------------- reporting & standards
  { topic: 'reporting', title: 'International Classification of Diseases (ICD-10 and ICD-11)', publisher: 'World Health Organization', year: null, url: 'https://icd.who.int/', where: 'Diagnoses, problem list, records coding', note: null },
  { topic: 'reporting', title: 'Medical Certificate of Cause of Death (MCCD) layout', publisher: 'World Health Organization / Civil Registration Services Kenya', year: null, url: null, where: 'Mortuary; records deficiency list', note: null },
  { topic: 'reporting', title: 'HL7 FHIR Release 4', publisher: 'HL7 International', year: 2019, url: 'https://hl7.org/fhir/R4/', where: 'FHIR API; docs/sql/15', note: null },

  // ---------------------------------------------------------------- law
  { topic: 'law', title: 'Data Protection Act, 2019', publisher: 'Republic of Kenya', year: 2019, url: 'https://www.odpc.go.ke/', where: 'Audit trail, access log, break-glass, de-identified exports; docs/sql/11', note: null },
  { topic: 'law', title: 'Employment Act, 2007 (leave entitlements)', publisher: 'Republic of Kenya', year: 2007, url: null, where: 'HR → Leave balances; docs/sql/36', note: 'Defaults are editable per hospital.' },

  // ---------------------------------------------------------------- further reading (linked only)
  { topic: 'reading', title: 'Manual of Medicine — Infectious Diseases (all articles)', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/category/topics/infectious-diseases/', where: 'Background reading for clinicians', note: 'Index of the site\'s infectious-disease articles.' },
  { topic: 'reading', title: 'Appropriate Antibiotics for Resistant Organisms', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/infectious-diseases/appropriate-antibiotics-for-resistant-organisms/', where: 'Microbiology surveillance (MRSA, ESBL, CRE, VRE flags)', note: 'Treatment options once a resistant organism is reported. Always follow the isolate\'s susceptibility results and the hospital formulary.' },
  { topic: 'reading', title: 'Sepsis Algorithm and Differential Diagnosis', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/emergency-acute-medicine/sepsis-algorithm-differential-diagnosis/', where: 'Emergency, ICU, critical results', note: 'Approach to the septic patient and conditions that mimic sepsis.' },
  { topic: 'reading', title: 'Drugs for Treating Mycobacterial Infections', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/pharmacology/drugs-for-treating-mycobacterial-infections/', where: 'HIV & TB care → TB treatment; drug–lab alerts (anti-TB hepatotoxicity)', note: 'Pharmacology of anti-TB drugs. Kenyan regimens follow NTLD-P.' },
  { topic: 'reading', title: 'Embolic Complications of Infective Endocarditis', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/infectious-diseases/embolic-complications-of-infective-endocarditis/', where: 'Background reading (endocarditis)', note: null },
  { topic: 'reading', title: 'Limiting the Burden of Influenza on High-Risk Individuals', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/infectious-diseases/limiting-the-burden-of-influenza-on-high-risk-individuals/', where: 'Background reading (influenza, droplet isolation)', note: null },
  { topic: 'reading', title: 'Differential Diagnosis of Pathologic Urine Findings (Urinalysis)', publisher: MOM, year: null,
    url: 'https://manualofmedicine.com/topics/nephrology-and-urology/differential-diagnosis-pathologic-urine-findings-urinalysis/', where: 'Laboratory (urinalysis), urinary isolates', note: null },
]
