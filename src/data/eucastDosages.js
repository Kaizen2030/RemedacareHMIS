// EUCAST "Dosages used to define breakpoints" (Clinical Breakpoint Tables v16.0, valid from 2026-01-01), transcribed
// for the antibiotic codes used in Microbiology. EUCAST content is reproduced with citation as EUCAST permits.
// These are the exposures the S and I categories assume — NOT a dosing guideline: EUCAST states the table should not be
// used for dosing in clinical practice. "I" (susceptible, increased exposure) means the HIGH dosage is needed.
// Source: https://www.eucast.org/clinical_breakpoints  (also shipped in the user's copy Dosages_v_16.0_Breakpoint_Tables.pdf)

export const EUCAST_DOSAGE_VERSION = 'EUCAST breakpoint tables v16.0 (2026), dosages used to define breakpoints'

export const EUCAST_DOSAGES = {
  PEN: { standard: '0.6 g (1 MU) × 4 IV', high: '1.2 g (2 MU) × 6 IV', special: 'Meningitis: 2.4 g (4 MU) × 6 IV' },
  AMP: { standard: '2 g × 3 IV', high: '2 g × 4 IV', special: 'Meningitis: 2 g × 6 IV' },
  AMX: { standard: '1 g × 3–4 IV; oral 0.5 g × 3', high: '2 g × 6 IV; oral 0.75–1 g × 3', special: 'Meningitis: 2 g × 6 IV. Uncomplicated UTI: 0.5 g × 3 oral' },
  AMC: { standard: '(1 g + 0.2 g) × 3–4 IV; oral (0.5 g + 0.125 g) × 3', high: '(2 g + 0.2 g) × 3 IV; oral (0.875 g + 0.125 g) × 3', special: 'Separate breakpoints apply for uncomplicated UTI' },
  SAM: { standard: '(2 g + 1 g) × 3 IV', high: '(2 g + 1 g) × 4 IV' },
  TZP: { standard: '(4 g + 0.5 g) × 4 IV over 30 min, or × 3 IV by extended 4-hour infusion', high: '(4 g + 0.5 g) × 4 IV by extended 3-hour infusion', special: '(4 g + 0.5 g) × 3 over 30 min suffices for some infections (cUTI, intra-abdominal, diabetic foot) but not for isolates resistant to 3rd-generation cephalosporins' },
  OXA: { standard: '1 g × 4 IV', high: 'Varies by indication' },
  CXM: { standard: '0.75 g × 3 IV; oral 0.25 g × 2', high: '1.5 g × 3 IV; oral 0.5 g × 2', special: 'S. aureus: high dose only' },
  CTX: { standard: '1 g × 3 IV', high: '2 g × 3 IV', special: 'Meningitis: 2 g × 4 IV. S. aureus: high dose only' },
  CRO: { standard: '2 g × 1 IV', high: '2 g × 2 IV or 4 g × 1 IV', special: 'Meningitis: 2 g × 2 IV or 4 g × 1 IV. S. aureus: high dose only' },
  CAZ: { standard: '1 g × 3 IV', high: '2 g × 3 IV or 1 g × 6 IV' },
  FEP: { standard: '1 g × 3 IV or 2 g × 2 IV', high: '2 g × 3 IV', special: 'Severe P. aeruginosa: 2 g × 3 by extended 4-hour infusion. S. aureus: high dose only' },
  CPT: { standard: '0.6 g × 2 IV over 1 hour', high: '0.6 g × 3 IV over 2 hours' },
  ETP: { standard: '1 g × 1 IV over 30 min', high: null },
  IPM: { standard: '0.5 g × 4 IV over 30 min', high: '1 g × 4 IV over 30 min' },
  MEM: { standard: '1 g × 3 IV over 30 min', high: '2 g × 3 IV over 3 hours', special: 'Meningitis: 2 g × 3 IV over 30 min (or 3 hours)' },
  ATM: { standard: '1 g × 3 IV', high: '2 g × 4 IV', special: 'Severe P. aeruginosa: 2 g × 4 by extended 3-hour infusion' },
  CIP: { standard: '0.5 g × 2 oral or 0.4 g × 2 IV', high: '0.75 g × 2 oral or 0.4 g × 3 IV', special: 'Meningitis: 0.4 g × 3 IV' },
  LVX: { standard: '0.5 g × 1 oral or IV', high: '0.5 g × 2 oral or IV' },
  MFX: { standard: '0.4 g × 1 oral or IV', high: null, special: 'Meningitis: 0.4 g × 1 IV' },
  NOR: { standard: null, high: null, special: 'Uncomplicated UTI only: 0.4 g × 2 oral' },
  GEN: { standard: '6–7 mg/kg × 1 IV', high: null },
  AMK: { standard: '25–30 mg/kg × 1 IV', high: null },
  TOB: { standard: '6–7 mg/kg × 1 IV', high: null },
  SXT: { standard: '(0.16 g + 0.8 g) × 2 oral or IV', high: '(0.24 g + 1.2 g) × 2 oral or IV', special: 'Meningitis: (5 mg/kg up to 0.48 g + 25 mg/kg up to 2.4 g) × 3 IV' },
  NIT: { standard: null, high: null, special: 'Uncomplicated UTI only: 50–100 mg × 3–4 oral (depends on formulation)' },
  FOS: { standard: 'IV 16–18 g a day in 3–4 doses', high: 'Varies by indication', special: 'Oral (uncomplicated UTI): 3 g as a single dose' },
  COL: { standard: '4.5 MU × 2 IV with a 9 MU loading dose', high: null },
  TGC: { standard: '0.1 g loading dose, then 50 mg × 2 IV', high: null },
  TCY: { standard: '0.25 g × 4 oral', high: 'Varies by indication' },
  DOX: { standard: '0.1 g × 1 oral', high: 'Varies by indication' },
  MNO: { standard: '0.1 g × 2 oral', high: null },
  CHL: { standard: '1 g × 4 oral or IV', high: '2 g × 4 oral or IV', special: 'Meningitis: 2 g × 4 IV' },
  ERY: { standard: '0.5 g × 2–4 oral or IV', high: 'Varies by indication' },
  AZM: { standard: '0.5 g × 1 oral or IV', high: null },
  CLI: { standard: '0.3 g × 2 oral or 0.6 g × 3 IV', high: 'Varies by indication' },
  VAN: { standard: '0.5 g × 4 IV, 1 g × 2 IV or 2 g × 1 by continuous infusion', high: null, special: 'Based on body weight; therapeutic drug monitoring should guide dosing' },
  TEC: { standard: '0.4 g × 1 IV', high: 'Varies by indication' },
  LNZ: { standard: '0.6 g × 2 oral or IV', high: null, special: 'Meningitis: 0.6 g × 2 IV' },
  DAP: { standard: '4 mg/kg × 1 IV (cSSTI without S. aureus bacteraemia); 6 mg/kg × 1 IV with bacteraemia or right-sided endocarditis', high: null },
  RIF: { standard: '0.6 g × 1 oral or IV', high: null },
  FUS: { standard: '0.5 g × 2 oral or IV', high: 'Varies by indication' },
  MNZ: { standard: '0.4 g × 3 oral or IV', high: 'Varies by indication' },
}

/** One-line note for a reported result: what exposure the category assumes. */
export function eucastDoseNote(code, sir) {
  const d = EUCAST_DOSAGES[code]
  if (!d || !['S', 'I'].includes(sir)) return null
  if (sir === 'I') return d.high ? `Needs the high dosage: ${d.high}` : null
  return d.standard ? `Assumes the standard dosage: ${d.standard}` : null
}
