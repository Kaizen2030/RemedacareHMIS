// RemedacareHMS clinical guides — original summaries written for this system from primary guidelines (WHO, Kenya MOH,
// IDSA, ESC, Surviving Sepsis Campaign, EUCAST, ATS). They cover topics similar to well-known clinical reference sites,
// but no third-party text is copied or paraphrased. Each guide must be approved by the hospital (clinical lead /
// Medicines & Therapeutics Committee) before use; until then the app shows it as a draft.
// When a guide changes, bump `version` so the hospital re-approves it.

export const CLINICAL_GUIDES = [
  {
    id: 'resistant-organisms', version: '2026-11', topic: 'Microbiology & AMR',
    title: 'Choosing antibiotics when the lab reports a resistant organism',
    summary: 'What each resistance flag means for treatment, and the usual options to discuss with the microbiologist or pharmacist. The isolate\'s own susceptibility results always come first.',
    sections: [
      { heading: 'First steps for any resistant isolate', points: [
        'Decide if it is infection or colonisation: a positive wound swab, urine or sputum culture without signs of infection usually needs no antibiotic.',
        'Read the full report: choose a drug the isolate is susceptible to ("S", or "I" = susceptible at increased exposure, which needs the high dose).',
        'Control the source (drain pus, remove infected lines and catheters) — antibiotics alone often fail without it.',
        'Start contact precautions for MRSA, ESBL with outbreaks, CRE, CRAB, CRPA and VRE, and tell infection prevention.',
        'Review on day 3: narrow, switch to oral when the patient is improving and absorbing, and set a stop date.',
      ] },
      { heading: 'MRSA (methicillin-resistant S. aureus)', points: [
        'All beta-lactams (penicillins, cephalosporins, carbapenems) are reported resistant — do not use them, even if an older report said otherwise.',
        'Serious infection (bacteraemia, pneumonia, bone and joint, endocarditis): vancomycin with level monitoring (AUC-guided where possible), or linezolid. Daptomycin is an alternative except for pneumonia.',
        'Non-severe skin and soft-tissue infection: drain the abscess; oral co-trimoxazole, doxycycline or clindamycin if the isolate is susceptible (clindamycin only if the D-test is negative).',
        'S. aureus in a blood culture is never a contaminant: repeat blood cultures, look for endocarditis (echocardiography) and treat for at least 14 days from the first negative culture.',
      ] },
      { heading: 'ESBL-producing Enterobacterales (E. coli, Klebsiella)', points: [
        'Bloodstream and other serious infections: a carbapenem (meropenem; ertapenem once stable). Piperacillin-tazobactam did worse than meropenem for ESBL bacteraemia in a randomised trial (MERINO).',
        'Uncomplicated cystitis: nitrofurantoin or fosfomycin (E. coli) if susceptible; co-trimoxazole or a fluoroquinolone only if susceptible.',
        'Step down to an oral agent the isolate is susceptible to (e.g. co-trimoxazole, ciprofloxacin) once the patient is stable.',
      ] },
      { heading: 'Carbapenem-resistant Enterobacterales (CRE / CPE)', points: [
        'The right drug depends on the carbapenemase: KPC and OXA-48 often respond to ceftazidime-avibactam; metallo-beta-lactamases (NDM, common in East Africa) need ceftazidime-avibactam plus aztreonam, or cefiderocol.',
        'Ask the laboratory to test for the carbapenemase type, and involve the microbiologist before choosing.',
        'Where newer agents are unavailable, colistin-based combinations guided by susceptibility may be the only option; monitor kidney function.',
        'Isolate the patient in a single room and screen contacts on the ward.',
      ] },
      { heading: 'Carbapenem-resistant Acinetobacter (CRAB) and Pseudomonas (CRPA)', points: [
        'CRAB: options include high-dose ampicillin-sulbactam, colistin, minocycline or cefiderocol, usually in combination; outcomes are poor — involve infectious diseases early.',
        'CRPA: check susceptibility to ceftazidime, cefepime, piperacillin-tazobactam and aminoglycosides — many carbapenem-resistant Pseudomonas remain susceptible to one of these; newer agents (ceftolozane-tazobactam, ceftazidime-avibactam) where available.',
        'Many CRAB and CRPA isolates from sputum and wounds are colonisers — treat the patient, not the culture.',
      ] },
      { heading: 'VRE (vancomycin-resistant Enterococcus)', points: [
        'Linezolid or daptomycin (high dose) for invasive infection; nitrofurantoin or fosfomycin for cystitis if susceptible.',
        'Enterococci are naturally resistant to cephalosporins — never use them for enterococcal infection.',
      ] },
    ],
    kenya: [
      'Carbapenem and colistin use should go through the hospital antimicrobial stewardship or pharmacy authorisation process.',
      'Newer agents (ceftazidime-avibactam, cefiderocol) may not be stocked; agree an escalation and procurement route in advance.',
      'Report priority resistant organisms through the national AMR surveillance programme (WHONET export).',
    ],
    inSystem: [
      { label: 'Resistance flags and susceptibility results', path: '/microbiology' },
      { label: 'Vancomycin level monitoring', path: '/critical-results' },
      { label: 'Contact isolation and bed placement', path: '/wards' },
    ],
    sources: [
      { text: 'Tamma PD et al. IDSA 2024 Guidance on the Treatment of Antimicrobial-Resistant Gram-Negative Infections. Clin Infect Dis 2024.', url: 'https://www.idsociety.org/practice-guideline/amr-guidance/' },
      { text: 'Liu C et al. IDSA Clinical Practice Guidelines for the Treatment of MRSA Infections. Clin Infect Dis 2011;52:e18–e55.', url: 'https://doi.org/10.1093/cid/ciq146' },
      { text: 'Harris PNA et al. Effect of piperacillin-tazobactam vs meropenem on 30-day mortality for patients with E. coli or K. pneumoniae bloodstream infection and ceftriaxone resistance (MERINO). JAMA 2018;320:984–994.', url: 'https://doi.org/10.1001/jama.2018.12163' },
      { text: 'EUCAST Clinical Breakpoint Tables v16.1 (2026); EUCAST Expected Resistant Phenotypes.', url: 'https://www.eucast.org/clinical_breakpoints/' },
    ],
  },

  {
    id: 'sepsis', version: '2026-11', topic: 'Emergency & critical care',
    title: 'Sepsis: recognition, the first hour and conditions that mimic it',
    summary: 'A practical sequence for adults with suspected sepsis, adapted to Kenyan facilities, with a list of non-infectious causes to keep in mind.',
    sections: [
      { heading: 'Recognise it', points: [
        'Sepsis is organ dysfunction caused by the body\'s response to infection. Look for new confusion, fast breathing, low blood pressure, low oxygen saturation, reduced urine output, mottled or cold peripheries.',
        'Use the early-warning score (NEWS2) on the ward and triage (SATS / TEWS) in the emergency unit; a high score with possible infection is sepsis until proven otherwise.',
        'Do not rely on qSOFA alone to screen — it misses many patients.',
        'Septic shock: hypotension needing vasopressors to keep mean arterial pressure ≥ 65 mmHg with lactate > 2 mmol/L despite fluids.',
      ] },
      { heading: 'The first hour (adults)', points: [
        'Take blood cultures (two sets) and other relevant cultures before antibiotics — but do not delay antibiotics to get them.',
        'Give broad-spectrum antibiotics within 1 hour when shock or sepsis is likely; within 3 hours when sepsis is possible but uncertain and the patient is stable.',
        'Measure lactate; repeat within 2–4 hours if raised.',
        'If hypotensive or lactate ≥ 4 mmol/L: give crystalloid (balanced solution or normal saline), about 30 mL/kg in the first 3 hours, reassessing after each bolus for lung crackles and oxygen needs.',
        'If blood pressure stays low after fluids: start noradrenaline (peripherally through a good cannula if no central line) aiming for MAP ≥ 65 mmHg, and call ICU / HDU.',
        'Find and control the source: drain abscesses, relieve obstruction, remove infected devices.',
      ] },
      { heading: 'Children', points: [
        'Use ETAT+ emergency signs and the paediatric early-warning score.',
        'In African children with febrile illness and impaired perfusion but no hypotension, routine fluid boluses increased deaths (FEAST trial): follow WHO / ETAT+ fluid guidance and give boluses only for shock.',
      ] },
      { heading: 'Conditions that can look like sepsis', points: [
        'Cardiac: myocardial infarction, acute heart failure, tamponade, pulmonary embolism.',
        'Metabolic and endocrine: diabetic ketoacidosis, adrenal crisis, thyroid storm.',
        'Drugs and toxins: overdose, alcohol withdrawal, neuroleptic malignant syndrome, serotonin syndrome, anaphylaxis.',
        'Bleeding: gastrointestinal haemorrhage, ruptured ectopic pregnancy, postpartum haemorrhage.',
        'Inflammatory: acute pancreatitis, vasculitis, transfusion reaction, haemophagocytic syndrome.',
        'Tropical infections that change the antibiotic plan: severe malaria (test every febrile patient), typhoid, rickettsia, leptospirosis, and TB or cryptococcal disease in advanced HIV.',
      ] },
    ],
    kenya: [
      'Test for malaria (RDT or smear) in every febrile patient; treat severe malaria with IV artesunate.',
      'Choose empirical antibiotics from the hospital\'s own antibiogram (first-isolate data) rather than habit.',
      'Check HIV status; advanced HIV widens the list of likely pathogens.',
    ],
    inSystem: [
      { label: 'Emergency triage (SATS / ETAT+)', path: '/emergency' },
      { label: 'Ward observations and NEWS2 escalation', path: '/wards' },
      { label: 'Local antibiogram for empirical choices', path: '/microbiology' },
      { label: 'ICU admission and SOFA', path: '/icu' },
    ],
    sources: [
      { text: 'Evans L et al. Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2021. Crit Care Med 2021;49:e1063–e1143.', url: 'https://doi.org/10.1097/CCM.0000000000005337' },
      { text: 'Singer M et al. The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3). JAMA 2016;315:801–810.', url: 'https://doi.org/10.1001/jama.2016.0287' },
      { text: 'Maitland K et al. Mortality after fluid bolus in African children with severe infection (FEAST). N Engl J Med 2011;364:2483–2495.', url: 'https://doi.org/10.1056/NEJMoa1101549' },
      { text: 'WHO. Emergency Triage Assessment and Treatment (ETAT) — manual for participants.', url: 'https://www.who.int/' },
    ],
  },

  {
    id: 'tb-drugs', version: '2026-11', topic: 'HIV & TB',
    title: 'Anti-tuberculosis medicines: how they work, side effects and interactions',
    summary: 'The first-line drugs, the newer drug-resistant TB regimens and preventive therapy — what to monitor and which interactions matter most in Kenya.',
    sections: [
      { heading: 'First-line drugs (2HRZE / 4HR for drug-susceptible TB)', points: [
        'Isoniazid (H, about 5 mg/kg daily): kills dividing bacilli. Side effects: hepatitis and peripheral neuropathy — give pyridoxine, especially with HIV, diabetes, alcohol use, malnutrition or pregnancy.',
        'Rifampicin (R, about 10 mg/kg daily): kills dividing and semi-dormant bacilli. Side effects: hepatitis, orange urine and tears (harmless; stains contact lenses), flu-like illness, rarely thrombocytopenia.',
        'Pyrazinamide (Z, about 25 mg/kg daily): active in acidic, inflamed tissue; used in the first 2 months. Side effects: hepatitis, joint pain, raised uric acid / gout.',
        'Ethambutol (E, about 15 mg/kg daily): prevents resistance while susceptibility is unknown. Side effect: optic neuritis — ask about blurred vision and red-green colour change; reduce the dose in kidney failure.',
        'Give fixed-dose combination tablets by weight band as in the national guidelines.',
      ] },
      { heading: 'Liver injury', points: [
        'Check liver tests at baseline in people with liver disease, HIV, heavy alcohol use, pregnancy or older age, and whenever symptoms appear (nausea, vomiting, abdominal pain, jaundice).',
        'Stop all hepatotoxic TB drugs if ALT is more than 3 times the upper limit with symptoms, or more than 5 times without symptoms, or bilirubin rises; reintroduce one drug at a time once liver tests settle, under specialist advice.',
      ] },
      { heading: 'Interactions that matter', points: [
        'Rifampicin is a strong enzyme inducer: it lowers levels of dolutegravir (give dolutegravir 50 mg twice daily during and for 2 weeks after rifampicin), protease inhibitors (avoid with rifampicin; rifabutin instead), hormonal contraceptives (use another method), warfarin, many anticonvulsants, methadone and azoles.',
        'Isoniazid raises phenytoin and carbamazepine levels.',
      ] },
      { heading: 'Drug-resistant TB', points: [
        'WHO now recommends short all-oral regimens, such as 6 months of bedaquiline, pretomanid, linezolid and moxifloxacin (BPaLM) for rifampicin-resistant TB in eligible patients.',
        'Monitor the ECG for QT prolongation (bedaquiline, moxifloxacin, clofazimine), blood count and nerves (linezolid: anaemia, low platelets, neuropathy, optic neuropathy) and liver tests.',
        'Drug-resistant TB is managed with the county / national DR-TB team.',
      ] },
      { heading: 'TB preventive therapy (TPT)', points: [
        'Options include 6 months of daily isoniazid (6H), 3 months of weekly rifapentine plus isoniazid (3HP) and 3 months of daily rifampicin plus isoniazid (3HR); choose with HIV medicines and pregnancy in mind.',
        'Exclude active TB first (symptom screen; chest X-ray where available).',
      ] },
    ],
    kenya: [
      'Follow NTLD-P regimens, weight bands and reporting; notify every case.',
      'Screen every TB patient for HIV and every person with HIV for TB at each visit.',
      'GeneXpert first for diagnosis and rifampicin resistance.',
    ],
    inSystem: [
      { label: 'TB treatment episodes, DOT and outcomes', path: '/hivtb' },
      { label: 'Liver-test alerts for patients on anti-TB drugs', path: '/critical-results' },
      { label: 'TPT and TB screening in HIV care', path: '/hivtb' },
    ],
    sources: [
      { text: 'WHO consolidated guidelines on tuberculosis. Module 4: treatment — drug-susceptible and drug-resistant TB treatment (2022 update).', url: 'https://www.who.int/publications/i/item/9789240048126' },
      { text: 'Nahid P et al. ATS/CDC/IDSA Clinical Practice Guidelines: Treatment of Drug-Susceptible Tuberculosis. Clin Infect Dis 2016;63:e147–e195.', url: 'https://doi.org/10.1093/cid/ciw376' },
      { text: 'Ministry of Health Kenya — National TB, Leprosy and Lung Disease Programme guidelines; Kenya HIV Prevention and Treatment Guidelines 2022 (NASCOP).', url: 'https://www.nascop.or.ke/' },
    ],
  },

  {
    id: 'endocarditis-emboli', version: '2026-11', topic: 'Infectious diseases & cardiology',
    title: 'Infective endocarditis: embolic complications and when to call the surgeon',
    summary: 'Where vegetations travel, how emboli present, who is at highest risk and the situations where early surgery is considered.',
    sections: [
      { heading: 'Suspect endocarditis', points: [
        'Fever with a new or changed murmur, positive blood cultures with a typical organism (S. aureus, viridans or bovis streptococci, enterococci, HACEK), injecting drug use, a prosthetic valve or rheumatic heart disease.',
        'Take three sets of blood cultures before antibiotics; arrange echocardiography (transoesophageal if transthoracic is negative and suspicion remains). Use the Duke-ISCVID 2023 criteria.',
      ] },
      { heading: 'Where emboli go and how they present', points: [
        'Brain: stroke, transient weakness, confusion, seizures; brain abscess; mycotic aneurysm with bleeding. Image the brain in any neurological change.',
        'Spleen and kidneys: left upper quadrant pain, haematuria, worsening kidney function; splenic abscess may need drainage or splenectomy.',
        'Lungs (right-sided endocarditis, often injecting drug use): multiple septic pulmonary emboli and cavities.',
        'Limbs and gut: acute limb ischaemia, mesenteric ischaemia; peripheral signs such as splinter haemorrhages and Janeway lesions.',
        'Spine and joints: vertebral osteomyelitis, septic arthritis — back pain in endocarditis needs imaging.',
      ] },
      { heading: 'Who is at highest risk', points: [
        'Large (≥ 10 mm) or mobile vegetations, mitral valve vegetations, S. aureus or fungal infection, and vegetations growing despite antibiotics.',
        'Risk is highest before and in the first two weeks of effective antibiotics — start the right antibiotic quickly.',
      ] },
      { heading: 'When to involve cardiothoracic surgery early', points: [
        'Heart failure from valve destruction.',
        'Uncontrolled infection: abscess, fistula, enlarging vegetation, or blood cultures still positive after about a week of appropriate antibiotics; fungal or highly resistant organisms.',
        'Prevention of embolism: vegetation ≥ 10 mm with an embolic event, or very large vegetations, especially on the left side.',
        'A recent stroke does not always rule out surgery — discuss with the endocarditis / heart team.',
      ] },
      { heading: 'Anticoagulation and antiplatelets', points: [
        'Do not start thrombolysis for a stroke caused by endocarditis.',
        'Anticoagulants are not started to treat or prevent emboli; patients already on them (e.g. mechanical valve) need specialist decisions, especially after a stroke.',
      ] },
    ],
    kenya: [
      'Rheumatic heart disease remains a common substrate in young adults; consider endocarditis in any febrile RHD patient.',
      'Transoesophageal echocardiography and cardiac surgery are available at a limited number of referral centres — plan early referral.',
    ],
    inSystem: [
      { label: 'Blood culture isolates (S. aureus, streptococci, enterococci)', path: '/microbiology' },
      { label: 'Vancomycin and gentamicin levels', path: '/critical-results' },
    ],
    sources: [
      { text: 'Delgado V et al. 2023 ESC Guidelines for the management of endocarditis. Eur Heart J 2023;44:3948–4042.', url: 'https://doi.org/10.1093/eurheartj/ehad193' },
      { text: 'Fowler VG et al. The 2023 Duke-International Society for Cardiovascular Infectious Diseases Criteria for Infective Endocarditis. Clin Infect Dis 2023;77:518–526.', url: 'https://doi.org/10.1093/cid/ciad271' },
    ],
  },

  {
    id: 'influenza-high-risk', version: '2026-11', topic: 'Infectious diseases',
    title: 'Influenza in people at high risk: prevention and early treatment',
    summary: 'Who is most likely to have severe influenza, how to protect them, and when to start antiviral treatment.',
    sections: [
      { heading: 'Who is at high risk of severe influenza', points: [
        'Pregnant women (any trimester) and women up to 2 weeks after delivery.',
        'Children under 5 years (especially under 2) and adults 65 years and older.',
        'People with chronic heart, lung (asthma, COPD, post-TB lung disease), kidney, liver or metabolic disease (diabetes), sickle cell disease, obesity, and immunosuppression including advanced HIV.',
        'Health workers — both for their own protection and to avoid infecting patients.',
      ] },
      { heading: 'Prevention', points: [
        'Annual vaccination with the current season\'s vaccine for high-risk groups and health workers; it is safe in pregnancy and also protects the baby for the first months.',
        'Droplet precautions in hospital: a surgical mask within 1 metre, cohorting or single rooms, hand hygiene, staff with respiratory symptoms stay home.',
      ] },
      { heading: 'Treatment', points: [
        'Start oseltamivir as early as possible in anyone with suspected or confirmed influenza who is severely ill, hospitalised or in a high-risk group — do not wait for a test result, and treat even after 48 hours of symptoms when severe or high risk.',
        'Usual adult dose 75 mg twice daily for 5 days; reduce the dose when creatinine clearance is below 60 mL/min (check the product information); weight-based dosing in children.',
        'Watch for bacterial pneumonia (often S. aureus or pneumococcus) when a patient worsens after initial improvement.',
      ] },
    ],
    kenya: [
      'Influenza circulates year-round in Kenya with seasonal peaks; consider it in severe acute respiratory illness at any time of year.',
      'Influenza vaccine is not part of the routine national schedule; hospitals can offer it to staff and high-risk patients.',
    ],
    inSystem: [
      { label: 'Droplet isolation and visitor restrictions', path: '/wards' },
      { label: 'Renal function (creatinine clearance) for dose adjustment', path: '/critical-results' },
    ],
    sources: [
      { text: 'WHO. Clinical practice guidelines for influenza (2024).', url: 'https://www.who.int/' },
      { text: 'WHO position paper on vaccines against influenza. Weekly Epidemiological Record 2022;97:185–208.', url: 'https://www.who.int/' },
    ],
  },

  {
    id: 'urinalysis', version: '2026-11', topic: 'Laboratory & nephrology',
    title: 'Reading a urinalysis: dipstick, microscopy and what to do next',
    summary: 'How each dipstick test and microscopy finding points to a diagnosis, the common false results, and when not to treat a positive urine.',
    sections: [
      { heading: 'Dipstick', points: [
        'Nitrite: suggests Gram-negative bacteria (E. coli, Klebsiella, Proteus); needs urine held in the bladder for about 4 hours, so a negative result does not exclude infection, and enterococci and S. saprophyticus do not make nitrite.',
        'Leucocyte esterase: white cells in the urine (infection, inflammation, stones, TB, sexually transmitted urethritis).',
        'Blood: red cells, free haemoglobin (haemolysis) or myoglobin (muscle breakdown). A positive dipstick with no red cells on microscopy suggests haemoglobinuria or myoglobinuria — check creatine kinase.',
        'Protein: mostly albumin; quantify with a urine albumin-creatinine ratio. Persistent proteinuria needs kidney work-up.',
        'Glucose: appears when blood glucose exceeds the kidney threshold (about 10 mmol/L), or with SGLT2 inhibitors or pregnancy.',
        'Ketones: fasting, vomiting, diabetic ketoacidosis (check blood glucose and blood ketones).',
        'Bilirubin positive with dark urine suggests obstructive jaundice or hepatitis; urobilinogen rises in haemolysis.',
        'Specific gravity and pH: concentration and acidity; very alkaline urine with Proteus suggests struvite stones.',
      ] },
      { heading: 'Microscopy', points: [
        'Red cell casts and dysmorphic red cells: glomerulonephritis — check blood pressure, creatinine and protein urgently.',
        'White cell casts: pyelonephritis or interstitial nephritis (consider drugs such as NSAIDs, penicillins, PPIs).',
        'Muddy-brown granular casts: acute tubular necrosis.',
        'Fatty casts and oval fat bodies: nephrotic syndrome. Hyaline casts alone are usually harmless (dehydration, exercise).',
        'Crystals: calcium oxalate (stones; ethylene glycol poisoning), uric acid, struvite.',
        'Ova of Schistosoma haematobium in terminal urine: urinary schistosomiasis — common around Lake Victoria and the coast.',
      ] },
      { heading: 'When not to treat', points: [
        'Bacteria in the urine without symptoms (asymptomatic bacteriuria) should not be treated, except in pregnancy and before urological procedures that breach the mucosa.',
        'Do not send urine cultures from catheterised patients without symptoms; a smelly or cloudy urine alone is not infection.',
        'Screen every pregnant woman for bacteriuria with a urine culture at the first antenatal visit where possible.',
      ] },
    ],
    kenya: [
      'Collect a terminal urine sample around midday for schistosomiasis microscopy in endemic areas.',
      'Use the hospital antibiogram (urine isolates, community onset) to choose empirical treatment for cystitis.',
    ],
    inSystem: [
      { label: 'Urine isolates and urinary breakpoints', path: '/microbiology' },
      { label: 'Kidney function and drug–lab alerts', path: '/critical-results' },
    ],
    sources: [
      { text: 'Nicolle LE et al. Clinical Practice Guideline for the Management of Asymptomatic Bacteriuria: 2019 Update by the IDSA. Clin Infect Dis 2019;68:e83–e110.', url: 'https://doi.org/10.1093/cid/ciy1121' },
      { text: 'KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease (albuminuria assessment). Kidney Int 2024;105(4S).', url: 'https://kdigo.org/' },
      { text: 'WHO. Guideline on control and elimination of human schistosomiasis (2022).', url: 'https://www.who.int/' },
    ],
  },

  {
    id: 'malaria', version: '2026-11', topic: 'Infectious diseases',
    title: 'Malaria: testing, uncomplicated and severe malaria, and pregnancy',
    summary: 'Test before treating, recognise severe malaria early, give IV artesunate without delay and complete the oral course.',
    sections: [
      { heading: 'Test every suspected case', points: [
        'Confirm with a malaria rapid diagnostic test (RDT) or blood-film microscopy before treating; treat on clinical grounds only when testing is impossible and the patient is severely ill.',
        'A negative test in a patient with fever means looking for another cause (pneumonia, UTI, typhoid, meningitis, sepsis) rather than giving antimalarials anyway.',
        'Microscopy is needed to count parasites in severe malaria and to follow response.',
      ] },
      { heading: 'Uncomplicated falciparum malaria', points: [
        'Artemether-lumefantrine (AL) by weight band: six doses over three days (0, 8, 24, 36, 48 and 60 hours), taken with fatty food or milk to improve absorption.',
        'Give the first dose in the clinic; if vomited within 30 minutes, repeat the dose.',
        'Pregnancy: AL is recommended in all trimesters, including the first (WHO 2022 update).',
        'Advise the patient to return at once if danger signs appear or fever persists beyond 3 days.',
      ] },
      { heading: 'Recognise severe malaria', points: [
        'Clinical: impaired consciousness or coma, prostration (cannot sit or stand unaided), repeated convulsions, deep breathing (acidosis), shock, pulmonary oedema, significant bleeding, jaundice.',
        'Laboratory: hypoglycaemia (glucose < 2.2 mmol/L), severe anaemia (haemoglobin < 5 g/dL in children, < 7 g/dL in adults), kidney injury, high lactate, hyperparasitaemia (> 10 %).',
        'Check blood glucose in every severely ill or convulsing patient and treat hypoglycaemia immediately.',
      ] },
      { heading: 'Treat severe malaria', points: [
        'IV (or IM) artesunate 2.4 mg/kg at 0, 12 and 24 hours, then daily until the patient can take oral medicine (children under 20 kg: 3 mg/kg per dose); then give a full 3-day course of AL.',
        'If referral is needed and injections are not possible, give pre-referral rectal artesunate to young children and refer.',
        'Supportive care: careful fluids (avoid overload), transfuse for severe anaemia with distress, antipyretics, treat convulsions, consider antibiotics for possible co-existing bacterial sepsis.',
        'Check haemoglobin about 7, 14 and 28 days after artesunate — delayed haemolysis can occur.',
      ] },
      { heading: 'Prevention in pregnancy', points: [
        'Intermittent preventive treatment with sulfadoxine-pyrimethamine (IPTp-SP) at ANC from 13 weeks, at least monthly; insecticide-treated nets for all pregnant women.',
        'Do not give IPTp-SP to women taking daily co-trimoxazole prophylaxis.',
      ] },
    ],
    kenya: [
      'Follow the National Malaria Control Programme treatment guidelines and weight bands.',
      'Malaria vaccine (RTS,S/AS01) is given to young children in the counties included in the national programme.',
      'Record confirmed and suspected cases for MOH 705 reporting.',
    ],
    inSystem: [
      { label: 'Emergency triage and severe signs', path: '/emergency' },
      { label: 'Maternity ANC (IPTp)', path: '/maternity' },
      { label: 'Haemoglobin and glucose critical alerts', path: '/critical-results' },
    ],
    sources: [
      { text: 'WHO Guidelines for malaria (latest consolidated version).', url: 'https://www.who.int/publications/i/item/guidelines-for-malaria' },
      { text: 'Ministry of Health Kenya — National Malaria Control Programme: Guidelines for the diagnosis, treatment and prevention of malaria in Kenya.', url: null },
    ],
  },

  {
    id: 'meningitis', version: '2026-11', topic: 'Infectious diseases',
    title: 'Meningitis: bacterial, cryptococcal and TB meningitis',
    summary: 'Give antibiotics within the hour, do the lumbar puncture when it is safe, think of cryptococcal and TB meningitis in people with HIV, and protect close contacts.',
    sections: [
      { heading: 'Suspect and act fast', points: [
        'Fever with headache, neck stiffness, altered consciousness, seizures, photophobia or a non-blanching rash; infants may have only fever, poor feeding, irritability or a bulging fontanelle.',
        'Take blood cultures and give the first antibiotic dose within 1 hour of arrival. Do not delay antibiotics for imaging or lumbar puncture.',
        'Do a lumbar puncture when safe; delay it (but not the antibiotic) if there are focal signs, papilloedema, deep coma, seizures that have not settled, shock or a bleeding problem.',
        'Send CSF for cell count, protein, glucose (with a paired blood glucose), Gram stain, culture, cryptococcal antigen (CrAg) and GeneXpert MTB/RIF Ultra when TB is possible.',
      ] },
      { heading: 'Bacterial meningitis', points: [
        'Empirical treatment: ceftriaxone IV (adults 2 g every 12 hours; children 100 mg/kg/day, maximum 4 g/day).',
        'Add ampicillin to cover Listeria in adults over 50, pregnancy, alcohol dependence or immunosuppression, and in newborns (with gentamicin).',
        'Dexamethasone given with or just before the first antibiotic reduces hearing loss and deaths from pneumococcal meningitis in some settings; trials in sub-Saharan Africa with high HIV prevalence showed no benefit — follow the hospital protocol and current WHO guidance.',
        'Narrow treatment when the organism and susceptibility are known (the laboratory uses meningitis breakpoints for CSF isolates).',
      ] },
      { heading: 'Cryptococcal meningitis (HIV)', points: [
        'Diagnose with CSF or blood CrAg. Measure the opening pressure.',
        'Preferred induction: a single high dose of liposomal amphotericin B with 14 days of flucytosine and fluconazole; where unavailable, one week of amphotericin B deoxycholate with flucytosine, followed by fluconazole.',
        'Manage raised pressure with repeated therapeutic lumbar punctures — this saves lives.',
        'Start ART 4–6 weeks after starting antifungal treatment, not earlier.',
      ] },
      { heading: 'TB meningitis', points: [
        'Suspect with a subacute illness (days to weeks), cranial nerve palsies, low CSF glucose with lymphocytes.',
        'Treat with anti-TB drugs (2 months intensive, then continuation for a total of about 12 months) plus corticosteroids; in people with HIV, delay ART for several weeks as advised in national guidelines.',
      ] },
      { heading: 'Protect others', points: [
        'Suspected meningococcal disease: droplet precautions until 24 hours of effective antibiotics.',
        'Give close household contacts prophylaxis (a single dose of ciprofloxacin or ceftriaxone) and notify public health.',
      ] },
    ],
    kenya: [
      'Meningitis is a notifiable condition — report through the county disease surveillance officer.',
      'Kenya is outside the classic meningitis belt, but outbreaks occur in the north; follow outbreak alerts.',
    ],
    inSystem: [
      { label: 'CSF isolates with meningitis breakpoints', path: '/microbiology' },
      { label: 'Cryptococcal antigen and advanced HIV care', path: '/hivtb' },
      { label: 'Droplet isolation', path: '/wards' },
    ],
    sources: [
      { text: 'WHO guidelines on meningitis diagnosis, treatment and care (2025).', url: 'https://www.who.int/' },
      { text: 'WHO Guidelines for diagnosing, preventing and managing cryptococcal disease among adults, adolescents and children living with HIV (2022).', url: 'https://www.who.int/publications/i/item/9789240052178' },
      { text: 'van de Beek D et al. ESCMID guideline: diagnosis and treatment of acute bacterial meningitis. Clin Microbiol Infect 2016;22 Suppl 3:S37–S62.', url: 'https://doi.org/10.1016/j.cmi.2016.01.007' },
    ],
  },

  {
    id: 'pneumonia', version: '2026-11', topic: 'Infectious diseases',
    title: 'Community-acquired pneumonia in adults and children',
    summary: 'Assess severity, start the narrowest effective antibiotic, give oxygen when saturation is low, and remember TB and Pneumocystis in people with HIV.',
    sections: [
      { heading: 'Adults: assess severity', points: [
        'Use CRB-65 (Confusion, Respiratory rate ≥ 30, low Blood pressure, age ≥ 65) or CURB-65 when urea is available; 0–1 points can usually be treated at home, 2 needs review for admission, 3 or more is severe.',
        'Measure oxygen saturation; give oxygen to keep saturation 94–98 % (88–92 % in chronic lung disease with CO₂ retention).',
        'Chest X-ray where available; sputum for GeneXpert if cough is over 2 weeks, weight loss, night sweats or HIV.',
      ] },
      { heading: 'Adults: antibiotics', points: [
        'Mild (home treatment): oral amoxicillin for 5 days (doxycycline if penicillin-allergic).',
        'Moderate to severe (admitted): IV ceftriaxone or amoxicillin-clavulanate, plus a macrolide (e.g. clarithromycin or azithromycin) when atypical organisms are possible; switch to oral once improving.',
        'Most patients need only 5 days in total if improving; review at 48–72 hours.',
        'Aspiration risk, lung abscess or empyema need longer treatment and drainage of pus.',
      ] },
      { heading: 'Children (2–59 months)', points: [
        'Fast breathing or chest indrawing without danger signs: oral amoxicillin (40 mg/kg per dose twice daily); 3 days for fast-breathing pneumonia, 5 days for chest-indrawing pneumonia.',
        'Severe pneumonia (any danger sign — unable to drink, convulsions, lethargy, central cyanosis, severe respiratory distress — or oxygen saturation < 90 %): admit, give oxygen, IV benzylpenicillin or ampicillin plus gentamicin.',
        'Children with HIV or severe malnutrition need longer treatment and assessment for Pneumocystis and TB.',
      ] },
      { heading: 'Think again if', points: [
        'HIV with low CD4, dry cough and very low saturation out of proportion to the X-ray: Pneumocystis pneumonia — high-dose co-trimoxazole plus prednisolone if hypoxic.',
        'Not improving after 48–72 hours: complications (effusion, empyema), TB, a resistant organism, or a non-infective cause (heart failure, pulmonary embolism).',
      ] },
    ],
    kenya: [
      'Follow the Kenya Basic Paediatric Protocols and IMCI for children.',
      'Pneumococcal conjugate vaccine (PCV10) is part of the routine schedule — check immunisation status.',
    ],
    inSystem: [
      { label: 'Emergency triage and oxygen', path: '/emergency' },
      { label: 'Sputum and blood culture results', path: '/microbiology' },
      { label: 'TB and HIV screening', path: '/hivtb' },
    ],
    sources: [
      { text: 'WHO. The WHO AWaRe (Access, Watch, Reserve) antibiotic book (2022).', url: 'https://www.who.int/publications/i/item/9789240062382' },
      { text: 'Lim WS et al. Defining community acquired pneumonia severity on presentation to hospital (CURB-65). Thorax 2003;58:377–382.', url: 'https://doi.org/10.1136/thorax.58.5.377' },
      { text: 'WHO. Revised WHO classification and treatment of pneumonia in children at health facilities (2014); Ministry of Health Kenya Basic Paediatric Protocols.', url: null },
    ],
  },

  {
    id: 'uti', version: '2026-11', topic: 'Infectious diseases',
    title: 'Urinary tract infection: cystitis, pyelonephritis, pregnancy and catheters',
    summary: 'Match the antibiotic to the type of infection and to local resistance — ampicillin and co-trimoxazole resistance in E. coli is high in Kenya.',
    sections: [
      { heading: 'Uncomplicated cystitis (non-pregnant women)', points: [
        'Typical symptoms (burning, frequency, urgency) without fever or flank pain.',
        'First choice: nitrofurantoin for 5 days, or a single dose of fosfomycin.',
        'Avoid fluoroquinolones for simple cystitis (keep them for more serious infections); avoid amoxicillin and co-trimoxazole empirically where local resistance is high.',
      ] },
      { heading: 'Pyelonephritis and complicated UTI', points: [
        'Fever, flank pain, vomiting or sepsis: send a urine culture (and blood cultures if unwell) before the first dose.',
        'Admitted patients: IV ceftriaxone (or gentamicin), then switch to an oral agent the isolate is susceptible to; total about 7 days for most (longer if slow to respond).',
        'Men with UTI: treat for 7 days and consider prostatitis.',
        'Obstruction (stone, enlarged prostate) or abscess: image and drain — antibiotics alone fail.',
      ] },
      { heading: 'Pregnancy', points: [
        'Treat both symptomatic UTI and asymptomatic bacteriuria; always culture.',
        'Options include amoxicillin-clavulanate, cefalexin or nitrofurantoin (avoid nitrofurantoin near term); avoid fluoroquinolones, and trimethoprim in the first trimester.',
        'Repeat the culture after treatment.',
      ] },
      { heading: 'Children and catheters', points: [
        'Infants under 2 months with fever and a positive urine: admit for IV antibiotics. Older children: oral treatment if well; image after a first febrile UTI as per local protocol.',
        'Catheter-associated UTI: treat only with symptoms; remove or replace the catheter, and send the culture from the new catheter.',
      ] },
    ],
    kenya: [
      'Use the hospital antibiogram filtered to urine isolates and community onset to set empirical choices; review yearly.',
      'ESBL-producing E. coli is common in hospitalised patients — see the resistant-organisms guide.',
    ],
    inSystem: [
      { label: 'Urine antibiogram (filter: urine, community onset)', path: '/microbiology' },
      { label: 'Urinalysis guide', path: '/references?guide=urinalysis' },
    ],
    sources: [
      { text: 'Gupta K et al. International clinical practice guidelines for the treatment of acute uncomplicated cystitis and pyelonephritis in women (IDSA/ESCMID). Clin Infect Dis 2011;52:e103–e120.', url: 'https://doi.org/10.1093/cid/ciq257' },
      { text: 'WHO. The WHO AWaRe antibiotic book (2022).', url: 'https://www.who.int/publications/i/item/9789240062382' },
      { text: 'Nicolle LE et al. IDSA asymptomatic bacteriuria guideline 2019. Clin Infect Dis 2019;68:e83–e110.', url: 'https://doi.org/10.1093/cid/ciy1121' },
    ],
  },

  {
    id: 'typhoid', version: '2026-11', topic: 'Infectious diseases',
    title: 'Typhoid (enteric) fever: diagnosis and treatment in an area of drug resistance',
    summary: 'Diagnose with blood culture, not the Widal test; fluoroquinolone resistance is common in East Africa, so choose azithromycin or ceftriaxone and watch for complications.',
    sections: [
      { heading: 'Diagnosis', points: [
        'Suspect with fever for several days, headache, abdominal pain, constipation or diarrhoea, relative bradycardia, and exposure to unsafe water or food.',
        'Blood culture is the standard test (best in the first week, before antibiotics); bone marrow culture is more sensitive where available.',
        'Do not rely on the Widal test — false positives and negatives are common; a single Widal result should not be used to diagnose typhoid.',
        'Always test for malaria too; both can co-exist.',
      ] },
      { heading: 'Treatment', points: [
        'Uncomplicated (outpatient): oral azithromycin for 7 days.',
        'Severe or complicated, or unable to take oral medicine: IV ceftriaxone for 10–14 days (switch to oral azithromycin when improving, guided by susceptibility).',
        'Avoid ciprofloxacin unless the isolate is proven susceptible — resistant strains are widespread in East Africa.',
        'Extensively drug-resistant typhoid (resistant to ceftriaxone, as reported in Pakistan): a carbapenem plus azithromycin; inform public health.',
      ] },
      { heading: 'Complications to watch for (usually week 2–3)', points: [
        'Intestinal perforation (sudden severe abdominal pain, rigid abdomen, shock): urgent surgery plus broad-spectrum antibiotics including anaerobic cover.',
        'Gastrointestinal bleeding, encephalopathy (confusion, delirium), myocarditis, hepatitis.',
        'Relapse occurs in a minority; chronic carriers can spread infection.',
      ] },
      { heading: 'Public health', points: [
        'Notify cases; food handlers must not work until cleared by stool cultures.',
        'Safe water, sanitation and hand hygiene; typhoid conjugate vaccine where offered.',
      ] },
    ],
    kenya: [
      'Kenya has high rates of multidrug-resistant typhoid and reduced fluoroquinolone susceptibility (H58 lineage) in several counties.',
      'Laboratory confirmation by blood culture is encouraged; Widal-only diagnosis drives antibiotic misuse.',
    ],
    inSystem: [
      { label: 'Salmonella Typhi isolates and ceftriaxone-resistance alert', path: '/microbiology' },
    ],
    sources: [
      { text: 'WHO. The WHO AWaRe antibiotic book (2022) — enteric fever.', url: 'https://www.who.int/publications/i/item/9789240062382' },
      { text: 'WHO. Typhoid vaccines: WHO position paper. Weekly Epidemiological Record 2018;93:153–172.', url: 'https://www.who.int/' },
      { text: 'Ministry of Health Kenya — guidance on laboratory diagnosis of typhoid (against Widal-only diagnosis).', url: null },
    ],
  },

  {
    id: 'hiv-oi', version: '2026-11', topic: 'HIV & TB',
    title: 'Advanced HIV disease and opportunistic infections',
    summary: 'Identify advanced HIV, run the screening package (CD4, CrAg, TB LAM), start prophylaxis, and time ART correctly around TB and cryptococcal meningitis.',
    sections: [
      { heading: 'Who has advanced HIV disease', points: [
        'Adults and adolescents with CD4 below 200 cells/mm³ or WHO clinical stage 3 or 4; all children under 5 years with HIV.',
        'Many patients returning after interruption of treatment also have advanced disease — check CD4 at return.',
      ] },
      { heading: 'Screening package', points: [
        'CD4 count at enrolment, at return after interruption, and with treatment failure.',
        'Serum or plasma cryptococcal antigen (CrAg) when CD4 is below 200: if positive without meningitis symptoms, do a lumbar puncture where possible and give pre-emptive fluconazole (high dose for 2 weeks, then lower doses); if meningitis, treat as cryptococcal meningitis.',
        'Urine TB LAM for inpatients with HIV and signs of TB, or with low CD4 or serious illness; sputum GeneXpert as well.',
      ] },
      { heading: 'Prophylaxis', points: [
        'Co-trimoxazole prophylaxis prevents Pneumocystis pneumonia, toxoplasmosis and some bacterial infections — continue as per national criteria.',
        'TB preventive therapy once active TB is excluded.',
        'Fluconazole pre-emptive treatment for CrAg-positive patients as above.',
      ] },
      { heading: 'Common opportunistic infections', points: [
        'TB (any site — the commonest cause of death): screen at every visit.',
        'Pneumocystis pneumonia: progressive breathlessness, dry cough, low oxygen saturation; high-dose co-trimoxazole for 21 days plus prednisolone if hypoxic.',
        'Cerebral toxoplasmosis: headache, focal weakness, seizures; treat with high-dose co-trimoxazole (or pyrimethamine-sulfadiazine).',
        'Oesophageal candidiasis: pain on swallowing; fluconazole.',
        'Kaposi sarcoma: skin, mouth or internal lesions; ART plus referral for chemotherapy when extensive.',
        'Bacterial pneumonia, sepsis and diarrhoeal illness are frequent — treat promptly.',
      ] },
      { heading: 'Timing ART', points: [
        'Start ART rapidly (ideally within 7 days, same day if ready) for most patients.',
        'TB (not meningitis): start ART within 2 weeks of TB treatment.',
        'Cryptococcal meningitis: delay ART 4–6 weeks after antifungal treatment begins. TB meningitis: delay as advised in national guidelines.',
        'Watch for immune reconstitution inflammatory syndrome (IRIS) — worsening of an infection after ART starts.',
      ] },
    ],
    kenya: [
      'Follow the Kenya HIV Prevention and Treatment Guidelines 2022 (NASCOP) for the advanced HIV package and regimens.',
      'Rifampicin interacts with dolutegravir — double the dolutegravir dose while on rifampicin (see the TB medicines guide).',
    ],
    inSystem: [
      { label: 'ART clients, visits, TB screening and tracing', path: '/hivtb' },
      { label: 'TB medicines guide', path: '/references?guide=tb-drugs' },
      { label: 'Meningitis guide', path: '/references?guide=meningitis' },
    ],
    sources: [
      { text: 'WHO. Guidelines for managing advanced HIV disease and rapid initiation of antiretroviral therapy (2017).', url: 'https://www.who.int/publications/i/item/9789241550062' },
      { text: 'WHO cryptococcal disease guidelines (2022).', url: 'https://www.who.int/publications/i/item/9789240052178' },
      { text: 'Kenya HIV Prevention and Treatment Guidelines, 2022 edition (NASCOP).', url: 'https://www.nascop.or.ke/' },
    ],
  },

  {
    id: 'surgical-prophylaxis', version: '2026-11', topic: 'Theatre & infection prevention',
    title: 'Surgical antibiotic prophylaxis and surgical site infection prevention',
    summary: 'One correctly timed dose of the right antibiotic before incision, redosing in long operations, and no prolonged post-operative antibiotics.',
    sections: [
      { heading: 'Principles', points: [
        'Give prophylaxis within 60 minutes before the skin incision (120 minutes for vancomycin or fluoroquinolones) so tissue levels are high when the wound is made.',
        'Use a narrow agent that covers skin flora and the organisms of the operated site: cefazolin for most clean and clean-contaminated operations.',
        'Do not continue antibiotics after the operation to "prevent infection" — WHO recommends against prolonged post-operative prophylaxis. Treatment of an established infection is different.',
        'Clean operations without implants (e.g. many soft-tissue procedures) often need no prophylaxis — follow the hospital list.',
      ] },
      { heading: 'Doses and redosing', points: [
        'Cefazolin 2 g IV for adults (3 g if 120 kg or more; children 30 mg/kg).',
        'Redose cefazolin if the operation lasts longer than about 4 hours or blood loss exceeds 1,500 mL.',
      ] },
      { heading: 'Common choices', points: [
        'Caesarean section: cefazolin before skin incision (not after cord clamping).',
        'Colorectal and appendix surgery: cefazolin plus metronidazole.',
        'Orthopaedic implants, hernia repair with mesh, most general and gynaecological surgery: cefazolin.',
        'Severe penicillin allergy (anaphylaxis): clindamycin (or vancomycin), adding gentamicin where Gram-negative cover is needed.',
        'Known MRSA carriers having implant surgery: add vancomycin.',
      ] },
      { heading: 'Other proven measures', points: [
        'Bathe or shower before surgery; do not shave — clip hair only if necessary.',
        'Skin preparation with alcohol-based chlorhexidine.',
        'Keep the patient warm, control blood glucose, and give adequate oxygen during anaesthesia.',
        'Decolonise known S. aureus carriers (nasal mupirocin and chlorhexidine washes) before cardiac and orthopaedic surgery.',
        'Use the WHO Surgical Safety Checklist — confirm prophylaxis was given at sign-in / time-out.',
      ] },
    ],
    kenya: [
      'Ceftriaxone is often used for prophylaxis by habit; cefazolin is the recommended first choice — agree a hospital list with pharmacy and theatre.',
      'Audit surgical site infections and prophylaxis timing as part of the hospital quality programme.',
    ],
    inSystem: [
      { label: 'Theatre — WHO checklist and case items', path: '/theatre' },
      { label: 'Surgical site isolates and MRSA flags', path: '/microbiology' },
    ],
    sources: [
      { text: 'WHO. Global guidelines for the prevention of surgical site infection, 2nd edition (2018).', url: 'https://www.who.int/publications/i/item/9789241550475' },
      { text: 'Bratzler DW et al. Clinical practice guidelines for antimicrobial prophylaxis in surgery (ASHP/IDSA/SIS/SHEA). Am J Health-Syst Pharm 2013;70:195–283.', url: 'https://doi.org/10.2146/ajhp120568' },
      { text: 'WHO. The WHO AWaRe antibiotic book (2022).', url: 'https://www.who.int/publications/i/item/9789240062382' },
    ],
  },
]
