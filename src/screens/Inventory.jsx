import { useEffect, useState } from 'react';
import supabase from '../supabase';
import { useHospital } from '../context';
import { matchesDrugSearch } from '../utils/pharmacy';
import { broadcastWorkflowChanged } from '../utils/workflowEvents';
import { colors as C, typography } from '../theme';
import { notifyError, notifyWarning } from '../notifications'

const css = {
 page: { minHeight:'100vh', background:C.bg, fontFamily:typography.fontFamily, fontSize:'13px', color:C.text },
 wrap: { padding:'20px 24px', maxWidth:'1400px', margin:'0 auto' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' },
 h1: { fontSize:'18px', fontWeight:700, margin:0 },
 subtext: { fontSize:'12px', color:C.sub, marginBottom:'18px' },
 statsRow: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px', marginBottom:'20px' },
 stat: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px 16px' },
 statLbl: { fontSize:'11px', color:C.sub, fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px' },
 statVal: { fontSize:'22px', fontWeight:700 },
 statSub: { fontSize:'11px', marginTop:'2px' },
 toolbar: { display:'flex', gap:'10px', marginBottom:'16px', alignItems:'center' },
 searchWrap:{ position:'relative', flex:1 },
 searchIcon:{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:C.muted },
 searchInput:{ width:'100%', boxSizing:'border-box', padding:'8px 10px 8px 32px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', outline:'none', background:C.surface },
 select: { padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', background:C.surface, color:C.text, cursor:'pointer', outline:'none' },
 btn: { padding:'8px 16px', borderRadius:'7px', border:'none', cursor:'pointer', fontWeight:600, fontSize:'12px' },
 btnPri: { background:C.primary, color:'#fff' },
 btnGhost: { background:C.surface, border:`1px solid ${C.border}`, color:C.text },
 btnDng: { background:C.dangerL, color:C.danger, border:'none' },
 card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:'10px', overflow:'hidden' },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { padding:'9px 14px', textAlign:'left', fontSize:'11px', fontWeight:700, color:C.sub, textTransform:'uppercase', letterSpacing:'.5px', borderBottom:`2px solid ${C.border}`, background:'#FAFBFD', whiteSpace:'nowrap' },
 td: { padding:'10px 14px', borderBottom:`1px solid ${C.border}`, fontSize:'13px', verticalAlign:'middle' },
 badge: { display:'inline-block', padding:'2px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:600 },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center' },
 modal: { background:C.surface, borderRadius:'12px', padding:'24px', width:'760px', maxWidth:'95vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'90vh', overflowY:'auto' },
 modalH: { fontSize:'15px', fontWeight:700, marginBottom:'16px' },
 lbl: { fontSize:'11px', fontWeight:600, color:C.sub, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:'4px', display:'block' },
 input: { width:'100%', boxSizing:'border-box', padding:'8px 10px', border:`1px solid ${C.border}`, borderRadius:'7px', fontSize:'13px', color:C.text, outline:'none', background:C.surface, marginBottom:'10px' },
 row2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' },
 row3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' },
};

const CATEGORIES = ['All Categories','General','Analgesic','Antibiotic','Antibiotic IV','Antifungal','Antiviral','Endocrine','Cardiovascular','NSAID','Opioid Analgesic','Benzodiazepine','Barbiturate','Vasopressor','Antihistamine','Antacid','Other'];
const DOSAGE_FORMS = ['Tablet','Capsule','Syrup','Injection','IV Infusion','Cream','Drops','Inhaler','Suppository','Patch'];
const SUPPLIERS = ['MedSupply Ltd.','PharmaCare','HealthPlus Distributors','Global Pharma','Sterling Labs','Prime Meds'];
const LOCATIONS = ['Shelf A1','Shelf A2','Shelf B1','Shelf B2','Shelf C1','Shelf C2','Fridge 1','Fridge 2','Store 1','Store 2'];
const INVENTORY_PAGE_SIZE = 50;
const PHARMACY_DRUG_TEMPLATES = [
 { drug_name:'Amoxicillin 500mg', generic_name:'Amoxicillin', category:'Antibiotic', dosage_form:'Capsule', strength:'500mg' },
 { drug_name:'Augmentin 1g', generic_name:'Amoxicillin/Clavulanate', category:'Antibiotic', dosage_form:'Tablet', strength:'1g' },
 { drug_name:'Ceftriaxone 1g', generic_name:'Ceftriaxone', category:'Antibiotic IV', dosage_form:'Injection', strength:'1g' },
 { drug_name:'Ciprofloxacin 500mg', generic_name:'Ciprofloxacin', category:'Antibiotic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Azithromycin 500mg', generic_name:'Azithromycin', category:'Antibiotic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Metronidazole 400mg', generic_name:'Metronidazole', category:'Antibiotic', dosage_form:'Tablet', strength:'400mg' },
 { drug_name:'Flucloxacillin 500mg', generic_name:'Flucloxacillin', category:'Antibiotic', dosage_form:'Capsule', strength:'500mg' },
 { drug_name:'Doxycycline 100mg', generic_name:'Doxycycline', category:'Antibiotic', dosage_form:'Capsule', strength:'100mg' },
 { drug_name:'Gentamicin 80mg', generic_name:'Gentamicin', category:'Antibiotic IV', dosage_form:'Injection', strength:'80mg/2ml' },
 { drug_name:'Cefuroxime 500mg', generic_name:'Cefuroxime', category:'Antibiotic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Clindamycin 300mg', generic_name:'Clindamycin', category:'Antibiotic', dosage_form:'Capsule', strength:'300mg' },
 { drug_name:'Co-trimoxazole 160/800mg', generic_name:'Trimethoprim/Sulfamethoxazole', category:'Antibiotic', dosage_form:'Tablet', strength:'160/800mg' },
 { drug_name:'Nitrofurantoin 100mg', generic_name:'Nitrofurantoin', category:'Antibiotic', dosage_form:'Capsule', strength:'100mg' },
 { drug_name:'Erythromycin 500mg', generic_name:'Erythromycin', category:'Antibiotic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Levofloxacin 500mg', generic_name:'Levofloxacin', category:'Antibiotic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Moxifloxacin 400mg', generic_name:'Moxifloxacin', category:'Antibiotic', dosage_form:'Tablet', strength:'400mg' },
 { drug_name:'Ofloxacin 200mg', generic_name:'Ofloxacin', category:'Antibiotic', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Linezolid 600mg', generic_name:'Linezolid', category:'Antibiotic', dosage_form:'Tablet', strength:'600mg' },
 { drug_name:'Vancomycin 500mg', generic_name:'Vancomycin', category:'Antibiotic IV', dosage_form:'Injection', strength:'500mg' },
 { drug_name:'Meropenem 1g', generic_name:'Meropenem', category:'Antibiotic IV', dosage_form:'Injection', strength:'1g' },
 { drug_name:'Piperacillin/Tazobactam 4.5g', generic_name:'Piperacillin/Tazobactam', category:'Antibiotic IV', dosage_form:'Injection', strength:'4.5g' },
 { drug_name:'Imipenem/Cilastatin 500mg', generic_name:'Imipenem/Cilastatin', category:'Antibiotic IV', dosage_form:'Injection', strength:'500mg' },
 { drug_name:'Fluconazole 150mg', generic_name:'Fluconazole', category:'Antifungal', dosage_form:'Tablet', strength:'150mg' },
 { drug_name:'Ketoconazole 200mg', generic_name:'Ketoconazole', category:'Antifungal', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Nystatin 100000IU', generic_name:'Nystatin', category:'Antifungal', dosage_form:'Ointment', strength:'100000IU' },
 { drug_name:'Itraconazole 200mg', generic_name:'Itraconazole', category:'Antifungal', dosage_form:'Capsule', strength:'200mg' },
 { drug_name:'Voriconazole 200mg', generic_name:'Voriconazole', category:'Antifungal', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Oseltamivir 75mg', generic_name:'Oseltamivir', category:'Antiviral', dosage_form:'Capsule', strength:'75mg' },
 { drug_name:'Acyclovir 400mg', generic_name:'Acyclovir', category:'Antiviral', dosage_form:'Tablet', strength:'400mg' },
 { drug_name:'Valaciclovir 500mg', generic_name:'Valaciclovir', category:'Antiviral', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Paracetamol 500mg', generic_name:'Paracetamol', category:'Analgesic', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Ibuprofen 400mg', generic_name:'Ibuprofen', category:'NSAID', dosage_form:'Tablet', strength:'400mg' },
 { drug_name:'Diclofenac 50mg', generic_name:'Diclofenac', category:'NSAID', dosage_form:'Tablet', strength:'50mg' },
 { drug_name:'Naproxen 250mg', generic_name:'Naproxen', category:'NSAID', dosage_form:'Tablet', strength:'250mg' },
 { drug_name:'Ketorolac 10mg', generic_name:'Ketorolac', category:'NSAID', dosage_form:'Injection', strength:'10mg' },
 { drug_name:'Aspirin 75mg', generic_name:'Aspirin', category:'Antiplatelet', dosage_form:'Tablet', strength:'75mg' },
 { drug_name:'Tramadol 50mg', generic_name:'Tramadol', category:'Opioid Analgesic', dosage_form:'Tablet', strength:'50mg' },
 { drug_name:'Morphine 10mg', generic_name:'Morphine', category:'Opioid Analgesic', dosage_form:'Injection', strength:'10mg' },
 { drug_name:'Fentanyl 50mcg', generic_name:'Fentanyl', category:'Opioid Analgesic', dosage_form:'Patch', strength:'50mcg' },
 { drug_name:'Buprenorphine 0.4mg', generic_name:'Buprenorphine', category:'Opioid Analgesic', dosage_form:'Tablet', strength:'0.4mg' },
 { drug_name:'Oxycodone 10mg', generic_name:'Oxycodone', category:'Opioid Analgesic', dosage_form:'Tablet', strength:'10mg' },
 { drug_name:'Pregabalin 75mg', generic_name:'Pregabalin', category:'Neurological', dosage_form:'Capsule', strength:'75mg' },
 { drug_name:'Gabapentin 300mg', generic_name:'Gabapentin', category:'Neurological', dosage_form:'Capsule', strength:'300mg' },
 { drug_name:'Amitriptyline 25mg', generic_name:'Amitriptyline', category:'Psychiatric', dosage_form:'Tablet', strength:'25mg' },
 { drug_name:'Diazepam 5mg', generic_name:'Diazepam', category:'Benzodiazepine', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Lorazepam 1mg', generic_name:'Lorazepam', category:'Benzodiazepine', dosage_form:'Tablet', strength:'1mg' },
 { drug_name:'Midazolam 7.5mg', generic_name:'Midazolam', category:'Benzodiazepine', dosage_form:'Tablet', strength:'7.5mg' },
 { drug_name:'Alprazolam 0.5mg', generic_name:'Alprazolam', category:'Benzodiazepine', dosage_form:'Tablet', strength:'0.5mg' },
 { drug_name:'Haloperidol 5mg', generic_name:'Haloperidol', category:'Psychiatric', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Risperidone 2mg', generic_name:'Risperidone', category:'Psychiatric', dosage_form:'Tablet', strength:'2mg' },
 { drug_name:'Olanzapine 10mg', generic_name:'Olanzapine', category:'Psychiatric', dosage_form:'Tablet', strength:'10mg' },
 { drug_name:'Quetiapine 50mg', generic_name:'Quetiapine', category:'Psychiatric', dosage_form:'Tablet', strength:'50mg' },
 { drug_name:'Lithium Carbonate 300mg', generic_name:'Lithium Carbonate', category:'Psychiatric', dosage_form:'Tablet', strength:'300mg' },
 { drug_name:'Carbamazepine 200mg', generic_name:'Carbamazepine', category:'Neurological', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Phenytoin 100mg', generic_name:'Phenytoin', category:'Neurological', dosage_form:'Tablet', strength:'100mg' },
 { drug_name:'Valproate 200mg', generic_name:'Valproate', category:'Neurological', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Lamotrigine 100mg', generic_name:'Lamotrigine', category:'Neurological', dosage_form:'Tablet', strength:'100mg' },
 { drug_name:'Methyldopa 250mg', generic_name:'Methyldopa', category:'Cardiovascular', dosage_form:'Tablet', strength:'250mg' },
 { drug_name:'Enalapril 5mg', generic_name:'Enalapril', category:'Cardiovascular', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Lisinopril 10mg', generic_name:'Lisinopril', category:'Cardiovascular', dosage_form:'Tablet', strength:'10mg' },
 { drug_name:'Captopril 25mg', generic_name:'Captopril', category:'Cardiovascular', dosage_form:'Tablet', strength:'25mg' },
 { drug_name:'Amlodipine 5mg', generic_name:'Amlodipine', category:'Cardiovascular', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Nifedipine 20mg', generic_name:'Nifedipine', category:'Cardiovascular', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Atenolol 50mg', generic_name:'Atenolol', category:'Cardiovascular', dosage_form:'Tablet', strength:'50mg' },
 { drug_name:'Metoprolol 50mg', generic_name:'Metoprolol', category:'Cardiovascular', dosage_form:'Tablet', strength:'50mg' },
 { drug_name:'Propranolol 40mg', generic_name:'Propranolol', category:'Cardiovascular', dosage_form:'Tablet', strength:'40mg' },
 { drug_name:'Hydrochlorothiazide 25mg', generic_name:'Hydrochlorothiazide', category:'Cardiovascular', dosage_form:'Tablet', strength:'25mg' },
 { drug_name:'Furosemide 40mg', generic_name:'Furosemide', category:'Cardiovascular', dosage_form:'Tablet', strength:'40mg' },
 { drug_name:'Spironolactone 25mg', generic_name:'Spironolactone', category:'Cardiovascular', dosage_form:'Tablet', strength:'25mg' },
 { drug_name:'Simvastatin 20mg', generic_name:'Simvastatin', category:'Endocrine', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Atorvastatin 20mg', generic_name:'Atorvastatin', category:'Endocrine', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Rosuvastatin 10mg', generic_name:'Rosuvastatin', category:'Endocrine', dosage_form:'Tablet', strength:'10mg' },
 { drug_name:'GTN Spray 0.3mg', generic_name:'Glyceryl Trinitrate', category:'Cardiovascular', dosage_form:'Spray', strength:'0.3mg' },
 { drug_name:'Isosorbide Mononitrate 20mg', generic_name:'Isosorbide Mononitrate', category:'Cardiovascular', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Salbutamol Inhaler', generic_name:'Salbutamol', category:'Respiratory', dosage_form:'Inhaler', strength:'100mcg' },
 { drug_name:'Budesonide Inhaler', generic_name:'Budesonide', category:'Respiratory', dosage_form:'Inhaler', strength:'200mcg' },
 { drug_name:'Ipratropium Inhaler', generic_name:'Ipratropium', category:'Respiratory', dosage_form:'Inhaler', strength:'20mcg' },
 { drug_name:'Salmeterol 50mcg', generic_name:'Salmeterol', category:'Respiratory', dosage_form:'Inhaler', strength:'50mcg' },
 { drug_name:'Beclomethasone 100mcg', generic_name:'Beclomethasone', category:'Respiratory', dosage_form:'Inhaler', strength:'100mcg' },
 { drug_name:'Montelukast 10mg', generic_name:'Montelukast', category:'Respiratory', dosage_form:'Tablet', strength:'10mg' },
 { drug_name:'Prednisolone 5mg', generic_name:'Prednisolone', category:'Endocrine', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Hydrocortisone 100mg', generic_name:'Hydrocortisone', category:'Endocrine', dosage_form:'Injection', strength:'100mg' },
 { drug_name:'Dexamethasone 4mg', generic_name:'Dexamethasone', category:'Endocrine', dosage_form:'Tablet', strength:'4mg' },
 { drug_name:'Insulin Glargine 100IU', generic_name:'Insulin Glargine', category:'Endocrine', dosage_form:'Injection', strength:'100IU/ml' },
 { drug_name:'Insulin Lispro 100IU', generic_name:'Insulin Lispro', category:'Endocrine', dosage_form:'Injection', strength:'100IU/ml' },
 { drug_name:'Metformin 500mg', generic_name:'Metformin', category:'Endocrine', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Glibenclamide 5mg', generic_name:'Glibenclamide', category:'Endocrine', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Pioglitazone 15mg', generic_name:'Pioglitazone', category:'Endocrine', dosage_form:'Tablet', strength:'15mg' },
 { drug_name:'Sitagliptin 100mg', generic_name:'Sitagliptin', category:'Endocrine', dosage_form:'Tablet', strength:'100mg' },
 { drug_name:'Omeprazole 20mg', generic_name:'Omeprazole', category:'Other', dosage_form:'Capsule', strength:'20mg' },
 { drug_name:'Pantoprazole 40mg', generic_name:'Pantoprazole', category:'Other', dosage_form:'Tablet', strength:'40mg' },
 { drug_name:'Ranitidine 150mg', generic_name:'Ranitidine', category:'Other', dosage_form:'Tablet', strength:'150mg' },
 { drug_name:'Aluminium Hydroxide/Magnesium Hydroxide', generic_name:'Antacid', category:'Antacid', dosage_form:'Suspension', strength:''} ,
 { drug_name:'Loperamide 2mg', generic_name:'Loperamide', category:'Other', dosage_form:'Tablet', strength:'2mg' },
 { drug_name:'Simeticone 80mg', generic_name:'Simeticone', category:'Other', dosage_form:'Capsule', strength:'80mg' },
 { drug_name:'Lactulose 10g/15ml', generic_name:'Lactulose', category:'Other', dosage_form:'Syrup', strength:'10g/15ml' },
 { drug_name:'Atropine 0.6mg', generic_name:'Atropine', category:'Other', dosage_form:'Injection', strength:'0.6mg' },
 { drug_name:'Hyoscine Butylbromide 20mg', generic_name:'Hyoscine Butylbromide', category:'Other', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Amiodarone 200mg', generic_name:'Amiodarone', category:'Cardiovascular', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Digoxin 0.25mg', generic_name:'Digoxin', category:'Cardiovascular', dosage_form:'Tablet', strength:'0.25mg' },
 { drug_name:'Clopidogrel 75mg', generic_name:'Clopidogrel', category:'Cardiovascular', dosage_form:'Tablet', strength:'75mg' },
 { drug_name:'Warfarin 5mg', generic_name:'Warfarin', category:'Cardiovascular', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Enoxaparin 40mg', generic_name:'Enoxaparin', category:'Anticoagulant', dosage_form:'Injection', strength:'40mg/0.4ml' },
 { drug_name:'Heparin 5000IU', generic_name:'Heparin', category:'Anticoagulant', dosage_form:'Injection', strength:'5000IU/ml' },
 { drug_name:'Calcium Carbonate 500mg', generic_name:'Calcium Carbonate', category:'Other', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Ferrous Sulphate 200mg', generic_name:'Ferrous Sulphate', category:'Other', dosage_form:'Tablet', strength:'200mg' },
 { drug_name:'Folic Acid 5mg', generic_name:'Folic Acid', category:'Other', dosage_form:'Tablet', strength:'5mg' },
 { drug_name:'Vitamin B Complex', generic_name:'Vitamin B Complex', category:'Other', dosage_form:'Tablet', strength:'' },
 { drug_name:'Zinc Sulphate 20mg', generic_name:'Zinc Sulphate', category:'Other', dosage_form:'Tablet', strength:'20mg' },
 { drug_name:'Vitamin C 500mg', generic_name:'Ascorbic Acid', category:'Other', dosage_form:'Tablet', strength:'500mg' },
 { drug_name:'Multivitamin Tablet', generic_name:'Multivitamin', category:'Other', dosage_form:'Tablet', strength:'' },
];

function Badge({ color, label }) {
 const p = {
 green: { bg:C.successL, color:C.success },
 red: { bg:C.dangerL, color:C.danger },
 yellow: { bg:C.warnL, color:C.warn },
 purple: { bg:C.purpleL, color:C.purple },
 gray: { bg:'#F3F4F6', color:C.sub },
 blue: { bg:'#EFF6FF', color:'#2563EB' },
 }[color] || { bg:'#F3F4F6', color:C.sub };
 return <span style={{...css.badge, background:p.bg, color:p.color}}>{label}</span>;
}

function getStatus(item) {
 const qty = item.quantity_in_stock ?? 0;
 const reorder = item.minimum_stock_level ?? item.reorder_level ?? 10;
 if (qty === 0) return { label:'Out of Stock', color:'red' };
 if (qty <= reorder) return { label:'Low Stock', color:'yellow' };
 return { label:'In Stock', color:'green' };
}

function getPackSize(item) {
 return Math.max(parseInt(item?.pack_size, 10) || 1, 1);
}

function getStockWholes(item) {
 if (item?.stock_wholes != null) return Math.max(Number(item.stock_wholes) || 0, 0);
 return Math.floor(Math.max(Number(item?.quantity_in_stock) || 0, 0) / getPackSize(item));
}

function getStockPieces(item) {
 if (item?.stock_pieces != null) return Math.max(Number(item.stock_pieces) || 0, 0);
 return Math.max(Number(item?.quantity_in_stock) || 0, 0) % getPackSize(item);
}

function formatCurrency(value) {
 return `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function getSuggestedOrder(item) {
 const qty = Number(item.quantity_in_stock || 0);
 const dailyUsage = Number(item.average_daily_usage || 0);
 const leadDays = Number(item.reorder_lead_days || 0);
 const safetyStock = Number(item.safety_stock || 0);
 const target = Number(item.maximum_stock_level || 0) || Math.max(Number(item.minimum_stock_level || item.reorder_level || 0) * 3, safetyStock + dailyUsage * leadDays);
 return Math.max(0, Math.ceil(target - qty));
}

function DrugModal({ drug, onClose, onSave }) {
 const editing = !!drug?.id;
 const existingPackSize = Math.max(parseInt(drug?.pack_size, 10) || 1, 1);
 const [form, setForm] = useState({
 drug_name: drug?.drug_name || '',
 generic_name: drug?.generic_name || '',
 category: drug?.category || '',
 dosage_form: drug?.dosage_form || '',
 strength: drug?.strength || '',
 unit_cost: drug?.unit_cost || '',
 selling_price: drug?.selling_price || '',
 stock_wholes: drug ? (drug.stock_wholes ?? Math.floor(Number(drug.quantity_in_stock || 0) / existingPackSize)) : '',
 stock_pieces: drug ? (drug.stock_pieces ?? (Number(drug.quantity_in_stock || 0) % existingPackSize)) : '',
 pack_size: drug?.pack_size || 1,
 price_kes: drug?.price_kes ?? (Number(drug?.selling_price || 0) * existingPackSize) ?? '',
 piece_price_kes: drug?.piece_price_kes ?? drug?.selling_price ?? '',
 cost_price_kes: drug?.cost_price_kes ?? (Number(drug?.unit_cost || 0) * existingPackSize) ?? '',
 image_url: drug?.image_url || '',
 image_source: drug?.image_source || '',
 reorder_level: drug?.reorder_level || 10,
 minimum_stock_level: drug?.minimum_stock_level ?? drug?.reorder_level ?? 10,
 maximum_stock_level: drug?.maximum_stock_level || '',
 reorder_lead_days: drug?.reorder_lead_days ?? 7,
 average_daily_usage: drug?.average_daily_usage ?? 0,
 safety_stock: drug?.safety_stock ?? 0,
 item_code: drug?.item_code || '',
 barcode: drug?.barcode || '',
 controlled_drug: Boolean(drug?.controlled_drug),
 requires_cold_chain: Boolean(drug?.requires_cold_chain),
 supplier: drug?.supplier || '',
 location: drug?.location || '',
 });
 const [imageUploading, setImageUploading] = useState(false);
 const [imageSuggestions, setImageSuggestions] = useState([]);
 const set = k => e => setForm(f => ({...f, [k]: e.target.value}));

 useEffect(() => {
 const query = String(form.generic_name || form.drug_name || '').trim();
 if (query.length < 2) {
 setImageSuggestions([]);
 return undefined;
 }
 let active = true;
 const timer = window.setTimeout(async () => {
 const { data } = await supabase.from('drug_image_library').select('id,generic_name,brand_hint,image_url').ilike('generic_name', `%${query}%`).limit(8);
 if (active) setImageSuggestions(data || []);
 }, 250);
 return () => {
 active = false;
 window.clearTimeout(timer);
 };
 }, [form.generic_name, form.drug_name]);

 const uploadImage = async event => {
 const file = event.target.files?.[0];
 if (!file) return;
 setImageUploading(true);
 try {
 const image = await createImageBitmap(file);
 const scale = Math.min(1, 240 / Math.max(image.width, image.height));
 const canvas = document.createElement('canvas');
 canvas.width = Math.max(1, Math.round(image.width * scale));
 canvas.height = Math.max(1, Math.round(image.height * scale));
 canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
 const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
 if (!blob) throw new Error('Unable to process this image.');
 const fileName = `hmis-${globalThis.crypto?.randomUUID?.() || Date.now()}.webp`;
 const { error } = await supabase.storage.from('drug-images').upload(fileName, blob, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
 if (error) throw error;
 const { data } = supabase.storage.from('drug-images').getPublicUrl(fileName);
 setForm(current => ({ ...current, image_url: data.publicUrl, image_source: 'uploaded' }));
 } catch (error) {
 notifyError(`Image upload failed: ${error.message || 'Unable to upload image.'}`);
 } finally {
 setImageUploading(false);
 event.target.value = '';
 }
 };

 const packMargin = Number(form.price_kes || 0) - Number(form.cost_price_kes || 0);
 const pieceCost = Number(form.cost_price_kes || 0) / Math.max(Number(form.pack_size) || 1, 1);
 const pieceMargin = Number(form.piece_price_kes || 0) - pieceCost;

 return (
 <div style={css.overlay}>
 <div style={css.modal}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
 <div style={css.modalH}>{editing ? ' Edit Drug' : ' Add New Drug'}</div>
 <button style={{...css.btn,...css.btnGhost,padding:'5px 10px'}} onClick={onClose} aria-label="Close" title="Close">✕</button>
 </div>

 <label style={css.lbl}>Drug Name *</label>
 <input style={css.input} placeholder="e.g. Amoxicillin 500mg" value={form.drug_name} onChange={set('drug_name')} />

 <label style={css.lbl}>Generic Name</label>
 <input style={css.input} placeholder="e.g. Amoxicillin" value={form.generic_name} onChange={set('generic_name')} />

 <div style={css.row2}>
 <div><label style={css.lbl}>Item Code</label><input style={css.input} placeholder="Hospital formulary code" value={form.item_code} onChange={set('item_code')} /></div>
 <div><label style={css.lbl}>Barcode</label><input style={css.input} placeholder="Scan or enter barcode" value={form.barcode} onChange={set('barcode')} /></div>
 </div>

 <div style={css.row2}>
 <div>
 <label style={css.lbl}>Category</label>
 <select style={{...css.input,cursor:'pointer'}} value={form.category} onChange={set('category')}>
 <option value="">Select...</option>
 {CATEGORIES.filter(c=>c!=='All Categories').map(c=><option key={c}>{c}</option>)}
 </select>
 </div>
 <div>
 <label style={css.lbl}>Dosage Form</label>
 <select style={{...css.input,cursor:'pointer'}} value={form.dosage_form} onChange={set('dosage_form')}>
 <option value="">Select...</option>
 {DOSAGE_FORMS.map(d=><option key={d}>{d}</option>)}
 </select>
 </div>
 </div>

 <div style={css.row3}>
 <div><label style={css.lbl}>Minimum Stock</label><input style={css.input} type="number" min="0" value={form.minimum_stock_level} onChange={set('minimum_stock_level')} /></div>
 <div><label style={css.lbl}>Maximum Stock</label><input style={css.input} type="number" min="0" value={form.maximum_stock_level} onChange={set('maximum_stock_level')} /></div>
 <div><label style={css.lbl}>Lead Time (days)</label><input style={css.input} type="number" min="0" value={form.reorder_lead_days} onChange={set('reorder_lead_days')} /></div>
 </div>
 <div style={css.row2}>
 <div><label style={css.lbl}>Average Daily Use</label><input style={css.input} type="number" min="0" step="0.001" value={form.average_daily_usage} onChange={set('average_daily_usage')} /></div>
 <div><label style={css.lbl}>Safety Stock</label><input style={css.input} type="number" min="0" step="0.001" value={form.safety_stock} onChange={set('safety_stock')} /></div>
 </div>
 <div style={{display:'flex',gap:'18px',marginBottom:'12px',fontSize:'12px',color:C.text}}>
 <label><input type="checkbox" checked={form.controlled_drug} onChange={e=>setForm(f=>({...f,controlled_drug:e.target.checked}))} /> Controlled medicine</label>
 <label><input type="checkbox" checked={form.requires_cold_chain} onChange={e=>setForm(f=>({...f,requires_cold_chain:e.target.checked}))} /> Cold chain</label>
 </div>

 <div style={css.row2}>
 <div>
 <label style={css.lbl}>Strength</label>
 <input style={css.input} placeholder="e.g. 500mg" value={form.strength} onChange={set('strength')} />
 </div>
 <div>
 <label style={css.lbl}>Location / Shelf</label>
 <input style={css.input} placeholder="e.g. Shelf A3" value={form.location} onChange={set('location')} />
 </div>
 </div>

 <div style={css.row3}>
 <div><label style={css.lbl}>Whole Packs in Stock *</label><input style={css.input} type="number" min="0" step="1" placeholder="0" value={form.stock_wholes} onChange={set('stock_wholes')} /></div>
 <div><label style={css.lbl}>Loose Pieces in Stock</label><input style={css.input} type="number" min="0" step="0.001" placeholder="0" value={form.stock_pieces} onChange={set('stock_pieces')} /></div>
 <div><label style={css.lbl}>Pieces per Pack</label><input style={css.input} type="number" min="1" step="1" value={form.pack_size} onChange={set('pack_size')} /></div>
 </div>

 <div style={css.row3}>
 <div>
 <label style={css.lbl}>Reorder Level</label>
 <input style={css.input} type="number" placeholder="10" value={form.reorder_level} onChange={set('reorder_level')} />
 </div>
 <div>
 <label style={css.lbl}>Supplier</label>
 <input style={css.input} placeholder="Supplier" value={form.supplier} onChange={set('supplier')} />
 </div>
 </div>

 <div style={css.row3}>
 <div><label style={css.lbl}>Whole-Pack Selling Price (KES) *</label><input style={css.input} type="number" min="0" step="0.01" value={form.price_kes} onChange={set('price_kes')} /></div>
 <div><label style={css.lbl}>Piece Selling Price (KES) *</label><input style={css.input} type="number" min="0" step="0.01" value={form.piece_price_kes} onChange={set('piece_price_kes')} /></div>
 <div><label style={css.lbl}>Whole-Pack Cost (KES)</label><input style={css.input} type="number" min="0" step="0.01" value={form.cost_price_kes} onChange={set('cost_price_kes')} /></div>
 </div>

 <div style={{background:C.primaryL,borderRadius:'7px',padding:'9px 12px',fontSize:'12px',color:C.primary,marginBottom:'12px',fontWeight:600}}>
 Whole-pack margin: {formatCurrency(packMargin)} ({Number(form.price_kes) > 0 ? `${((packMargin / Number(form.price_kes)) * 100).toFixed(1)}%` : '0%'})
 {' · '}Piece margin: {formatCurrency(pieceMargin)} ({Number(form.piece_price_kes) > 0 ? `${((pieceMargin / Number(form.piece_price_kes)) * 100).toFixed(1)}%` : '0%'})
 </div>

 <label style={css.lbl}>Drug Pack Photo</label>
 <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
 {form.image_url ? <img src={form.image_url} alt={`${form.drug_name || 'Drug'} pack`} style={{width:64,height:64,objectFit:'contain',border:`1px solid ${C.border}`,borderRadius:7,background:'#fff'}} /> : <div style={{width:64,height:64,display:'grid',placeItems:'center',border:`1px dashed ${C.border}`,borderRadius:7,color:C.muted,fontSize:11}}>No photo</div>}
 <label style={{...css.btn,...css.btnGhost,display:'inline-flex',alignItems:'center',cursor:'pointer'}}>{imageUploading ? 'Uploading...' : 'Upload photo'}<input type="file" accept="image/*" onChange={uploadImage} disabled={imageUploading} style={{display:'none'}} /></label>
 {form.image_url && <button type="button" style={{...css.btn,...css.btnGhost}} onClick={() => setForm(current => ({...current,image_url:'',image_source:''}))}>Remove photo</button>}
 </div>
 {imageSuggestions.length > 0 && <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:12}}><span style={{fontSize:11,color:C.sub}}>Library matches:</span>{imageSuggestions.map(image => <button type="button" key={image.id} title={`${image.generic_name}${image.brand_hint ? ` · ${image.brand_hint}` : ''}`} onClick={() => setForm(current => ({...current,image_url:image.image_url,image_source:'library'}))} style={{padding:3,border:`1px solid ${C.border}`,borderRadius:6,background:'#fff',cursor:'pointer'}}><img src={image.image_url} alt={image.generic_name} style={{width:40,height:40,objectFit:'contain'}} /></button>)}</div>}

 <div style={{display:'flex',gap:'8px',marginTop:'4px'}}>
 <button style={{...css.btn,...css.btnGhost,flex:1,padding:'10px'}} onClick={onClose}>Cancel</button>
 <button style={{...css.btn,...css.btnPri,flex:2,padding:'10px'}} onClick={() => onSave(form, drug?.id)}>
 {editing ? 'Save Changes' : 'Add to Inventory'}
 </button>
 </div>
 </div>
 </div>
 );
}

export default function DrugInventory() {
 const { hospitalId, userRole } = useHospital();
 const isAdmin = ['Admin','admin'].includes(userRole || '')
 const [inventory, setInventory] = useState([]);
 const [inventoryTotal, setInventoryTotal] = useState(0);
 const [inventoryPage, setInventoryPage] = useState(1);
 const [recentSales, setRecentSales] = useState([]);
 const [recentMovements, setRecentMovements] = useState([]);
 const [search, setSearch] = useState('');
 const [category, setCategory] = useState('All Categories');
 const [statusFilter, setStatusFilter] = useState('all');
 const [showModal, setShowModal] = useState(false);
 const [editDrug, setEditDrug] = useState(null);
 const [loading, setLoading] = useState(false);
 const [seeding, setSeeding] = useState(false);

 useEffect(() => {
 if (!hospitalId) return;
 loadInventory();
 loadRecentSales();
 loadRecentMovements();
 }, [hospitalId]);

 useEffect(() => {
 const refresh = () => {
  if (!hospitalId) return;
  loadInventory();
  loadRecentSales();
  loadRecentMovements();
 }
 window.addEventListener('remedacare:workflow_changed', refresh)
 window.addEventListener('remedacare:prescriptions_changed', refresh)
 return () => {
  window.removeEventListener('remedacare:workflow_changed', refresh)
  window.removeEventListener('remedacare:prescriptions_changed', refresh)
 }
 }, [hospitalId]);

 const loadInventory = async () => {
 if (!hospitalId) return;
 const from = (inventoryPage - 1) * INVENTORY_PAGE_SIZE;
 let query = supabase
 .from('pharmacy_inventory')
 .select('*')
 .eq('hospital_id', hospitalId) // ✅ scoped to this hospital only
 .eq('is_active', true)
 .order('drug_name');
 if (!error) setInventory(data || []);
 };

 const loadRecentSales = async () => {
 if (!hospitalId) return;
 const { data, error } = await supabase
 .from('sales_ledger')
 .select('id,receipt_number,customer_name,drug_name,qty_sold,total_kes,payment_method,sold_at')
 .eq('hospital_id', hospitalId)
 .order('sold_at', { ascending: false })
 .limit(36);
 if (!error) setRecentSales(data || []);
 };

 const loadRecentMovements = async () => {
 if (!hospitalId) return;
 const { data, error } = await supabase
 .from('pharmacy_stock_movements')
 .select('id,inventory_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,performed_by,created_at')
 .eq('hospital_id', hospitalId)
 .order('created_at', { ascending: false })
 .limit(12);
 if (!error) setRecentMovements(data || []);
 };

 const seedPharmacyInventory = async () => {
 if (!hospitalId) return;
 const existingNames = new Set(inventory.map(i => (i.drug_name || '').toLowerCase()));
 const payload = PHARMACY_DRUG_TEMPLATES
 .filter((item) => !existingNames.has((item.drug_name || '').toLowerCase()))
 .map((item, index) => {
 const unit_cost = 50 + (index % 25) * 18;
 const selling_price = Math.max(unit_cost + 40, Math.round(unit_cost * 1.35));
 const quantity_in_stock = 5 + ((index * 7) % 120);
 const reorder_level = 8 + ((index * 3) % 18);
 return {
 hospital_id: hospitalId,
 drug_name: item.drug_name,
 generic_name: item.generic_name || null,
 category: item.category || null,
 dosage_form: item.dosage_form || null,
 strength: item.strength || null,
 unit_cost,
 selling_price,
 quantity_in_stock,
 stock_wholes: quantity_in_stock,
 stock_pieces: 0,
 pack_size: 1,
 price_kes: selling_price,
 piece_price_kes: selling_price,
 cost_price_kes: unit_cost,
 reorder_level,
 supplier: SUPPLIERS[index % SUPPLIERS.length],
 location: LOCATIONS[index % LOCATIONS.length],
 is_active: true,
 };
 });
 if (payload.length === 0) {
 notifyWarning('Sample pharmacy inventory has already been added.');
 return;
 }
 setSeeding(true);
 const { error } = await supabase.from('pharmacy_inventory').insert(payload);
 setSeeding(false);
 if (error) {
 notifyError('Error seeding pharmacy inventory: ' + error.message);
 return;
 }
 loadInventory();
 broadcastWorkflowChanged({ source: 'inventory-seed', count: payload.length })
 };

 // ── Derived stats ──
 const lowStock = inventory.filter(i => (i.quantity_in_stock??0) <= (i.minimum_stock_level ?? i.reorder_level ?? 10) && (i.quantity_in_stock??0) > 0);
 const outOfStock = inventory.filter(i => (i.quantity_in_stock??0) === 0);
 const controlledItems = inventory.filter(i => i.controlled_drug);
 const coldChainItems = inventory.filter(i => i.requires_cold_chain);
 const reorderValue = inventory.reduce((sum, item) => sum + getSuggestedOrder(item) * Number(item.unit_cost || 0), 0);

 // ── Filtered list ──
 const filtered = inventory.filter(item => {
 const q = search.trim()
 const matchSearch = !q
  || matchesDrugSearch(q, item)
  || item.supplier?.toLowerCase().includes(q.toLowerCase())
  || item.location?.toLowerCase().includes(q.toLowerCase());
 const matchCat = category === 'All Categories' || item.category === category;
 const status = getStatus(item);
 const matchStatus = statusFilter === 'all'
  || status.label.toLowerCase().replace(' ','_') === statusFilter
  || (statusFilter === 'controlled' && item.controlled_drug)
  || (statusFilter === 'cold_chain' && item.requires_cold_chain);
 return matchSearch && matchCat && matchStatus;
 });

 const recentReceipts = Object.values(recentSales.reduce((acc, row) => {
 const key = row.receipt_number || row.id
 if (!acc[key]) {
  acc[key] = {
   receipt_number: row.receipt_number || '—',
   customer_name: row.customer_name || 'Walk-in',
   payment_method: row.payment_method || 'Cash',
   total_kes: 0,
   sold_at: row.sold_at || null,
   lines: 0,
  }
 }
 acc[key].total_kes += Number(row.total_kes || 0)
 acc[key].lines += 1
 if (!acc[key].sold_at || new Date(row.sold_at || 0) > new Date(acc[key].sold_at || 0)) {
  acc[key].sold_at = row.sold_at || acc[key].sold_at
 }
 return acc
 }, {}))
 .sort((a, b) => new Date(b.sold_at || 0) - new Date(a.sold_at || 0))
 .slice(0, 6);

 // ── Save drug (add or edit) ──
 const handleSave = async (form, id) => {
 if (!form.drug_name.trim()) return notifyWarning('Enter the drug name.');

 const packSize = Math.max(parseInt(form.pack_size, 10) || 1, 1);
 const stockWholes = Math.max(parseInt(form.stock_wholes, 10) || 0, 0);
 const stockPieces = Math.max(Number(form.stock_pieces) || 0, 0);
 const normalizedWholes = stockWholes + Math.floor(stockPieces / packSize);
 const normalizedPieces = Number((stockPieces % packSize).toFixed(3));
 const wholePrice = Number(form.price_kes);
 const piecePrice = Number(form.piece_price_kes);
 const wholeCost = Number(form.cost_price_kes) || 0;
 if (!Number.isFinite(wholePrice) || wholePrice <= 0 || !Number.isFinite(piecePrice) || piecePrice <= 0)
 return notifyWarning('Enter both a whole-pack price and a piece price greater than zero.');

 setLoading(true);
 const payload = {
 hospital_id: hospitalId, // ✅ always scoped
 drug_name: form.drug_name,
 generic_name: form.generic_name || null,
 category: form.category || null,
 dosage_form: form.dosage_form || null,
 strength: form.strength || null,
 unit_cost: wholeCost / packSize,
 selling_price: piecePrice,
 quantity_in_stock: (normalizedWholes * packSize) + normalizedPieces,
 stock_wholes: normalizedWholes,
 stock_pieces: normalizedPieces,
 pack_size: packSize,
 price_kes: wholePrice,
 piece_price_kes: piecePrice,
 cost_price_kes: wholeCost || null,
 image_url: form.image_url || null,
 image_source: form.image_url ? (form.image_source || 'uploaded') : null,
 reorder_level: Number(form.reorder_level) || 10,
 minimum_stock_level: Number(form.minimum_stock_level) || Number(form.reorder_level) || 10,
 maximum_stock_level: Number(form.maximum_stock_level) || null,
 reorder_lead_days: Number(form.reorder_lead_days) || 0,
 average_daily_usage: Number(form.average_daily_usage) || 0,
 safety_stock: Number(form.safety_stock) || 0,
 item_code: form.item_code.trim() || null,
 barcode: form.barcode.trim() || null,
 controlled_drug: Boolean(form.controlled_drug),
 requires_cold_chain: Boolean(form.requires_cold_chain),
 active: true,
 supplier: form.supplier || null,
 location: form.location || null,
 is_active: true,
 };

 const { error } = id
 ? await supabase.from('pharmacy_inventory').update(payload).eq('id', id).eq('hospital_id', hospitalId)
 : await supabase.from('pharmacy_inventory').insert(payload);

 if (error) { notifyError('Error: ' + error.message); }
 else {
 setShowModal(false);
 setEditDrug(null);
 loadInventory();
 broadcastWorkflowChanged({ source: id ? 'inventory-update' : 'inventory-create', drug_name: form.drug_name })
 }
 setLoading(false);
 };

 // ── Deactivate (soft delete) ──
 const handleDeactivate = async (id) => {
 if (!isAdmin) {
 notifyWarning('Only Admin users can remove drugs from inventory.')
 return
 }
 if (!await window.openConfirmDialog('Remove this drug from inventory?')) return;
 await supabase.from('pharmacy_inventory')
 .update({ is_active: false })
 .eq('id', id)
 .eq('hospital_id', hospitalId); // ✅ scoped
 loadInventory();
 broadcastWorkflowChanged({ source: 'inventory-remove', id })
 };

 // ── Export CSV ──
 const exportCSV = () => {
 const headers = ['Drug Name','Generic','Category','Form','Strength','Whole Packs','Loose Pieces','Pack Size','Total Pieces','Whole-Pack Price','Piece Price','Whole-Pack Cost','Gross Margin','Reorder Level','Supplier','Location','Status','Photo'];
 const rows = inventory.map(i => [
 i.drug_name, i.generic_name||'', i.category||'', i.dosage_form||'', i.strength||'',
 getStockWholes(i), getStockPieces(i), getPackSize(i), i.quantity_in_stock,
 i.price_kes ?? Number(i.selling_price || 0) * getPackSize(i), i.piece_price_kes ?? i.selling_price,
 i.cost_price_kes ?? Number(i.unit_cost || 0) * getPackSize(i),
 i.cost_price_kes != null ? `${(((Number(i.price_kes || 0) - Number(i.cost_price_kes || 0)) / Math.max(Number(i.price_kes || 0), 1)) * 100).toFixed(1)}%` : '',
 i.reorder_level||10, i.supplier||'', i.location||'', getStatus(i).label, i.image_url||''
 ]);
 const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
 const a = document.createElement('a');
 a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
 a.download = `drug_inventory_${new Date().toISOString().slice(0,10)}.csv`;
 a.click();
 };

 return (
 <div style={css.page}>
 <div style={css.wrap}>

 {/* Header */}
 <div style={css.header}>
 <div>
 <h1 style={css.h1}>Drug Inventory</h1>
 </div>
 <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
 <button style={{...css.btn,...css.btnGhost}} onClick={exportCSV} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}> Export CSV</button>
 <button style={{...css.btn,...css.btnGhost}} onClick={seedPharmacyInventory} disabled={!isAdmin || seeding} title={!isAdmin ? 'Admin only' : ''}>{seeding ? 'Seeding...' : '+ Seed 120 Drugs'}</button>
 <button style={{...css.btn,...css.btnPri}} onClick={()=>{setEditDrug(null);setShowModal(true);}}>+ Add Drug</button>
 </div>
 </div>
 <div style={css.subtext}>
 {inventory.length} drugs · {lowStock.length} low stock · {outOfStock.length} out of stock
 </div>

 {/* Stats */}
 <div style={css.statsRow}>
 {[
 { lbl:'Total Drugs', val:inventory.length, sub:'in formulary', color:C.text },
 { lbl:'Low Stock', val:lowStock.length, sub:'need reorder', color:C.warn },
 { lbl:'Out of Stock', val:outOfStock.length, sub:'unavailable', color:C.danger },
 { lbl:'Reorder Value', val:`KES ${Math.round(reorderValue).toLocaleString()}`, sub:'suggested replenishment', color:C.purple },
 ].map(({lbl,val,sub,color})=>(
 <div key={lbl} style={css.stat}>
 <div style={css.statLbl}>{lbl}</div>
 <div style={{...css.statVal,color}}>{val}</div>
 <div style={{...css.statSub,color}}>{sub}</div>
 </div>
 ))}
 </div>

 {/* Toolbar */}
 <div style={css.toolbar}>
 <div style={css.searchWrap}>
 <span style={css.searchIcon}></span>
 <input style={css.searchInput} placeholder="Search by drug name, generic, abbreviation, supplier..." value={search} onChange={e=>setSearch(e.target.value)} />
 </div>
 <select style={css.select} value={category} onChange={e=>setCategory(e.target.value)}>
 {CATEGORIES.map(c=><option key={c}>{c}</option>)}
 </select>
 <select style={css.select} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
 <option value="all">All Status</option>
 <option value="in_stock">In Stock</option>
 <option value="low_stock">Low Stock</option>
 <option value="out_of_stock">Out of Stock</option>
 <option value="controlled">Controlled Medicines</option>
 <option value="cold_chain">Cold Chain</option>
 </select>
 </div>

 {/* Table */}
 <div style={css.card}>
 <div style={{overflowX:'auto'}}>
 <table style={css.table}>
 <thead>
 <tr>
 {['Photo','Drug Name','Category','Safety','Stock','Pack','W Price','P Price','Margin','Suggested Order','Supplier','Location','Status',''].map(h=>(
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {filtered.length===0 && (
 <tr><td colSpan={14} style={{...css.td,textAlign:'center',color:C.muted,padding:'40px'}}>No drugs found</td></tr>
 )}
 {filtered.map(item => {
 const status = getStatus(item);
 return (
 <tr key={item.id}
 onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'}
 onMouseLeave={e=>e.currentTarget.style.background=''}
 >
 <td style={css.td}>{item.image_url ? <img src={item.image_url} alt={`${item.drug_name} pack`} style={{width:40,height:40,objectFit:'contain',borderRadius:5,background:'#fff'}} /> : <div style={{width:40,height:40,display:'grid',placeItems:'center',border:`1px dashed ${C.border}`,borderRadius:5,color:C.muted,fontSize:9}}>No photo</div>}</td>
 <td style={css.td}>
 <div style={{fontWeight:600,fontSize:'13px'}}>{item.drug_name}</div>
 {item.generic_name && <div style={{fontSize:'11px',color:C.muted}}>{item.generic_name}</div>}
 {item.strength && <div style={{fontSize:'11px',color:C.sub}}>{item.strength}</div>}
 </td>
 <td style={css.td}>{item.category ? <Badge color="blue" label={item.category}/> : '—'}</td>
 <td style={css.td}>
 {item.dosage_form ? <Badge color="gray" label={item.dosage_form}/> : '—'}
 <div style={{display:'flex',gap:'4px',marginTop:'5px',flexWrap:'wrap'}}>
 {item.controlled_drug && <Badge color="red" label="Controlled"/>}
 {item.requires_cold_chain && <Badge color="blue" label="Cold chain"/>}
 </div>
 </td>
 <td style={css.td}>
 <span style={{fontWeight:700,color: (item.quantity_in_stock??0)===0 ? C.danger : (item.quantity_in_stock??0)<=(item.reorder_level??10) ? C.warn : C.text}}>{getStockWholes(item)}W {getStockPieces(item)}P</span>
 <div style={{fontSize:'11px',color:C.sub}}>{Number(item.quantity_in_stock ?? 0)} pieces total</div>
 </td>
 <td style={css.td}>{getPackSize(item)} pcs</td>
 <td style={css.td}>{formatCurrency(item.price_kes ?? Number(item.selling_price || 0) * getPackSize(item))}</td>
 <td style={css.td}>{formatCurrency(item.piece_price_kes ?? item.selling_price)}</td>
 <td style={css.td}>
 {item.cost_price_kes != null ? <><strong>{formatCurrency(Number(item.price_kes || 0) - Number(item.cost_price_kes || 0))}</strong><div style={{fontSize:11,color:C.sub}}>{Number(item.price_kes || 0) > 0 ? `${(((Number(item.price_kes || 0) - Number(item.cost_price_kes || 0)) / Number(item.price_kes || 0)) * 100).toFixed(1)}% gross margin` : '—'}</div></> : '—'}
 </td>
 <td style={{...css.td,color:C.sub}}>
 <div>Min {item.minimum_stock_level ?? item.reorder_level ?? 10}</div>
 <div style={{fontSize:'11px',marginTop:'4px',color:getSuggestedOrder(item)>0?C.warn:C.success}}>Order {getSuggestedOrder(item)}</div>
 </td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{item.supplier||'—'}</td>
 <td style={{...css.td,fontSize:'12px',color:C.sub}}>{item.location||'—'}</td>
 <td style={css.td}><Badge color={status.color} label={status.label}/></td>
 <td style={css.td}>
 <div style={{display:'flex',gap:'6px'}}>
 <button style={{...css.btn,background:'#EFF6FF',color:'#2563EB',padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>{setEditDrug(item);setShowModal(true);}}>Edit</button>
 <button style={{...css.btn,...css.btnDng,padding:'5px 10px',fontSize:'11px'}}
 onClick={()=>handleDeactivate(item.id)} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Remove</button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>

 <div style={{...css.card, marginTop:'16px'}}>
 <div style={{padding:'12px 16px', borderBottom:`1px solid ${C.border}`, background:'#FAFBFD', fontSize:'13px', fontWeight:700}}>
 Recent Stock Movements
 </div>
 <div style={{overflowX:'auto'}}>
 <table style={css.table}>
 <thead><tr>{['Medicine','Movement','Change','Before','After','Reason','By','Time'].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
 <tbody>
 {recentMovements.length === 0 && <tr><td colSpan={8} style={{...css.td,textAlign:'center',color:C.muted,padding:'26px'}}>Apply the pharmacy inventory upgrade migration to start recording stock movements.</td></tr>}
 {recentMovements.map(movement => {
 const drug = inventory.find(item => String(item.id) === String(movement.inventory_id));
 const incoming = Number(movement.quantity_delta || 0) > 0;
 return <tr key={movement.id}>
 <td style={css.td}><strong>{drug?.drug_name || 'Medicine'}</strong></td>
 <td style={css.td}><Badge color={incoming ? 'green' : 'yellow'} label={movement.movement_type}/></td>
 <td style={{...css.td,fontWeight:700,color:incoming ? C.success : C.danger}}>{incoming ? '+' : ''}{Number(movement.quantity_delta || 0)}</td>
 <td style={css.td}>{movement.quantity_before ?? '—'}</td>
 <td style={css.td}>{movement.quantity_after ?? '—'}</td>
 <td style={{...css.td,color:C.sub}}>{movement.reason || '—'}</td>
 <td style={{...css.td,color:C.sub}}>{movement.performed_by || 'System'}</td>
 <td style={{...css.td,color:C.sub,whiteSpace:'nowrap'}}>{movement.created_at ? new Date(movement.created_at).toLocaleString('en-KE') : '—'}</td>
 </tr>
 })}
 </tbody>
 </table>
 </div>
 </div>

 <div style={{...css.card, marginTop:'16px'}}>
 <div style={{padding:'12px 16px', borderBottom:`1px solid ${C.border}`, background:'#FAFBFD', fontSize:'13px', fontWeight:700}}>
 Recent Pharmacy Receipts
 </div>
 <div style={{overflowX:'auto'}}>
 <table style={css.table}>
 <thead>
 <tr>
 {['Receipt','Patient','Payment','Amount','Items','Sold At'].map(h => (
 <th key={h} style={css.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {recentReceipts.length===0 && (
 <tr><td colSpan={6} style={{...css.td,textAlign:'center',color:C.muted,padding:'26px'}}>No pharmacy receipts yet</td></tr>
 )}
 {recentReceipts.map(item => (
 <tr key={item.receipt_number}>
 <td style={{...css.td,fontWeight:700}}>{item.receipt_number}</td>
 <td style={css.td}>{item.customer_name}</td>
 <td style={css.td}><Badge color={item.payment_method === 'M-Pesa' ? 'green' : item.payment_method === 'Credit' ? 'purple' : /sha/i.test(item.payment_method) ? 'yellow' : /insurance/i.test(item.payment_method) ? 'blue' : 'gray'} label={item.payment_method} /></td>
 <td style={{...css.td,fontWeight:700,color:C.success}}>KES {Number(item.total_kes || 0).toLocaleString()}</td>
 <td style={css.td}>{item.lines}</td>
 <td style={{...css.td,color:C.sub}}>{item.sold_at ? new Date(item.sold_at).toLocaleString('en-KE') : '—'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 </div>

 {showModal && (
 <DrugModal
 drug={editDrug}
 onClose={()=>{setShowModal(false);setEditDrug(null);}}
 onSave={handleSave}
 />
 )}
 </div>
 );
}
