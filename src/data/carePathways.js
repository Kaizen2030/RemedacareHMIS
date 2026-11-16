// Built-in care pathways: step-by-step bedside workflows written for RemedacareHMS from Kenyan national guidelines,
// WHO guidance and primary international guidelines (listed per pathway). Original wording; no text is copied from
// textbooks or review courses. Each hospital can edit, remove, restore or replace these (clinical_content_revisions,
// content_type 'pathway'), and must approve a version before it is marked approved.
// Bump `version` whenever the clinical content of a pathway changes.

export const PATHWAY_VERSION = '2026-11'

const KE_PAEDS = { text: 'Ministry of Health Kenya. Basic Paediatric Protocols, 5th edition (2022).', url: 'https://www.health.go.ke' }
const WHO_AWARE = { text: 'WHO. The WHO AWaRe (Access, Watch, Reserve) antibiotic book (2022).', url: 'https://www.who.int/publications/i/item/9789240062382' }

export const CARE_PATHWAYS = [
  {
    id: 'sepsis-adult',
    title: 'Adult sepsis: first hour and after',
    category: 'Emergency',
    match: ['sepsis', 'septic shock', 'septicaemia', 'septicemia'],
    summary: 'Recognise sepsis early with NEWS2, complete the first-hour bundle, find and control the source, then review and de-escalate antibiotics.',
    stages: [
      { heading: 'Recognise (triage, ward rounds, every set of observations)', points: [
        'Suspect sepsis in anyone with a possible infection who looks unwell, or has a NEWS2 of 5 or more, or a single parameter scoring 3.',
        'Do not rely on qSOFA alone to rule sepsis in or out; use NEWS2 and clinical judgement.',
        'Ask about the likely source: chest, urine, abdomen, skin and soft tissue, lines and catheters, meninges, recent surgery or delivery.',
        'Call the senior clinician immediately for systolic BP < 90 mmHg, lactate ≥ 4 mmol/L, new confusion or NEWS2 ≥ 7.',
      ] },
      { heading: 'First hour', points: [
        'Oxygen to keep SpO₂ 94–98% (88–92% if at risk of CO₂ retention).',
        'Two blood cultures before antibiotics, but never delay antibiotics more than a few minutes for them. Add urine, sputum, wound or CSF samples as indicated.',
        'Lactate (venous is fine), full blood count, urea, creatinine, electrolytes, glucose, bilirubin; malaria test in endemic settings; HIV test if status unknown.',
        'IV antibiotics within 1 hour when shock is likely or sepsis is probable; within 3 hours when sepsis is only possible and the patient is stable, after a rapid assessment.',
        'Choose antibiotics by the likely source and the hospital antibiogram (see the Sepsis guide and the Antibiogram screen). Add MRSA cover only when risk factors or local rates justify it.',
        'Hypotension or lactate ≥ 4: give crystalloid in 250–500 ml boluses (balanced crystalloid preferred) and reassess after each one, up to about 30 ml/kg in the first 3 hours.',
        'Where intensive care is limited, stop fluid boluses at the first sign of overload (new crackles, falling SpO₂, raised JVP): aggressive fluids increased deaths in adults with sepsis and hypotension in a Zambian trial.',
        'Start noradrenaline if MAP stays below 65 mmHg after fluids. It can run briefly through a good peripheral cannula while central access is arranged.',
        'Catheterise and measure urine output hourly in shock.',
      ] },
      { heading: 'Source control (within 6–12 hours)', points: [
        'Drain abscesses and collections, remove infected lines and catheters, and arrange surgery for necrotising infection, perforation or retained products of conception.',
        'Ultrasound or other imaging when the source is unclear.',
      ] },
      { heading: 'Monitoring', points: [
        'Observations hourly until stable: pulse, BP, respiratory rate, SpO₂, temperature, consciousness, urine output (target ≥ 0.5 ml/kg/h).',
        'Repeat lactate 2–4 hours after an abnormal first value; a falling lactate supports the response.',
        'Keep glucose between 6 and 10 mmol/L; start insulin if it is persistently above 10 mmol/L.',
        'Escalate to HDU/ICU for persistent hypotension, rising lactate, needing vasopressors, or respiratory failure.',
      ] },
      { heading: 'Review and de-escalate (daily)', points: [
        'Review antibiotics at 48–72 hours with the culture results: narrow the spectrum, switch to oral when the patient is improving and can absorb, stop if infection is ruled out.',
        'Most sources need 5–7 days in total when the source is controlled and the patient is improving.',
        'Record the plan and the review date on the prescription.',
      ] },
      { heading: 'Children and pregnancy', points: [
        'Children: follow the paediatric sepsis and shock protocols. Fluid boluses only for children in shock; boluses in febrile children without shock increased deaths (FEAST trial).',
        'Pregnant or recently delivered women: think of chorioamnionitis, endometritis, septic abortion, mastitis and wound infection; involve the obstetric team early.',
      ] },
    ],
    redFlags: ['Systolic BP < 90 mmHg or MAP < 65 mmHg after fluids', 'Lactate ≥ 4 mmol/L', 'New confusion or reduced consciousness', 'Respiratory rate ≥ 25/min or SpO₂ < 92% on oxygen', 'Urine output < 0.5 ml/kg/h for 2 hours', 'Non-blanching rash or mottled skin'],
    guideIds: ['sepsis', 'resistant-organisms'],
    inSystem: [{ label: 'Antibiogram', path: '/antibiogram' }, { label: 'Critical results', path: '/critical-results' }, { label: 'Microbiology', path: '/microbiology' }],
    sources: [
      { text: 'Evans L, et al. Surviving Sepsis Campaign: international guidelines for management of sepsis and septic shock 2021. Crit Care Med 2021;49:e1063–e1143.', url: 'https://doi.org/10.1097/CCM.0000000000005337' },
      { text: 'Andrews B, et al. Effect of an early resuscitation protocol on in-hospital mortality among adults with sepsis and hypotension (Zambia). JAMA 2017;318:1233–40.', url: 'https://doi.org/10.1001/jama.2017.10913' },
      { text: 'Maitland K, et al. Mortality after fluid bolus in African children with severe infection (FEAST). N Engl J Med 2011;364:2483–95.', url: 'https://doi.org/10.1056/NEJMoa1101549' },
      { text: 'Royal College of Physicians. National Early Warning Score (NEWS) 2 (2017).', url: 'https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/' },
    ],
  },
  {
    id: 'hap-vap',
    title: 'Hospital-acquired and ventilator-associated pneumonia (HAP/VAP)',
    category: 'Infection',
    match: ['hap', 'vap', 'hospital acquired pneumonia', 'hospital-acquired pneumonia', 'ventilator associated pneumonia', 'nosocomial pneumonia'],
    summary: 'Confirm HAP/VAP, take good samples, start empiric therapy matched to your antibiogram and resistance risk, then target resistant organisms by mechanism and stop at about 7 days.',
    stages: [
      { heading: 'Is it HAP or VAP?', points: [
        'HAP: pneumonia starting 48 hours or more after admission that was not incubating on arrival. VAP: pneumonia starting more than 48 hours after intubation.',
        'Suspect it with a new or worsening chest X-ray shadow plus at least two of: fever, purulent secretions, raised or low white count, worsening oxygenation.',
        'Consider other causes: atelectasis, pulmonary oedema, ARDS, pulmonary embolism, aspiration pneumonitis.',
      ] },
      { heading: 'Samples before antibiotics', points: [
        'Lower respiratory sample: sputum, or endotracheal aspirate in ventilated patients, sent for Gram stain and semi-quantitative culture.',
        'Two blood cultures. Pleural fluid if an effusion can be tapped.',
        'Do not wait for results to start treatment in a sick patient.',
      ] },
      { heading: 'Empiric treatment: match it to your antibiogram', points: [
        'Open the Antibiogram screen for your ward or ICU. Choose agents that cover the local Gram-negatives (especially Pseudomonas, Klebsiella, Acinetobacter) at your hospital.',
        'Low risk (no resistance risk factors, not in shock): one antipseudomonal β-lactam, for example piperacillin-tazobactam 4.5 g every 6 hours or cefepime 2 g every 8 hours, or meropenem where ESBL rates are high.',
        'Resistance risk factors (IV antibiotics in the last 90 days, septic shock, ARDS, 5+ days in hospital before VAP, acute dialysis, high local resistance): two antipseudomonal agents from different classes until results return.',
        'Add MRSA cover (vancomycin with level monitoring, or linezolid) when there are MRSA risk factors, local MRSA is above about 20% of S. aureus, or the rate is unknown.',
        'Use the high, extended-infusion doses for β-lactams in severe infection (e.g. meropenem 2 g every 8 hours over 3 hours); these match the EUCAST "high dosage" behind an "I" result.',
      ] },
      { heading: 'Target the organism (when culture and susceptibility are back)', points: [
        'ESBL-producing Enterobacterales: a carbapenem (meropenem or imipenem). Avoid piperacillin-tazobactam outside the urinary tract even if reported susceptible; prefer meropenem over ertapenem in critically ill patients or when albumin is low.',
        'Pseudomonas susceptible to standard agents: use a non-carbapenem β-lactam at high, extended-infusion dose and save carbapenems.',
        'Difficult-to-treat Pseudomonas (resistant to all standard β-lactams and fluoroquinolones): ceftolozane-tazobactam is preferred for pneumonia; ceftazidime-avibactam, imipenem-relebactam or cefiderocol are alternatives.',
        'Carbapenem-resistant Enterobacterales: ask the laboratory which carbapenemase. KPC: ceftazidime-avibactam, meropenem-vaborbactam or imipenem-relebactam. OXA-48: ceftazidime-avibactam. NDM (common in East Africa): aztreonam-avibactam, or ceftazidime-avibactam given together with aztreonam, or cefiderocol.',
        'Carbapenem-resistant Acinetobacter: sulbactam-durlobactam with a carbapenem where available; otherwise high-dose ampicillin-sulbactam (9 g sulbactam per day) with at least one other active agent (e.g. polymyxin B or minocycline).',
        'Stenotrophomonas maltophilia: combination of two active agents from trimethoprim-sulfamethoxazole, minocycline, levofloxacin and cefiderocol, or aztreonam-avibactam.',
        'Many newer agents are scarce in Kenya: involve the microbiologist or infectious-disease physician and the pharmacy early, and use polymyxins only in combination.',
        'Nebulised antibiotics are not routine; consider them only when systemic options fail.',
      ] },
      { heading: 'Duration and review', points: [
        'Reassess at 48–72 hours: de-escalate to the narrowest active agent, stop MRSA cover if cultures are negative for MRSA.',
        'Seven days is enough for most HAP/VAP when the patient is improving, whatever the organism.',
        'If not improving at 72 hours: repeat samples, look for empyema, abscess, line infection, Clostridioides difficile or a non-infectious cause.',
      ] },
      { heading: 'Infection control and prevention', points: [
        'Contact precautions and a single room or cohort for CRE, CRAB and other carbapenem-resistant organisms; the Microbiology screen raises the alert to IPC.',
        'VAP bundle: head of bed raised 30–45°, daily sedation hold and spontaneous breathing trial, oral care, cuff pressure 20–30 cmH₂O, subglottic suction where available, early mobilisation, avoid unnecessary re-intubation.',
      ] },
    ],
    redFlags: ['Septic shock or rising oxygen requirement', 'Carbapenem-resistant organism in any sample', 'No improvement after 72 hours of active treatment', 'New effusion (possible empyema)'],
    guideIds: ['pneumonia', 'resistant-organisms', 'sepsis'],
    inSystem: [{ label: 'Antibiogram', path: '/antibiogram' }, { label: 'Microbiology', path: '/microbiology' }, { label: 'ICU', path: '/icu' }],
    sources: [
      { text: 'Kalil AC, et al. Management of adults with hospital-acquired and ventilator-associated pneumonia: 2016 clinical practice guidelines by IDSA and ATS. Clin Infect Dis 2016;63:e61–e111.', url: 'https://doi.org/10.1093/cid/ciw353' },
      { text: 'Torres A, et al. International ERS/ESICM/ESCMID/ALAT guidelines for the management of hospital-acquired and ventilator-associated pneumonia. Eur Respir J 2017;50:1700582.', url: 'https://doi.org/10.1183/13993003.00582-2017' },
      { text: 'Tamma PD, et al. Infectious Diseases Society of America 2024 guidance on the treatment of antimicrobial-resistant Gram-negative infections. Clin Infect Dis 2024 (ciae403).', url: 'https://doi.org/10.1093/cid/ciae403' },
      { text: 'EUCAST. Dosages used to define breakpoints, breakpoint tables v16.0 (2026).', url: 'https://www.eucast.org/clinical_breakpoints' },
    ],
  },
  {
    id: 'pneumonia-adult',
    title: 'Adult community-acquired pneumonia',
    category: 'Infection',
    match: ['pneumonia adult', 'community acquired pneumonia', 'cap', 'lower respiratory tract infection'],
    summary: 'Score severity with CURB-65, decide where to treat, give the right antibiotic quickly, and review at 48–72 hours.',
    stages: [
      { heading: 'Assess severity', points: [
        'CURB-65, one point each: new Confusion, Urea > 7 mmol/L, Respiratory rate ≥ 30/min, BP systolic < 90 or diastolic ≤ 60 mmHg, age ≥ 65. In clinics without urea use CRB-65.',
        '0–1: usually home treatment. 2: short admission or close follow-up. 3–5: severe, admit; consider HDU/ICU at 4–5.',
        'Check SpO₂ in everyone; SpO₂ < 92% (or < 90% where oxygen is scarce) needs oxygen and admission whatever the score.',
        'Ask about HIV, TB contact, cough for more than 2 weeks, recent hospital stay, alcohol and aspiration risk.',
      ] },
      { heading: 'Investigations', points: [
        'Chest X-ray when available. Full blood count, urea and electrolytes, CRP.',
        'Moderate or severe pneumonia: blood cultures and sputum culture before antibiotics.',
        'HIV test if status unknown. GeneXpert on sputum for anyone with cough ≥ 2 weeks, weight loss, HIV, or a chest X-ray suggesting TB.',
        'In people with advanced HIV and hypoxia, think of Pneumocystis pneumonia (PCP).',
      ] },
      { heading: 'Antibiotics (adjust to the hospital antibiogram and allergy)', points: [
        'Non-severe (home): amoxicillin 1 g orally three times a day for 5 days. Penicillin allergy: doxycycline 100 mg twice a day (200 mg first dose).',
        'Moderate (admitted, CURB-65 2): amoxicillin orally or IV, adding clarithromycin when atypical infection is likely.',
        'Severe: ceftriaxone 2 g IV once daily (or cefotaxime 2 g every 8 hours) plus clarithromycin 500 mg twice a day, within an hour if the patient is septic.',
        'Avoid fluoroquinolones as routine first-line treatment: they can mask TB and select resistance.',
        'Total 5 days for most patients who improve; switch IV to oral when afebrile for 48 hours and stable.',
      ] },
      { heading: 'Supportive care and monitoring', points: [
        'Oxygen to SpO₂ 94–98% (88–92% if at risk of CO₂ retention).',
        'Fluids and nutrition; thromboprophylaxis for admitted patients unless contraindicated.',
        'Observations (NEWS2) at least 4-hourly; escalate a rising score.',
      ] },
      { heading: 'Review at 48–72 hours', points: [
        'Not improving: repeat chest X-ray for effusion, empyema or abscess; reconsider TB, PCP, resistant organisms, heart failure or pulmonary embolism.',
        'Narrow antibiotics to culture results.',
      ] },
      { heading: 'Discharge and follow-up', points: [
        'Explain that cough can last up to 6 weeks; return if breathlessness worsens or fever recurs.',
        'Repeat chest X-ray at about 6 weeks for smokers over 50 or if symptoms persist.',
        'Offer pneumococcal and influenza vaccination where available; stop-smoking support.',
      ] },
    ],
    redFlags: ['CURB-65 of 3 or more', 'SpO₂ < 92% on air', 'Confusion', 'Systolic BP < 90 mmHg', 'Multilobar shadowing or effusion'],
    guideIds: ['pneumonia', 'influenza-high-risk'],
    inSystem: [{ label: 'Antibiogram', path: '/antibiogram' }, { label: 'Laboratory', path: '/laboratory' }],
    sources: [
      { text: 'Lim WS, et al. Defining community acquired pneumonia severity on presentation to hospital (CURB-65). Thorax 2003;58:377–82.', url: 'https://doi.org/10.1136/thorax.58.5.377' },
      { text: 'Metlay JP, et al. Diagnosis and treatment of adults with community-acquired pneumonia. An official ATS/IDSA clinical practice guideline. Am J Respir Crit Care Med 2019;200:e45–e67.', url: 'https://doi.org/10.1164/rccm.201908-1581ST' },
      WHO_AWARE,
    ],
  },
  {
    id: 'pneumonia-paediatric',
    title: 'Pneumonia in children 2 months to 5 years',
    category: 'Child health',
    match: ['pneumonia paediatric', 'pediatric pneumonia', 'childhood pneumonia', 'pneumonia child'],
    summary: 'Count the breathing, look for chest indrawing and danger signs, then treat at home or admit with oxygen and injectable antibiotics.',
    stages: [
      { heading: 'Assess (calm child, full minute count)', points: [
        'Fast breathing: 50 or more breaths a minute at 2–11 months; 40 or more at 12–59 months.',
        'Look for lower chest wall indrawing, and listen for wheeze and grunting.',
        'Danger signs: unable to drink or breastfeed, vomiting everything, convulsions, lethargy or unconsciousness, central cyanosis, SpO₂ < 90%, severe respiratory distress, grunting.',
        'Check SpO₂ in every child with cough or difficult breathing; check weight and MUAC for malnutrition and ask about HIV exposure.',
      ] },
      { heading: 'Classify and treat', points: [
        'Pneumonia (fast breathing and/or chest indrawing, no danger signs): oral amoxicillin 40 mg/kg per dose twice daily; 3 days for fast breathing alone, 5 days with chest indrawing (Kenyan protocol). Review in 2–3 days.',
        'Severe pneumonia (any danger sign or SpO₂ < 90%): admit. Benzylpenicillin 50,000 IU/kg IV every 6 hours (or ampicillin 50 mg/kg every 6 hours) plus gentamicin 7.5 mg/kg IV once daily for at least 5 days.',
        'Change to ceftriaxone if there is no improvement after 48 hours, or if meningitis is suspected.',
        'HIV-exposed or HIV-positive infants with severe pneumonia: add high-dose cotrimoxazole for possible Pneumocystis pneumonia.',
        'Wheeze: give inhaled salbutamol and reassess; consider bronchiolitis or asthma before antibiotics.',
      ] },
      { heading: 'Oxygen and supportive care', points: [
        'Give oxygen when SpO₂ < 90% (nasal prongs, about 0.5–1 L/min for infants and 1–2 L/min for older children); stop when SpO₂ stays ≥ 90% on air.',
        'Continue breastfeeding and feeding; give maintenance fluids only if the child cannot drink, and avoid overload.',
        'Paracetamol for fever with distress.',
      ] },
      { heading: 'Monitoring', points: [
        'Respiratory rate, SpO₂, temperature and danger signs at least every 3–6 hours while admitted; more often on oxygen.',
        'Severe acute malnutrition needs the SAM protocol (different fluids and antibiotics).',
      ] },
      { heading: 'Young infants (under 2 months)', points: [
        'Fast breathing (60 or more) or chest indrawing in a young infant is a possible serious bacterial infection: follow the neonatal sepsis protocol and refer or admit.',
      ] },
      { heading: 'Discharge and prevention', points: [
        'Teach the carer the danger signs that mean coming back at once.',
        'Check immunisations (PCV, Hib, measles, pertussis) and catch up; HIV testing per national guidance.',
      ] },
    ],
    redFlags: ['SpO₂ < 90%', 'Unable to drink or breastfeed', 'Convulsions, lethargy or unconsciousness', 'Central cyanosis or grunting', 'Severe acute malnutrition'],
    guideIds: ['pneumonia'],
    inSystem: [{ label: 'Maternity & Child Health', path: '/maternity' }],
    sources: [
      KE_PAEDS,
      { text: 'WHO. Revised WHO classification and treatment of pneumonia in children at health facilities (2014).', url: 'https://www.who.int/publications/i/item/9789241507813' },
      WHO_AWARE,
    ],
  },
  {
    id: 'malaria-uncomplicated',
    title: 'Uncomplicated malaria',
    category: 'Infection',
    match: ['malaria uncomplicated', 'malaria'],
    summary: 'Test every suspected case, rule out danger signs, give a full 3-day artemether-lumefantrine course with food, and look for another cause if the test is negative.',
    stages: [
      { heading: 'Test before you treat', points: [
        'Confirm with microscopy or a malaria rapid diagnostic test before treating. Treat only positive results.',
        'If the test is negative, look for another cause of fever: pneumonia, urinary infection, typhoid, meningitis, otitis, HIV-related illness.',
      ] },
      { heading: 'Rule out severe malaria', points: [
        'Any of these makes it severe malaria (use the severe malaria pathway): unable to drink or sit, vomiting everything, convulsions, confusion or coma, respiratory distress, jaundice, dark urine, abnormal bleeding, shock, very pale (severe anaemia), hypoglycaemia.',
      ] },
      { heading: 'Treat', points: [
        'Artemether-lumefantrine (20/120 mg tablets) twice daily for 3 days, 6 doses in total; the second dose 8 hours after the first.',
        'Tablets per dose by weight: 5–14 kg one; 15–24 kg two; 25–34 kg three; 35 kg and above four.',
        'Take each dose with fatty food or milk. If vomited within 30 minutes, repeat the dose.',
        'Pregnancy: WHO now recommends artemether-lumefantrine in all trimesters; follow the current Kenyan malaria guideline for your setting.',
        'Paracetamol for fever. Watch the first dose in the clinic for young children.',
      ] },
      { heading: 'Counsel and follow up', points: [
        'Finish all 6 doses even when feeling better.',
        'Return at once if any danger sign appears, and for review if fever continues after 3 days.',
        'Prevention: sleep under a treated net every night; IPTp-SP in pregnancy where recommended; malaria vaccine for eligible children in the counties offering it.',
      ] },
    ],
    redFlags: ['Any danger sign of severe malaria', 'Pregnancy with high fever or vomiting', 'Child under 5 kg', 'Fever persisting after 3 days of treatment'],
    guideIds: ['malaria'],
    inSystem: [{ label: 'Laboratory', path: '/laboratory' }],
    sources: [
      { text: 'Ministry of Health Kenya. National Guidelines for the Diagnosis, Treatment and Prevention of Malaria in Kenya (latest edition).', url: 'https://www.health.go.ke' },
      { text: 'WHO. WHO guidelines for malaria (2024 edition, includes the 2022 recommendation on artemether-lumefantrine in the first trimester).', url: 'https://www.who.int/publications/i/item/guidelines-for-malaria' },
    ],
  },
  {
    id: 'malaria-severe',
    title: 'Severe malaria',
    category: 'Emergency',
    match: ['malaria severe', 'severe malaria', 'cerebral malaria'],
    summary: 'Stabilise, treat hypoglycaemia and convulsions, give parenteral artesunate without delay, support carefully, then complete oral treatment.',
    stages: [
      { heading: 'Immediately', points: [
        'Airway, breathing, circulation; recovery position if unconscious. Check glucose at once.',
        'Hypoglycaemia (< 3 mmol/L, or < 2.5 in a child): give 10% dextrose (children 5 ml/kg IV) and recheck in 15–30 minutes.',
        'Convulsions: a benzodiazepine (e.g. diazepam rectal or IV) per protocol; check glucose again.',
        'Weigh the patient: all doses depend on weight.',
      ] },
      { heading: 'Artesunate', points: [
        'IV (or IM) artesunate 2.4 mg/kg (3 mg/kg for children under 20 kg) at 0, 12 and 24 hours, then once daily.',
        'Give at least 24 hours (three doses) of parenteral treatment, then, once the patient can take tablets, a full 3-day course of artemether-lumefantrine.',
        'If artesunate is not available, use IM artemether or IV quinine per the national guideline.',
        'Before referral from a facility that cannot give injections: rectal artesunate (children under 6) or a first IM dose, then transfer.',
      ] },
      { heading: 'Supportive care', points: [
        'Fluids: replace deficits carefully; avoid overload. In children without shock, do not give fluid boluses (FEAST).',
        'Severe anaemia: transfuse per guideline (children usually when Hb < 5 g/dl, or < 6 with distress; adults commonly when Hb < 7 g/dl).',
        'Consider antibiotics for possible co-existing bacterial infection, especially in children in shock or coma.',
        'Paracetamol for fever; nasogastric feeding if unconscious for long.',
      ] },
      { heading: 'Monitoring', points: [
        'Consciousness (GCS or Blantyre coma score), pulse, BP, respiratory rate, SpO₂ and temperature every 1–4 hours.',
        'Glucose every 4 hours (more often if unconscious or on quinine).',
        'Urine output and fluid balance; urea, creatinine and electrolytes daily.',
      ] },
      { heading: 'After discharge', points: [
        'Check haemoglobin 1–4 weeks after artesunate: delayed haemolysis can occur.',
        'Follow up survivors of cerebral malaria for neurological or developmental problems.',
      ] },
    ],
    redFlags: ['Coma or repeated convulsions', 'Respiratory distress or acidosis', 'Shock', 'Glucose < 3 mmol/L', 'Little or no urine', 'Haemoglobin < 5 g/dl'],
    guideIds: ['malaria', 'sepsis'],
    inSystem: [{ label: 'Blood bank', path: '/blood-bank' }, { label: 'Emergency', path: '/emergency' }],
    sources: [
      { text: 'WHO. WHO guidelines for malaria (2024 edition).', url: 'https://www.who.int/publications/i/item/guidelines-for-malaria' },
      { text: 'WHO. Management of severe malaria: a practical handbook, 3rd edition (2012).', url: 'https://www.who.int/publications/i/item/9789241548526' },
      { text: 'Dondorp AM, et al. Artesunate versus quinine in the treatment of severe falciparum malaria in African children (AQUAMAT). Lancet 2010;376:1647–57.', url: 'https://doi.org/10.1016/S0140-6736(10)61924-1' },
    ],
  },
  {
    id: 'tb-presumptive',
    title: 'Presumptive TB: find, test, treat',
    category: 'Infection',
    match: ['tuberculosis', 'tb', 'presumptive tb', 'cough two weeks'],
    summary: 'Screen, protect others, test with GeneXpert first, start the right regimen, notify, trace contacts and monitor to cure.',
    stages: [
      { heading: 'Who is presumptive TB?', points: [
        'Cough of 2 weeks or more, or any cough in people living with HIV, contacts of TB patients, diabetics and other high-risk people.',
        'Fever, night sweats or weight loss; in children, poor weight gain, reduced playfulness or a TB contact.',
      ] },
      { heading: 'Protect others (triage)', points: [
        'Fast-track coughing patients, give a mask, seat them in a well-ventilated area and teach cough etiquette.',
      ] },
      { heading: 'Test', points: [
        'GeneXpert MTB/RIF Ultra (or another WHO-recommended rapid molecular test) on sputum as the first test for everyone.',
        'Children: sputum, induced sputum, gastric aspirate, nasopharyngeal aspirate or stool for Xpert Ultra.',
        'People living with HIV who are seriously ill or have advanced disease: add urine TB-LAM.',
        'Chest X-ray where available. HIV test for everyone with presumptive TB.',
        'Extrapulmonary TB: samples from the site (lymph node aspirate, pleural or ascitic fluid, CSF).',
        'Rifampicin resistance detected: start the drug-resistant TB pathway and send for line-probe assay, culture and susceptibility testing.',
        'Xpert negative but symptoms continue: clinical review, chest X-ray, repeat testing or culture. Avoid fluoroquinolones as a "trial" because they can mask TB.',
      ] },
      { heading: 'Treat drug-susceptible TB', points: [
        'Adults: 2 months of rifampicin, isoniazid, pyrazinamide and ethambutol (2RHZE), then 4 months of rifampicin and isoniazid (4RH), as weight-band fixed-dose combinations.',
        'Children 3 months to 16 years with non-severe TB: the 4-month regimen 2HRZ(E)/2HR.',
        'TB meningitis and bone or joint TB: 12 months, with steroids for meningitis per guideline.',
        'Pyridoxine with isoniazid for people with HIV, diabetes, malnutrition, alcohol use or pregnancy.',
        'HIV: start ART within 2 weeks of TB treatment (4–6 weeks for TB meningitis); dolutegravir 50 mg twice daily with rifampicin and for 2 weeks after.',
      ] },
      { heading: 'Notify, support and trace', points: [
        'Register and notify the case in the national TB system.',
        'Agree a treatment supporter (DOT) and give a monthly appointment.',
        'Nutritional assessment and support.',
        'Screen all household contacts; give TB preventive treatment to eligible contacts once active TB is ruled out.',
      ] },
      { heading: 'Monitor to cure', points: [
        'Weight and adherence at each visit; adjust the dose to new weight bands.',
        'Bacteriologically confirmed pulmonary TB: sputum smear at the end of month 2 (intensive phase), month 5 and month 6.',
        'Side effects: jaundice or vomiting (stop drugs and check liver tests), tingling feet (pyridoxine), blurred or colour vision change (stop ethambutol), rash.',
        'Missed doses: trace within days, not weeks; the HIV & TB Care screen lists people who missed doses.',
      ] },
    ],
    redFlags: ['Coughing up large amounts of blood', 'Respiratory distress or SpO₂ < 90%', 'Neck stiffness, confusion or severe headache (TB meningitis)', 'Back pain with leg weakness (spinal TB)', 'Jaundice on treatment'],
    guideIds: ['tb-drugs', 'hiv-oi'],
    inSystem: [{ label: 'HIV & TB Care', path: '/hivtb' }, { label: 'Laboratory', path: '/laboratory' }],
    sources: [
      { text: 'National TB, Leprosy and Lung Disease Program (Kenya). Integrated guideline for tuberculosis, leprosy and lung disease (latest edition).', url: 'https://www.nltp.co.ke' },
      { text: 'WHO. Consolidated guidelines on tuberculosis. Module 3: diagnosis (2024); Module 4: treatment (2022); Module 5: children and adolescents (2022).', url: 'https://www.who.int/publications/i/item/9789240089488' },
    ],
  },
  {
    id: 'hiv-initiation',
    title: 'Starting HIV treatment',
    category: 'HIV & chronic care',
    match: ['hiv initiation', 'new hiv', 'hiv positive', 'newly diagnosed hiv'],
    summary: 'Verify the diagnosis, screen for advanced disease and TB, start a dolutegravir-based regimen quickly, prevent infections and link to follow-up.',
    stages: [
      { heading: 'Confirm and prepare', points: [
        'Retest with a new sample before starting ART, as the national algorithm requires.',
        'Counsel on treatment, adherence, disclosure, partner and children testing (index testing) and U = U (an undetectable viral load does not transmit HIV sexually).',
      ] },
      { heading: 'Baseline assessment', points: [
        'WHO clinical stage, weight, BMI, BP; pregnancy status and family-planning plans.',
        'TB symptom screen at every visit; chest X-ray and Xpert as indicated.',
        'CD4 count. Advanced HIV disease = CD4 < 200 cells/µl or WHO stage 3–4 (all children under 5): offer the advanced-disease package.',
        'Advanced disease package: serum cryptococcal antigen (CrAg) if CD4 ≤ 200, urine TB-LAM, cotrimoxazole, and close follow-up.',
        'Creatinine (for tenofovir), haemoglobin, hepatitis B surface antigen, syphilis test, glucose; mental health and alcohol screening.',
      ] },
      { heading: 'Start ART', points: [
        'Same day or within 7 days once the person is ready.',
        'Adults and adolescents 30 kg and above (including pregnant women): tenofovir + lamivudine + dolutegravir (TLD) once daily.',
        'Kidney problems (low creatinine clearance): replace tenofovir per the national guideline (e.g. abacavir).',
        'Children: abacavir + lamivudine with dolutegravir (paediatric dispersible tablets for smaller children) by weight band.',
        'On rifampicin: dolutegravir 50 mg twice daily during TB treatment and for 2 weeks after.',
        'Delay ART for 4–6 weeks in cryptococcal or TB meningitis; otherwise start within 2 weeks of TB treatment.',
      ] },
      { heading: 'Prevent infections', points: [
        'TB preventive treatment (e.g. 3HP or 6H with pyridoxine) once active TB is excluded.',
        'Cotrimoxazole preventive therapy per national criteria.',
        'Positive CrAg without meningitis: pre-emptive fluconazole per guideline; positive with symptoms: lumbar puncture and meningitis treatment.',
      ] },
      { heading: 'Follow-up', points: [
        'Early visits at about 2 weeks and 1 month for adherence and side effects (sleep problems, headache, weight gain, rash, jaundice).',
        'First viral load per the national schedule (Kenya 2022: 3 months after starting), then routinely; more often for children, adolescents and young people, and pregnant or breastfeeding women.',
        'Move stable clients into differentiated service delivery with multi-month dispensing.',
      ] },
    ],
    redFlags: ['Headache, neck stiffness or confusion (possible cryptococcal meningitis)', 'Cough, fever or weight loss (TB)', 'New symptoms after starting ART (possible IRIS)', 'Jaundice or severe rash', 'CD4 < 200 or WHO stage 4'],
    guideIds: ['hiv-oi', 'tb-drugs'],
    inSystem: [{ label: 'HIV & TB Care', path: '/hivtb' }, { label: 'Laboratory', path: '/laboratory' }],
    sources: [
      { text: 'NASCOP, Ministry of Health Kenya. Kenya HIV Prevention and Treatment Guidelines, 2022 edition.', url: 'https://www.nascop.or.ke' },
      { text: 'WHO. Consolidated guidelines on HIV prevention, testing, treatment, service delivery and monitoring (2021).', url: 'https://www.who.int/publications/i/item/9789240031593' },
    ],
  },
  {
    id: 'hiv-monitoring',
    title: 'HIV treatment follow-up and viral load',
    category: 'HIV & chronic care',
    match: ['hiv monitoring', 'hiv follow up', 'viral load', 'ccc'],
    summary: 'Use every visit for adherence, TB screening and prevention; act on an unsuppressed viral load with enhanced adherence support and MDT review.',
    stages: [
      { heading: 'Every visit', points: [
        'Adherence (self-report, pill count, refill dates) and barriers: transport, food, stigma, alcohol, mental health.',
        'Four-symptom TB screen (cough, fever, weight loss, night sweats); recorded on the ART visit in the HIV & TB Care screen.',
        'Weight, BP, side effects, new medicines and interactions, pregnancy and family planning.',
        'Next appointment and months of drugs given (multi-month dispensing for stable clients).',
      ] },
      { heading: 'Viral load results', points: [
        'Below 50 copies/ml: suppressed. Continue and keep the routine schedule.',
        '50–199 copies/ml (low-level viraemia): review adherence and repeat per the national guideline.',
        '200 copies/ml or more: not suppressed. Enhanced adherence counselling (about three sessions over 3 months), check for interactions and wrong dosing, then repeat the viral load.',
        'Still not suppressed after adherence support: present to the facility multidisciplinary team for a switch decision and drug-resistance testing where indicated.',
        'Check CD4 when the viral load is unsuppressed or the client is unwell, to detect advanced disease.',
      ] },
      { heading: 'Routine checks', points: [
        'Creatinine at least yearly on tenofovir; glucose and lipids yearly.',
        'Cervical cancer screening for women living with HIV per the national schedule.',
        'TB preventive treatment completed; cotrimoxazole per criteria; vaccinations.',
        'Screen for depression, alcohol use and hypertension or diabetes.',
      ] },
      { heading: 'Keeping people in care', points: [
        'Missed appointment: call or trace within days. The Defaulter tracing tab lists missed (1–7 days), defaulter (8–30) and interruption (> 30 days) clients.',
        'Record every tracing attempt and its outcome; welcome people back without blame.',
      ] },
    ],
    redFlags: ['Viral load ≥ 200 copies/ml on two tests after adherence support', 'New TB symptoms', 'Interruption of treatment > 30 days', 'CD4 < 200 cells/µl', 'Pregnancy with an unsuppressed viral load'],
    guideIds: ['hiv-oi'],
    inSystem: [{ label: 'HIV & TB Care', path: '/hivtb' }],
    sources: [
      { text: 'NASCOP, Ministry of Health Kenya. Kenya HIV Prevention and Treatment Guidelines, 2022 edition.', url: 'https://www.nascop.or.ke' },
      { text: 'WHO. Consolidated guidelines on HIV prevention, testing, treatment, service delivery and monitoring (2021).', url: 'https://www.who.int/publications/i/item/9789240031593' },
    ],
  },
  {
    id: 'type2-diabetes',
    title: 'Type 2 diabetes follow-up',
    category: 'HIV & chronic care',
    match: ['diabetes', 'type 2', 't2dm', 'dm'],
    summary: 'Agree a personal target, step up treatment when it is not met, screen for complications every year and prevent hypoglycaemia.',
    stages: [
      { heading: 'Every visit', points: [
        'Symptoms of high or low sugar, glucose readings, weight and waist, BP, foot check if high risk, adherence, medicine supply and cost.',
        'Smoking, diet, physical activity, alcohol and mood.',
      ] },
      { heading: 'Targets', points: [
        'HbA1c below 7% (53 mmol/mol) for most adults; below 8% for frail or elderly people, limited life expectancy or repeated hypoglycaemia.',
        'Fasting glucose about 4.4–7.2 mmol/L.',
        'BP below 130/80 mmHg where this can be reached safely; otherwise below 140/90.',
      ] },
      { heading: 'Medicines (step up every 3 months if the target is not met)', points: [
        'Metformin first unless contraindicated: start 500 mg once or twice daily with meals and increase towards 1 g twice daily. eGFR 30–44: maximum 1 g a day; stop below 30.',
        'Add a sulfonylurea (e.g. gliclazide) if still above target; warn about hypoglycaemia.',
        'Start insulin when HbA1c is ≥ 10% or glucose ≥ 16.7 mmol/L with symptoms, weight loss, ketones, or when tablets fail.',
        'SGLT2 inhibitor or GLP-1 receptor agonist, where available, for established cardiovascular disease, heart failure or chronic kidney disease.',
        'Statin for everyone aged 40 or over (e.g. atorvastatin 20 mg). ACE inhibitor or ARB for albuminuria or hypertension. Aspirin only after a heart attack or stroke.',
      ] },
      { heading: 'Yearly complication screening', points: [
        'Creatinine/eGFR and urine albumin-to-creatinine ratio.',
        'Lipids.',
        'Eye examination (dilated fundoscopy or retinal photo): at diagnosis and every 1–2 years.',
        'Foot examination with monofilament and pulses; every visit if there is neuropathy, deformity or a past ulcer.',
        'HbA1c every 3 months until at target, then every 6 months.',
      ] },
      { heading: 'Hypoglycaemia (glucose < 3.9 mmol/L)', points: [
        'Awake and able to swallow: 15–20 g fast sugar (e.g. 150–200 ml juice or 3–4 teaspoons of sugar in water), recheck in 15 minutes, then a meal.',
        'Unconscious or unable to swallow: IV 10% dextrose (150–200 ml over about 15 minutes in adults) or glucagon 1 mg IM; find the cause and review the medicines.',
      ] },
      { heading: 'Education', points: [
        'Sick-day rules: keep drinking; pause metformin and SGLT2 inhibitors during vomiting, diarrhoea or dehydration; never stop insulin, check glucose more often.',
        'Daily foot care and footwear; self-monitoring where possible.',
        'Review every 1–3 months until stable, then every 3–6 months.',
      ] },
    ],
    redFlags: ['Glucose > 16.7 mmol/L with vomiting, drowsiness or ketones (DKA or HHS)', 'Foot ulcer, infection or black toes', 'Sudden loss of vision', 'Chest pain or stroke symptoms', 'Recurrent hypoglycaemia'],
    guideIds: [],
    inSystem: [{ label: 'Chronic Disease', path: '/chronic-disease' }],
    sources: [
      { text: 'Ministry of Health Kenya. Kenya National Clinical Guidelines for the Management of Diabetes Mellitus, 2nd edition (2018).', url: 'https://www.health.go.ke' },
      { text: 'American Diabetes Association. Standards of Care in Diabetes—2025. Diabetes Care 2025;48(Suppl 1).', url: 'https://diabetesjournals.org/care/issue/48/Supplement_1' },
      { text: 'WHO. HEARTS-D: diagnosis and management of type 2 diabetes (2020).', url: 'https://www.who.int/publications/i/item/who-ucn-ncd-20.1' },
    ],
  },
  {
    id: 'hypertension',
    title: 'Hypertension: confirm, treat, control',
    category: 'HIV & chronic care',
    match: ['hypertension', 'blood pressure', 'htn', 'high blood pressure'],
    summary: 'Measure correctly, separate emergencies from routine high readings, start and step up treatment monthly until controlled.',
    stages: [
      { heading: 'Measure correctly', points: [
        'Right cuff size, seated for 5 minutes, arm supported at heart level; take two readings 1–2 minutes apart and use the average.',
        'Diagnose hypertension at ≥ 140/90 mmHg on two separate visits (one visit is enough at ≥ 180/110 or with organ damage). Home readings help where available.',
      ] },
      { heading: 'Very high readings (≥ 180/110)', points: [
        'Look for organ damage: chest pain, breathlessness, new weakness or speech problem, severe headache with confusion, visual loss, low urine output, pregnancy.',
        'With organ damage (hypertensive emergency): admit, lower BP gradually (by no more than about 25% in the first hours, except specific conditions such as aortic dissection) under senior guidance.',
        'Pregnant (20 weeks or more) or recently delivered: use the pre-eclampsia pathway.',
        'Without organ damage: start or step up oral treatment and review within a week. Do not try to normalise BP within hours.',
      ] },
      { heading: 'Baseline checks', points: [
        'Urine dipstick for protein and blood, creatinine/eGFR, sodium and potassium, glucose or HbA1c, lipids, ECG.',
        'Cardiovascular risk (WHO risk charts); smoking, alcohol, salt intake; secondary causes in young people or resistant hypertension.',
      ] },
      { heading: 'Treatment', points: [
        'Everyone: less salt (under 5 g a day), more fruit and vegetables, activity, weight loss if overweight, limit alcohol, stop smoking.',
        'Start medicines for confirmed BP ≥ 140/90. First-line classes: long-acting calcium-channel blocker (e.g. amlodipine 5–10 mg), thiazide or thiazide-like diuretic (e.g. hydrochlorothiazide 12.5–25 mg), ACE inhibitor or ARB.',
        'For Black African adults, a calcium-channel blocker or diuretic works best as the first drug; combinations (ideally one pill) control BP faster.',
        'ACE inhibitor or ARB first for diabetes with albuminuria, chronic kidney disease or heart failure. Never combine an ACE inhibitor with an ARB.',
        'Avoid ACE inhibitors and ARBs in pregnancy and counsel women who may become pregnant.',
        'Check creatinine and potassium 2–4 weeks after starting an ACE inhibitor, ARB or diuretic.',
      ] },
      { heading: 'Targets and follow-up', points: [
        'Target below 140/90 for all; below 130/80 for those with cardiovascular disease, diabetes or kidney disease if tolerated.',
        'Review monthly and step up until controlled, then every 3–6 months.',
        'Not controlled on three drugs including a diuretic: check adherence and technique, consider spironolactone 25 mg if potassium and kidney function allow, and refer.',
      ] },
    ],
    redFlags: ['BP ≥ 180/110 with chest pain, breathlessness, neurological signs or confusion', 'High BP in pregnancy or after delivery', 'Rising creatinine or potassium on treatment'],
    guideIds: [],
    inSystem: [{ label: 'Chronic Disease', path: '/chronic-disease' }],
    sources: [
      { text: 'WHO. Guideline for the pharmacological treatment of hypertension in adults (2021).', url: 'https://www.who.int/publications/i/item/9789240033986' },
      { text: 'Unger T, et al. 2020 International Society of Hypertension global hypertension practice guidelines. Hypertension 2020;75:1334–57.', url: 'https://doi.org/10.1161/HYPERTENSIONAHA.120.15026' },
      { text: 'Ministry of Health Kenya. Kenya National Guidelines for Cardiovascular Diseases Management (2018).', url: 'https://www.health.go.ke' },
    ],
  },
  {
    id: 'dka-adult',
    title: 'Diabetic ketoacidosis in adults',
    category: 'Emergency',
    match: ['dka', 'diabetic ketoacidosis', 'ketoacidosis'],
    summary: 'Confirm DKA, give fluids, start a fixed-rate insulin infusion, replace potassium, monitor hourly and switch to subcutaneous insulin when resolved.',
    stages: [
      { heading: 'Confirm', points: [
        'Glucose ≥ 11.1 mmol/L or known diabetes, ketones ≥ 3.0 mmol/L (or urine ketones 2+ or more), and acidosis: pH < 7.3 and/or bicarbonate < 18 mmol/L.',
        'Normal glucose does not exclude DKA in people taking SGLT2 inhibitors or in pregnancy.',
        'Find the trigger: infection, missed insulin, new diabetes, heart attack, pancreatitis, drugs.',
        'HDU review for: pH < 7.0, bicarbonate < 5, ketones > 6, potassium < 3.5 on arrival, GCS < 12, systolic BP < 90, SpO₂ < 92%.',
      ] },
      { heading: 'Fluids (adults)', points: [
        'Systolic BP < 90: 500 ml 0.9% sodium chloride over 10–15 minutes, repeat if still low, and call for senior help.',
        'Otherwise 0.9% sodium chloride: 1 L over the first hour, then 1 L over 2 hours, 1 L over 2 hours, 1 L over 4 hours, 1 L over 4 hours, 1 L over 6 hours.',
        'Go slower in the elderly, in heart or kidney failure, in pregnancy and in young adults aged 18–25 (cerebral oedema risk).',
      ] },
      { heading: 'Insulin', points: [
        'Fixed-rate IV insulin infusion 0.1 unit/kg/hour (e.g. 50 units soluble insulin in 50 ml 0.9% sodium chloride). Continue the usual long-acting insulin.',
        'When glucose falls below 14 mmol/L, add 10% glucose at 125 ml/hour alongside the saline; do not stop the insulin.',
        'No infusion pump: use the hospital\'s hourly subcutaneous or intramuscular rapid-acting insulin protocol.',
      ] },
      { heading: 'Potassium (in each litre after the first)', points: [
        'Potassium above 5.5 mmol/L: none. 3.5–5.5: add 40 mmol per litre. Below 3.5: senior review, more potassium; hold insulin if potassium is below 3.3 until it is replaced.',
        'Do not give bicarbonate routinely.',
      ] },
      { heading: 'Monitoring', points: [
        'Glucose and ketones every hour; venous gas (pH, bicarbonate, potassium) at 1 and 2 hours, then every 2 hours.',
        'Aim each hour for ketones falling ≥ 0.5 mmol/L, bicarbonate rising ≥ 3 mmol/L and glucose falling ≥ 3 mmol/L; if not, increase insulin by 1 unit/hour.',
        'Fluid balance chart, GCS, and ECG if potassium is abnormal.',
      ] },
      { heading: 'Resolution and after', points: [
        'Resolved when ketones < 0.6 mmol/L and venous pH > 7.3. Start subcutaneous insulin with a meal and stop the infusion 30–60 minutes later.',
        'Diabetes education, insulin technique, sick-day rules, and follow-up within 2 weeks.',
        'Under 18 years: use the paediatric DKA protocol (slower fluids, insulin 0.05–0.1 unit/kg/hour started after the first hour of fluids, watch for cerebral oedema).',
      ] },
    ],
    redFlags: ['Headache, slowing pulse, rising BP or confusion during treatment (cerebral oedema)', 'Potassium < 3.5 or > 6.0 mmol/L', 'pH < 7.0', 'Reduced consciousness', 'No improvement in ketones after 2 hours'],
    guideIds: [],
    inSystem: [{ label: 'Emergency', path: '/emergency' }, { label: 'Critical results', path: '/critical-results' }],
    sources: [
      { text: 'Joint British Diabetes Societies for Inpatient Care. The management of diabetic ketoacidosis in adults (updated 2023).', url: 'https://abcd.care/joint-british-diabetes-societies-jbds-inpatient-care-group' },
      { text: 'Umpierrez GE, et al. Hyperglycemic crises in adults with diabetes: a consensus report. Diabetes Care 2024;47:1257–75.', url: 'https://doi.org/10.2337/dci24-0032' },
      { text: 'ISPAD Clinical Practice Consensus Guidelines 2022: diabetic ketoacidosis and hyperglycemic hyperosmolar state. Pediatr Diabetes 2022;23:835–56.', url: 'https://doi.org/10.1111/pedi.13406' },
    ],
  },
  {
    id: 'pre-eclampsia',
    title: 'Pre-eclampsia and eclampsia',
    category: 'Maternity',
    match: ['pre-eclampsia', 'preeclampsia', 'eclampsia', 'hypertension in pregnancy', 'pih'],
    summary: 'Detect high BP after 20 weeks, prevent and treat fits with magnesium sulphate, control severe hypertension and plan timely delivery.',
    stages: [
      { heading: 'Detect', points: [
        'BP ≥ 140/90 on two readings 4 hours apart after 20 weeks (once if ≥ 160/110), with proteinuria (≥ 1+ on dipstick) or signs of organ involvement.',
        'Severe features: BP ≥ 160/110, severe headache, visual disturbance, upper abdominal pain, vomiting, breathlessness, low platelets, raised liver enzymes, rising creatinine, poor fetal growth.',
        'Tests: full blood count (platelets), liver enzymes, creatinine, urine protein; clotting if platelets are low.',
      ] },
      { heading: 'Eclampsia (a fit)', points: [
        'Call for help, never leave the woman alone, left lateral position, protect from injury, airway and oxygen.',
        'Give magnesium sulphate at once (below). A further fit: 2 g magnesium sulphate IV over 5 minutes.',
      ] },
      { heading: 'Magnesium sulphate (severe pre-eclampsia and eclampsia)', points: [
        'Loading dose: 4 g IV (20% solution) over 5–15 minutes, plus 10 g IM (5 g of 50% solution deep into each buttock, with 1 ml 2% lidocaine).',
        'Maintenance: 5 g IM every 4 hours in alternate buttocks, or 1 g/hour by IV infusion, for 24 hours after delivery or the last fit, whichever is later.',
        'Before each dose check: respiratory rate ≥ 16/min, knee reflexes present, urine ≥ 30 ml/hour (100 ml over 4 hours). If not, withhold and review.',
        'Toxicity (breathing slows, reflexes lost): stop magnesium and give calcium gluconate 1 g IV (10 ml of 10%) over 10 minutes.',
      ] },
      { heading: 'Severe hypertension (≥ 160/110)', points: [
        'Lower it within an hour: nifedipine immediate-release 10 mg orally (repeat after 30 minutes if needed), or hydralazine 5 mg IV slowly repeated every 20–30 minutes (maximum about 20 mg), or IV labetalol per protocol.',
        'Aim for about 140–150/90–100; avoid dropping BP sharply below this (it reduces blood flow to the baby).',
        'Maintenance: methyldopa, nifedipine slow-release or labetalol.',
      ] },
      { heading: 'Plan delivery', points: [
        'Delivery is the cure. Eclampsia: deliver within 12 hours of stabilisation; severe pre-eclampsia: within 24 hours.',
        'Without severe features: deliver at 37 weeks; closely monitored expectant care before that in a facility that can act fast.',
        'Below 34 weeks: dexamethasone 6 mg IM every 12 hours for 4 doses for the baby\'s lungs; involve the neonatal team.',
        'Limit IV fluids (about 80 ml/hour total) to avoid pulmonary oedema; strict fluid balance.',
      ] },
      { heading: 'After delivery', points: [
        'BP at least 4-hourly for 3 days; continue antihypertensives and wean slowly. Fits can occur up to 6 weeks after birth.',
        'Review at 1–2 weeks and at 6 weeks. Next pregnancy: low-dose aspirin (75–150 mg nightly) from 12 weeks to 36 weeks, and calcium supplements where dietary intake is low.',
      ] },
    ],
    redFlags: ['Convulsion', 'BP ≥ 160/110', 'Severe headache or visual disturbance', 'Upper abdominal pain or vomiting', 'Breathlessness (pulmonary oedema)', 'Respiratory rate < 16/min or absent reflexes on magnesium'],
    guideIds: [],
    inSystem: [{ label: 'Maternity & Child Health', path: '/maternity' }, { label: 'Theatre', path: '/theatre' }],
    sources: [
      { text: 'WHO. WHO recommendations for prevention and treatment of pre-eclampsia and eclampsia (2011) and the 2020 update on antihypertensive treatment.', url: 'https://www.who.int/publications/i/item/9789241548335' },
      { text: 'Magpie Trial Collaborative Group. Do women with pre-eclampsia, and their babies, benefit from magnesium sulphate? Lancet 2002;359:1877–90.', url: 'https://doi.org/10.1016/S0140-6736(02)08778-0' },
      { text: 'Ministry of Health Kenya. National Guidelines for Quality Obstetrics and Perinatal Care (latest edition).', url: 'https://www.health.go.ke' },
    ],
  },
  {
    id: 'pph',
    title: 'Postpartum haemorrhage',
    category: 'Maternity',
    match: ['pph', 'postpartum haemorrhage', 'postpartum hemorrhage', 'bleeding after delivery'],
    summary: 'Prevent with active management, detect early by measuring blood loss, and give the first-response bundle within minutes before escalating.',
    stages: [
      { heading: 'Prevent (every birth)', points: [
        'Uterotonic within a minute of birth: oxytocin 10 IU IM or IV (heat-stable carbetocin 100 micrograms IM is an alternative).',
        'Controlled cord traction by a skilled attendant; check uterine tone after delivery of the placenta.',
        'Measure blood loss with a calibrated drape instead of guessing.',
      ] },
      { heading: 'Detect early', points: [
        'Act at 300 ml with abnormal observations, or at 500 ml after a vaginal birth, or at any loss that makes the woman unstable.',
        'Shock index (pulse ÷ systolic BP) ≥ 0.9 is a warning; ≥ 1.4 needs urgent action.',
      ] },
      { heading: 'First response bundle (start together, within 15 minutes)', points: [
        'Call for help. Uterine massage.',
        'Oxytocin 10 IU IV slowly or IM, then an infusion (e.g. 20–40 IU in 1 litre of crystalloid).',
        'Tranexamic acid 1 g IV over 10 minutes, as early as possible and within 3 hours of birth; a second 1 g if bleeding continues after 30 minutes or restarts within 24 hours.',
        'Two large IV cannulae, warm crystalloid, empty the bladder.',
        'Examine for the cause (the 4 Ts): Tone (soft uterus), Trauma (tears, rupture), Tissue (retained placenta or membranes), Thrombin (clotting problem).',
        'Blood for group and crossmatch, haemoglobin and clotting.',
      ] },
      { heading: 'If bleeding continues', points: [
        'Further uterotonics: ergometrine 0.2 mg IM (not with high BP or pre-eclampsia), misoprostol 800 micrograms sublingually.',
        'Bimanual uterine compression or aortic compression while preparing the next step.',
        'Uterine balloon tamponade (a condom catheter works); non-pneumatic anti-shock garment for transfer.',
        'Repair tears; manual removal of placenta or retained tissue under anaesthesia.',
        'Theatre for compression sutures, uterine artery ligation or hysterectomy; activate the massive transfusion process with the blood bank.',
      ] },
      { heading: 'Monitoring and after care', points: [
        'Pulse, BP, respiratory rate, SpO₂ every 15 minutes until stable; urine output hourly.',
        'Haemoglobin after 24–48 hours; iron or transfusion as needed; thromboprophylaxis once bleeding has stopped.',
        'Debrief the woman and family; review the case in the maternal death and near-miss audit (Quality & Safety).',
      ] },
    ],
    redFlags: ['Blood loss ≥ 1,000 ml or ongoing bleeding after the first-response bundle', 'Shock index ≥ 1.4', 'Confusion or reduced consciousness', 'Bleeding from cannula sites (clotting failure)'],
    guideIds: [],
    inSystem: [{ label: 'Maternity & Child Health', path: '/maternity' }, { label: 'Blood bank', path: '/blood-bank' }, { label: 'Quality & Safety', path: '/quality-safety' }],
    sources: [
      { text: 'WHO. WHO recommendations on the assessment of postpartum blood loss and use of a treatment bundle for postpartum haemorrhage (2023).', url: 'https://www.who.int/publications/i/item/9789240085398' },
      { text: 'Gallos I, et al. Randomized trial of early detection and treatment of postpartum hemorrhage (E-MOTIVE). N Engl J Med 2023;389:11–21.', url: 'https://doi.org/10.1056/NEJMoa2303966' },
      { text: 'WOMAN Trial Collaborators. Effect of early tranexamic acid administration on mortality, hysterectomy, and other morbidities in women with post-partum haemorrhage. Lancet 2017;389:2105–16.', url: 'https://doi.org/10.1016/S0140-6736(17)30638-4' },
    ],
  },
  {
    id: 'diarrhoea-child',
    title: 'Diarrhoea and dehydration in children',
    category: 'Child health',
    match: ['diarrhoea', 'diarrhea', 'gastroenteritis', 'dehydration', 'acute watery diarrhoea'],
    summary: 'Classify dehydration, treat with Plan A, B or C, give zinc, keep feeding, and treat dysentery or malnutrition differently.',
    stages: [
      { heading: 'Assess dehydration', points: [
        'Severe (two or more): lethargic or unconscious, sunken eyes, not able to drink or drinking poorly, skin pinch goes back very slowly (2 seconds or more).',
        'Some (two or more): restless or irritable, sunken eyes, drinks eagerly, skin pinch goes back slowly.',
        'No dehydration: not enough signs for the above.',
        'Also check: blood in the stool (dysentery), diarrhoea for 14 days or more (persistent), severe acute malnutrition (MUAC < 11.5 cm or oedema), signs of shock.',
      ] },
      { heading: 'Plan A: no dehydration (home)', points: [
        'ORS after each loose stool: under 2 years 50–100 ml; 2 years and over 100–200 ml.',
        'Zinc for 10–14 days: 10 mg a day under 6 months, 20 mg a day from 6 months.',
        'Continue breastfeeding and feeding. Return if the child drinks poorly, gets worse, has blood in the stool or fever.',
      ] },
      { heading: 'Plan B: some dehydration (facility)', points: [
        'ORS 75 ml/kg over 4 hours, given by spoon or cup; continue breastfeeding.',
        'Reassess after 4 hours and choose Plan A, B or C again.',
      ] },
      { heading: 'Plan C: severe dehydration', points: [
        'Shock: follow the shock protocol in the national paediatric protocols first.',
        'IV Ringer\'s lactate (or 0.9% saline) 100 ml/kg: under 12 months, 30 ml/kg over 1 hour then 70 ml/kg over 5 hours; 12 months and over, 30 ml/kg over 30 minutes then 70 ml/kg over 2½ hours.',
        'Reassess every 1–2 hours; repeat the first part if the radial pulse is still weak. Start ORS (about 5 ml/kg/hour) as soon as the child can drink.',
        'No IV access: ORS 20 ml/kg/hour by nasogastric tube for 6 hours, and refer.',
        'Severe acute malnutrition: do not use these rapid IV regimens; follow the SAM protocol (ReSoMal, careful fluids).',
      ] },
      { heading: 'Medicines', points: [
        'No antidiarrhoeal or antiemetic drugs for young children.',
        'Antibiotics only for dysentery (ciprofloxacin 15 mg/kg twice daily for 3 days) or suspected cholera with severe dehydration.',
        'Suspected cholera or a cluster of cases: notify the county disease surveillance officer within 24 hours.',
      ] },
      { heading: 'Prevention', points: [
        'Rotavirus vaccine, exclusive breastfeeding for 6 months, handwashing with soap, safe water and latrines.',
      ] },
    ],
    redFlags: ['Lethargy or unconsciousness', 'Unable to drink', 'Signs of shock', 'Severe acute malnutrition', 'Blood in stool in an infant', 'Repeated vomiting preventing ORS'],
    guideIds: [],
    inSystem: [{ label: 'Maternity & Child Health', path: '/maternity' }],
    sources: [
      KE_PAEDS,
      { text: 'WHO. The treatment of diarrhoea: a manual for physicians and other senior health workers, 4th revision (2005).', url: 'https://www.who.int/publications/i/item/9241593180' },
      { text: 'WHO/UNICEF. Integrated Management of Childhood Illness (IMCI) chart booklet (2014).', url: 'https://www.who.int/publications/m/item/integrated-management-of-childhood-illness---chart-booklet-(march-2014)' },
    ],
  },
]

export const PATHWAY_CATEGORIES = [...new Set(CARE_PATHWAYS.map((p) => p.category))]

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Pick a pathway for an encounter: an exact id first, then the first pathway whose match terms appear in the text. */
export function suggestPathwayId(pathways, ...texts) {
  const list = pathways || CARE_PATHWAYS
  for (const t of texts) {
    const n = norm(t)
    if (!n) continue
    const exact = list.find((p) => norm(p.id) === n)
    if (exact) return exact.id
  }
  const hay = ` ${texts.map(norm).join(' ')} `
  if (!hay.trim()) return ''
  // longest term first so "severe malaria" beats "malaria"
  const terms = list.flatMap((p) => (p.match || []).map((m) => [norm(m), p.id])).filter(([m]) => m).sort((a, b) => b[0].length - a[0].length)
  return terms.find(([m]) => hay.includes(` ${m} `))?.[1] || ''
}
