-- =============================================================================
-- RemedacareHMS — microbiology surveillance: isolates, antimicrobial susceptibility (AST) with MIC / zone,
-- EUCAST interpretation, expert rules (MRSA, ESBL, CRE, CRAB, CRPA, VRE …), intrinsic resistance,
-- MDR / XDR / PDR, first-isolate cumulative antibiogram, ward cluster signals, WHONET export and
-- instrument (VITEK / Phoenix / MicroScan) import.
--
-- Sources
--   * Breakpoints: EUCAST Clinical Breakpoint Tables v16.1 (valid from 2026-06-24), transcribed for the
--     common organism groups. "The European Committee on Antimicrobial Susceptibility Testing. Breakpoint
--     tables for interpretation of MICs and zone diameters. Version 16.1, 2026. https://www.eucast.org."
--     EUCAST material may be re-used with reference to the EUCAST website and must not be resold.
--     MIC: S if MIC <= S, R if MIC > R, otherwise I ("susceptible, increased exposure").
--     Zone: S if zone >= S, R if zone < R, otherwise I. S <= 0.001 / zone S >= 50 = no S category.
--     Bracketed EUCAST breakpoints are stored with bracketed = true (use with another active agent).
--     Laboratories using CLSI add their own rows (hospital_id set); those take precedence.
--   * Expected resistance: EUCAST Expected Resistant Phenotypes (v1.2), common organisms.
--   * MDR / XDR / PDR: Magiorakos AP et al. Clin Microbiol Infect 2012;18:268-281 (categories per group;
--     intrinsic agents excluded; MRSA counts as MDR). Because EUCAST I means "susceptible, increased exposure"
--     (2019), only R counts as non-susceptible; ESBL / CRE screening still treats I as a warning sign.
--   * First isolate per patient per organism in the period (CLSI M39); fewer than 30 isolates flagged.
--   * WHONET field names: <CODE>_E<D|M|E><potency>, e.g. CIP_ED5, CIP_EM; organism codes eco, kpn, sau …
-- Access: clinical staff (clin_can_access). Requires 08 (clin_can_access). Safe to re-run.
-- =============================================================================

-- ================================================================= reference data
create table if not exists public.micro_organisms (
  code      text primary key,          -- WHONET organism code
  name      text not null,
  gram      text check (gram in ('+', '-', 'f')),
  family    text,                      -- EBC = Enterobacterales
  bp_group  text,                      -- ENT PSE ACI STA ENC SAG SPN HIN
  synonyms  text[] not null default '{}'
);

create table if not exists public.micro_antibiotics (
  code         text primary key,       -- WHONET antibiotic code
  name         text not null,
  atc          text,
  disk_potency text,                   -- EUCAST disk content as printed, e.g. 30, 20-10, 1.25-23.75, 1 unit
  whonet_disk  text,                   -- WHONET disk potency suffix, e.g. 30, 20, 1_2, 1
  aliases      text[] not null default '{}'
);

create table if not exists public.micro_breakpoints (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid,                  -- null = shipped EUCAST default; a hospital row overrides it
  guideline     text not null default 'EUCAST',
  version       text not null default '16.1',
  bp_group      text not null,
  organism_code text,                  -- set when the breakpoint applies to one species only
  antibiotic    text not null,
  method        text not null check (method in ('mic', 'disk')),
  potency       text,
  s             numeric not null,
  r             numeric not null,
  bracketed     boolean not null default false,
  indication    text not null default 'general' check (indication in ('general', 'meningitis', 'uti')),
  note          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists micro_breakpoints_key on public.micro_breakpoints(
  coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), guideline, bp_group, coalesce(organism_code, ''), antibiotic, method, indication);

create table if not exists public.micro_intrinsic (
  key_type   text not null check (key_type in ('organism', 'family', 'group', 'gram')),
  key        text not null,
  antibiotic text not null,
  primary key (key_type, key, antibiotic)
);

create table if not exists public.micro_mdr_categories (
  bp_group      text not null,
  organism_code text,                  -- Magiorakos tables: S. aureus only (STA), P. aeruginosa only (PSE)
  category      text not null,
  antibiotics   text[] not null,
  primary key (bp_group, category)
);

create table if not exists public.micro_specimen_types (
  code        text primary key,
  label       text not null,
  whonet_code text not null
);

-- organisms (WHONET codes)
insert into public.micro_organisms(code, name, gram, family, bp_group, synonyms) values
  ('eco', 'Escherichia coli', '-', 'EBC', 'ENT', '{"e. coli","e.coli"}'),
  ('kpn', 'Klebsiella pneumoniae', '-', 'EBC', 'ENT', '{"k. pneumoniae","klebsiella pneumonia"}'),
  ('kox', 'Klebsiella oxytoca', '-', 'EBC', 'ENT', '{}'),
  ('kvi', 'Klebsiella variicola', '-', 'EBC', 'ENT', '{}'),
  ('kl-', 'Klebsiella sp.', '-', 'EBC', 'ENT', '{"klebsiella","klebsiella spp"}'),
  ('eae', 'Klebsiella aerogenes', '-', 'EBC', 'ENT', '{"enterobacter aerogenes"}'),
  ('ecl', 'Enterobacter cloacae', '-', 'EBC', 'ENT', '{"enterobacter cloacae complex"}'),
  ('ehm', 'Enterobacter hormaechei', '-', 'EBC', 'ENT', '{}'),
  ('en-', 'Enterobacter sp.', '-', 'EBC', 'ENT', '{"enterobacter","enterobacter spp"}'),
  ('cfr', 'Citrobacter freundii', '-', 'EBC', 'ENT', '{}'),
  ('cdi', 'Citrobacter koseri', '-', 'EBC', 'ENT', '{"citrobacter diversus"}'),
  ('ci-', 'Citrobacter sp.', '-', 'EBC', 'ENT', '{"citrobacter","citrobacter spp"}'),
  ('pmi', 'Proteus mirabilis', '-', 'EBC', 'ENT', '{}'),
  ('pvu', 'Proteus vulgaris', '-', 'EBC', 'ENT', '{}'),
  ('pr-', 'Proteus sp.', '-', 'EBC', 'ENT', '{"proteus","proteus spp"}'),
  ('mmo', 'Morganella morganii', '-', 'EBC', 'ENT', '{}'),
  ('pst', 'Providencia stuartii', '-', 'EBC', 'ENT', '{}'),
  ('pre', 'Providencia rettgeri', '-', 'EBC', 'ENT', '{}'),
  ('prv', 'Providencia sp.', '-', 'EBC', 'ENT', '{"providencia"}'),
  ('sma', 'Serratia marcescens', '-', 'EBC', 'ENT', '{}'),
  ('se-', 'Serratia sp.', '-', 'EBC', 'ENT', '{"serratia"}'),
  ('hal', 'Hafnia alvei', '-', 'EBC', 'ENT', '{}'),
  ('kpl', 'Raoultella planticola', '-', 'EBC', 'ENT', '{}'),
  ('sat', 'Salmonella Typhi', '-', 'EBC', 'ENT', '{"salmonella typhi","s. typhi"}'),
  ('saa', 'Salmonella Paratyphi A', '-', 'EBC', 'ENT', '{"salmonella paratyphi a"}'),
  ('sam', 'Salmonella Typhimurium', '-', 'EBC', 'ENT', '{}'),
  ('sen', 'Salmonella Enteritidis', '-', 'EBC', 'ENT', '{}'),
  ('sal', 'Salmonella sp.', '-', 'EBC', 'ENT', '{"salmonella","salmonella spp","non-typhoidal salmonella"}'),
  ('shb', 'Shigella flexneri', '-', 'EBC', 'ENT', '{}'),
  ('shd', 'Shigella sonnei', '-', 'EBC', 'ENT', '{}'),
  ('shi', 'Shigella sp.', '-', 'EBC', 'ENT', '{"shigella","shigella spp"}'),
  ('pae', 'Pseudomonas aeruginosa', '-', null, 'PSE', '{"p. aeruginosa","pseudomonas"}'),
  ('ps-', 'Pseudomonas sp.', '-', null, 'PSE', '{"pseudomonas spp"}'),
  ('aba', 'Acinetobacter baumannii', '-', null, 'ACI', '{"a. baumannii","acinetobacter baumanii"}'),
  ('ac-', 'Acinetobacter sp.', '-', null, 'ACI', '{"acinetobacter","acinetobacter spp"}'),
  ('pma', 'Stenotrophomonas maltophilia', '-', null, null, '{}'),
  ('pce', 'Burkholderia cepacia', '-', null, null, '{}'),
  ('vic', 'Vibrio cholerae', '-', null, null, '{}'),
  ('caj', 'Campylobacter jejuni', '-', null, null, '{}'),
  ('aeh', 'Aeromonas hydrophila', '-', null, null, '{}'),
  ('hin', 'Haemophilus influenzae', '-', null, 'HIN', '{"h. influenzae"}'),
  ('nme', 'Neisseria meningitidis', '-', null, null, '{}'),
  ('ngo', 'Neisseria gonorrhoeae', '-', null, null, '{}'),
  ('bca', 'Moraxella catarrhalis', '-', null, null, '{}'),
  ('sau', 'Staphylococcus aureus', '+', 'STA', 'STA', '{"s. aureus","staph aureus","staphylococcus aureus (mrsa)","mrsa"}'),
  ('sep', 'Staphylococcus epidermidis', '+', 'STA', 'STA', '{}'),
  ('shl', 'Staphylococcus haemolyticus', '+', 'STA', 'STA', '{}'),
  ('slu', 'Staphylococcus lugdunensis', '+', 'STA', 'STA', '{}'),
  ('sap', 'Staphylococcus saprophyticus', '+', 'STA', 'STA', '{}'),
  ('scn', 'Staphylococcus, coagulase negative', '+', 'STA', 'STA', '{"cons","coagulase negative staphylococcus","coagulase-negative staphylococci"}'),
  ('sta', 'Staphylococcus sp.', '+', 'STA', 'STA', '{"staphylococcus"}'),
  ('efa', 'Enterococcus faecalis', '+', 'ENT', 'ENC', '{"e. faecalis"}'),
  ('efm', 'Enterococcus faecium', '+', 'ENT', 'ENC', '{"e. faecium"}'),
  ('ent', 'Enterococcus sp.', '+', 'ENT', 'ENC', '{"enterococcus","enterococcus spp"}'),
  ('spy', 'Streptococcus pyogenes', '+', 'STR', 'SAG', '{"group a streptococcus"}'),
  ('sgc', 'Streptococcus agalactiae', '+', 'STR', 'SAG', '{"group b streptococcus"}'),
  ('bsa', 'Streptococcus, beta-haem. Group A', '+', 'STR', 'SAG', '{}'),
  ('bsb', 'Streptococcus, beta-haem. Group B', '+', 'STR', 'SAG', '{}'),
  ('bsc', 'Streptococcus, beta-haem. Group C', '+', 'STR', 'SAG', '{}'),
  ('bsg', 'Streptococcus, beta-haem. Group G', '+', 'STR', 'SAG', '{}'),
  ('spn', 'Streptococcus pneumoniae', '+', 'STR', 'SPN', '{"s. pneumoniae","pneumococcus"}'),
  ('str', 'Streptococcus sp.', '+', 'STR', null, '{"streptococcus"}'),
  ('lmo', 'Listeria monocytogenes', '+', null, null, '{}'),
  ('bcs', 'Bacillus sp.', '+', null, null, '{}'),
  ('cal', 'Candida albicans', 'f', null, null, '{}'),
  ('crs', 'Candida auris', 'f', null, null, '{}'),
  ('can', 'Candida sp.', 'f', null, null, '{"candida"}'),
  ('cne', 'Cryptococcus neoformans', 'f', null, null, '{}')
on conflict (code) do update set name = excluded.name, gram = excluded.gram, family = excluded.family, bp_group = excluded.bp_group, synonyms = excluded.synonyms;

-- antibiotics (WHONET codes; EUCAST disk content)
insert into public.micro_antibiotics(code, name, atc, disk_potency, whonet_disk, aliases) values
  ('AMP', 'Ampicillin', 'J01CA01', '10', '10', '{"ampicillin","amp"}'),
  ('AMX', 'Amoxicillin', 'J01CA04', null, null, '{"amoxicillin","amoxycillin","amoxil"}'),
  ('AMC', 'Amoxicillin-clavulanic acid', 'J01CR02', '20-10', '20', '{"amox_clav","amoxicillin-clavulanate","augmentin","co-amoxiclav","amoxicillin/clavulanic acid"}'),
  ('SAM', 'Ampicillin-sulbactam', 'J01CR01', '10-10', '10', '{"ampicillin-sulbactam","unasyn"}'),
  ('TZP', 'Piperacillin-tazobactam', 'J01CR05', '30-6', '30', '{"piperacillin_tazo","piperacillin/tazobactam","tazocin","pip-tazo"}'),
  ('PEN', 'Benzylpenicillin', 'J01CE01', '1 unit', '1', '{"penicillin","penicillin g","benzylpenicillin"}'),
  ('OXA', 'Oxacillin', 'J01CF04', '1', '1', '{"oxacillin","cloxacillin","flucloxacillin","methicillin"}'),
  ('FOX', 'Cefoxitin', 'J01DC01', '30', '30', '{"cefoxitin"}'),
  ('CXM', 'Cefuroxime', 'J01DC02', '30', '30', '{"cefuroxime","zinacef"}'),
  ('CTX', 'Cefotaxime', 'J01DD01', '5', '5', '{"cefotaxime","claforan"}'),
  ('CRO', 'Ceftriaxone', 'J01DD04', '30', '30', '{"ceftriaxone","rocephin"}'),
  ('CAZ', 'Ceftazidime', 'J01DD02', '10', '10', '{"ceftazidime","fortum"}'),
  ('FEP', 'Cefepime', 'J01DE01', '30', '30', '{"cefepime"}'),
  ('CPT', 'Ceftaroline', 'J01DI02', '5', '5', '{"ceftaroline"}'),
  ('ETP', 'Ertapenem', 'J01DH03', '10', '10', '{"ertapenem","invanz"}'),
  ('IPM', 'Imipenem', 'J01DH51', '10', '10', '{"imipenem","tienam"}'),
  ('MEM', 'Meropenem', 'J01DH02', '10', '10', '{"meropenem","meronem"}'),
  ('ATM', 'Aztreonam', 'J01DF01', '30', '30', '{"aztreonam"}'),
  ('CIP', 'Ciprofloxacin', 'J01MA02', '5', '5', '{"ciprofloxacin","cipro"}'),
  ('LVX', 'Levofloxacin', 'J01MA12', '5', '5', '{"levofloxacin"}'),
  ('MFX', 'Moxifloxacin', 'J01MA14', '5', '5', '{"moxifloxacin"}'),
  ('NOR', 'Norfloxacin', 'J01MA06', '10', '10', '{"norfloxacin"}'),
  ('NAL', 'Nalidixic acid', 'J01MB02', '30', '30', '{"nalidixic acid"}'),
  ('GEN', 'Gentamicin', 'J01GB03', '10', '10', '{"gentamicin","gentamycin"}'),
  ('GEH', 'Gentamicin-High', 'J01GB03', '30', '30', '{"gentamicin high level","hlar gentamicin"}'),
  ('AMK', 'Amikacin', 'J01GB06', '30', '30', '{"amikacin"}'),
  ('TOB', 'Tobramycin', 'J01GB01', '10', '10', '{"tobramycin"}'),
  ('SXT', 'Trimethoprim-sulfamethoxazole', 'J01EE01', '1.25-23.75', '1_2', '{"cotrimoxazole","co-trimoxazole","trimethoprim/sulfamethoxazole","septrin","bactrim","sxt"}'),
  ('NIT', 'Nitrofurantoin', 'J01XE01', '100', '100', '{"nitrofurantoin"}'),
  ('FOS', 'Fosfomycin', 'J01XX01', '200', '200', '{"fosfomycin"}'),
  ('COL', 'Colistin', 'J01XB01', null, null, '{"colistin","polymyxin e"}'),
  ('TGC', 'Tigecycline', 'J01AA12', '15', '15', '{"tigecycline"}'),
  ('TCY', 'Tetracycline', 'J01AA07', '30', '30', '{"tetracycline"}'),
  ('DOX', 'Doxycycline', 'J01AA02', null, null, '{"doxycycline"}'),
  ('MNO', 'Minocycline', 'J01AA08', null, null, '{"minocycline"}'),
  ('CHL', 'Chloramphenicol', 'J01BA01', '30', '30', '{"chloramphenicol"}'),
  ('ERY', 'Erythromycin', 'J01FA01', '15', '15', '{"erythromycin"}'),
  ('AZM', 'Azithromycin', 'J01FA10', null, null, '{"azithromycin"}'),
  ('CLI', 'Clindamycin', 'J01FF01', '2', '2', '{"clindamycin"}'),
  ('VAN', 'Vancomycin', 'J01XA01', '5', '5', '{"vancomycin"}'),
  ('TEC', 'Teicoplanin', 'J01XA02', '30', '30', '{"teicoplanin"}'),
  ('LNZ', 'Linezolid', 'J01XX08', '10', '10', '{"linezolid"}'),
  ('DAP', 'Daptomycin', 'J01XX09', null, null, '{"daptomycin"}'),
  ('RIF', 'Rifampicin', 'J04AB02', '5', '5', '{"rifampicin","rifampin"}'),
  ('FUS', 'Fusidic acid', 'J01XC01', '10', '10', '{"fusidic acid"}'),
  ('MNZ', 'Metronidazole', 'J01XD01', null, null, '{"metronidazole","flagyl"}')
on conflict (code) do update set name = excluded.name, atc = excluded.atc, disk_potency = excluded.disk_potency, whonet_disk = excluded.whonet_disk, aliases = excluded.aliases;

insert into public.micro_specimen_types(code, label, whonet_code) values
  ('blood', 'Blood', 'bl'), ('urine', 'Urine', 'ur'), ('sputum', 'Sputum', 'sp'), ('csf', 'Cerebrospinal fluid', 'sf'),
  ('wound', 'Wound / pus swab', 'wd'), ('abscess', 'Abscess / aspirate', 'ab'), ('stool', 'Stool', 'st'), ('throat', 'Throat swab', 'th'),
  ('ear', 'Ear swab', 'ea'), ('eye', 'Eye swab', 'ey'), ('genital', 'Genital / HVS', 'ge'), ('body_fluid', 'Body fluid (pleural, ascitic, joint)', 'bf'),
  ('tissue', 'Tissue / biopsy', 'ti'), ('catheter', 'Catheter tip', 'ca'), ('bronchial', 'Bronchial / tracheal aspirate', 'br'), ('nasal', 'Nasal swab', 'no'),
  ('other', 'Other', 'ot')
on conflict (code) do nothing;

-- EUCAST v16.1 breakpoints: (group, organism, antibiotic, MIC S, MIC R, disk, zone S, zone R, bracketed, indication, note)
do $$
declare r record;
begin
  for r in select * from (values
    -- Enterobacterales
    ('ENT', null, 'AMP', 8, 8, '10', 14, 14, false, 'general', 'iv'),
    ('ENT', null, 'AMC', 8, 8, '20-10', 19, 19, false, 'general', 'iv'),
    ('ENT', null, 'TZP', 8, 8, '30-6', 20, 20, false, 'general', null),
    ('ENT', null, 'CXM', 0.001, 8, '30', 50, 19, false, 'general', 'iv; E. coli, Klebsiella (except K. aerogenes), Raoultella, P. mirabilis'),
    ('ENT', null, 'CTX', 1, 2, '5', 20, 17, false, 'general', 'indications other than meningitis'),
    ('ENT', null, 'CTX', 1, 1, '5', 20, 20, false, 'meningitis', null),
    ('ENT', null, 'CRO', 1, 2, '30', 27, 24, false, 'general', 'indications other than meningitis'),
    ('ENT', null, 'CRO', 1, 1, '30', 27, 27, false, 'meningitis', null),
    ('ENT', null, 'CAZ', 1, 4, '10', 22, 19, false, 'general', null),
    ('ENT', null, 'FEP', 1, 4, '30', 27, 24, false, 'general', null),
    ('ENT', null, 'ETP', 0.5, 0.5, '10', 23, 23, false, 'general', null),
    ('ENT', null, 'IPM', 2, 4, '10', 22, 19, false, 'general', 'Enterobacterales except Morganellaceae'),
    ('ENT', 'mmo', 'IPM', 0.001, 4, '10', 50, 19, false, 'general', 'Morganellaceae'),
    ('ENT', 'pmi', 'IPM', 0.001, 4, '10', 50, 19, false, 'general', 'Morganellaceae'),
    ('ENT', 'pvu', 'IPM', 0.001, 4, '10', 50, 19, false, 'general', 'Morganellaceae'),
    ('ENT', 'pst', 'IPM', 0.001, 4, '10', 50, 19, false, 'general', 'Morganellaceae'),
    ('ENT', 'pre', 'IPM', 0.001, 4, '10', 50, 19, false, 'general', 'Morganellaceae'),
    ('ENT', null, 'MEM', 2, 8, '10', 22, 16, false, 'general', 'indications other than meningitis'),
    ('ENT', null, 'MEM', 2, 2, '10', 22, 22, false, 'meningitis', null),
    ('ENT', null, 'ATM', 1, 4, '30', 26, 21, false, 'general', null),
    ('ENT', null, 'CIP', 0.25, 0.5, '5', 25, 22, false, 'general', 'indications other than meningitis; ATU MIC 0.5, zone 22-24'),
    ('ENT', null, 'LVX', 0.5, 1, '5', 23, 19, false, 'general', null),
    ('ENT', null, 'AMK', 8, 8, '30', 18, 18, true, 'general', 'systemic infections'),
    ('ENT', null, 'GEN', 2, 2, '10', 17, 17, true, 'general', 'systemic infections'),
    ('ENT', null, 'TOB', 2, 2, '10', 16, 16, true, 'general', 'systemic infections'),
    ('ENT', null, 'SXT', 0.5, 0.5, '1.25-23.75', 15, 15, false, 'general', 'Enterobacterales except Serratia'),
    ('ENT', 'sma', 'SXT', 0.001, 2, '1.25-23.75', 50, 15, false, 'general', 'Serratia'),
    ('ENT', 'se-', 'SXT', 0.001, 2, '1.25-23.75', 50, 15, false, 'general', 'Serratia'),
    ('ENT', 'eco', 'NIT', 64, 64, '100', 11, 11, false, 'uti', 'uncomplicated UTI only, E. coli'),
    ('ENT', 'eco', 'FOS', 8, 8, '200', 24, 24, false, 'uti', 'E. coli, infections originating from the urinary tract'),
    ('ENT', null, 'COL', 2, 2, null, null, null, true, 'general', 'MIC only (broth microdilution)'),
    ('ENT', 'eco', 'TGC', 0.5, 0.5, '15', 18, 18, false, 'general', 'E. coli and C. koseri'),
    ('ENT', 'cdi', 'TGC', 0.5, 0.5, '15', 18, 18, false, 'general', 'E. coli and C. koseri'),
    -- Pseudomonas
    ('PSE', null, 'TZP', 0.001, 16, '30-6', 50, 18, false, 'general', 'ATU zone 18-19'),
    ('PSE', null, 'CAZ', 0.001, 8, '10', 50, 17, false, 'general', null),
    ('PSE', null, 'FEP', 0.001, 8, '30', 50, 21, false, 'general', 'ATU zone 19-23'),
    ('PSE', null, 'IPM', 0.001, 4, '10', 50, 20, false, 'general', null),
    ('PSE', 'pae', 'MEM', 2, 8, '10', 20, 14, false, 'general', 'P. aeruginosa, indications other than meningitis'),
    ('PSE', null, 'MEM', 2, 8, '10', 24, 18, false, 'general', 'Pseudomonas other than P. aeruginosa'),
    ('PSE', 'pae', 'MEM', 2, 2, '10', 20, 20, false, 'meningitis', null),
    ('PSE', null, 'ATM', 0.001, 16, '30', 50, 18, false, 'general', null),
    ('PSE', null, 'CIP', 0.001, 0.5, '5', 50, 26, false, 'general', null),
    ('PSE', null, 'LVX', 0.001, 2, '5', 50, 18, false, 'general', null),
    ('PSE', null, 'AMK', 16, 16, '30', 15, 15, true, 'general', 'systemic infections'),
    ('PSE', null, 'TOB', 2, 2, '10', 18, 18, true, 'general', 'systemic infections'),
    ('PSE', null, 'COL', 4, 4, null, null, null, true, 'general', 'MIC only'),
    -- Acinetobacter
    ('ACI', null, 'IPM', 2, 4, '10', 24, 21, false, 'general', null),
    ('ACI', null, 'MEM', 2, 8, '10', 21, 15, false, 'general', 'indications other than meningitis'),
    ('ACI', null, 'MEM', 2, 2, '10', 21, 21, false, 'meningitis', null),
    ('ACI', null, 'CIP', 0.001, 1, '5', 50, 21, false, 'general', null),
    ('ACI', null, 'LVX', 0.5, 1, '5', 23, 20, false, 'general', null),
    ('ACI', null, 'AMK', 8, 8, '30', 19, 19, true, 'general', 'systemic infections'),
    ('ACI', null, 'GEN', 4, 4, '10', 17, 17, true, 'general', 'systemic infections'),
    ('ACI', null, 'TOB', 4, 4, '10', 17, 17, true, 'general', 'systemic infections'),
    ('ACI', null, 'SXT', 0.5, 0.5, '1.25-23.75', 16, 16, false, 'general', null),
    ('ACI', null, 'COL', 2, 2, null, null, null, true, 'general', 'MIC only'),
    -- Staphylococcus
    ('STA', 'sau', 'PEN', 0.125, 0.125, '1 unit', 26, 26, false, 'general', 'S. aureus'),
    ('STA', 'slu', 'PEN', 0.125, 0.125, '1 unit', 26, 26, false, 'general', 'S. lugdunensis'),
    ('STA', null, 'FOX', 999, 999, '30', 22, 22, false, 'general', 'screen: S. aureus and CoNS except S. epidermidis / S. lugdunensis; R = methicillin resistant'),
    ('STA', 'sep', 'FOX', 999, 999, '30', 27, 27, false, 'general', 'screen: S. epidermidis'),
    ('STA', 'slu', 'FOX', 999, 999, '30', 27, 27, false, 'general', 'screen: S. lugdunensis'),
    ('STA', 'sau', 'OXA', 2, 2, null, null, null, false, 'general', 'MIC > 2 = methicillin resistant (S. aureus)'),
    ('STA', 'slu', 'OXA', 2, 2, null, null, null, false, 'general', 'MIC > 2 = methicillin resistant'),
    ('STA', 'sap', 'OXA', 2, 2, null, null, null, false, 'general', 'MIC > 2 = methicillin resistant'),
    ('STA', null, 'OXA', 0.25, 0.25, null, null, null, false, 'general', 'CoNS: MIC > 0.25 = methicillin resistant'),
    ('STA', 'sau', 'CIP', 0.001, 2, '5', 50, 17, true, 'general', 'S. aureus'),
    ('STA', null, 'CIP', 0.001, 2, '5', 50, 22, true, 'general', 'coagulase-negative staphylococci'),
    ('STA', 'sau', 'LVX', 0.001, 1, '5', 50, 22, false, 'general', 'S. aureus'),
    ('STA', null, 'LVX', 0.001, 1, '5', 50, 24, false, 'general', 'coagulase-negative staphylococci'),
    ('STA', 'sau', 'MFX', 0.25, 0.25, '5', 25, 25, false, 'general', 'S. aureus'),
    ('STA', null, 'MFX', 0.25, 0.25, '5', 28, 28, false, 'general', 'coagulase-negative staphylococci'),
    ('STA', null, 'AMK', 16, 16, '30', 15, 15, true, 'general', null),
    ('STA', 'sau', 'GEN', 2, 2, '10', 18, 18, true, 'general', 'S. aureus'),
    ('STA', null, 'GEN', 2, 2, '10', 22, 22, true, 'general', 'coagulase-negative staphylococci'),
    ('STA', 'sau', 'TOB', 2, 2, '10', 18, 18, true, 'general', 'S. aureus'),
    ('STA', 'sau', 'VAN', 2, 2, null, null, null, false, 'general', 'MIC only'),
    ('STA', null, 'VAN', 4, 4, null, null, null, false, 'general', 'CoNS, MIC only'),
    ('STA', 'sau', 'TEC', 2, 2, null, null, null, false, 'general', 'MIC only'),
    ('STA', null, 'TEC', 4, 4, null, null, null, false, 'general', 'CoNS, MIC only'),
    ('STA', null, 'ERY', 1, 1, '15', 21, 21, false, 'general', null),
    ('STA', null, 'CLI', 0.25, 0.25, '2', 22, 22, false, 'general', 'test for inducible resistance (D-test)'),
    ('STA', null, 'DOX', 1, 1, null, null, null, false, 'general', null),
    ('STA', null, 'TCY', 1, 1, '30', 22, 22, false, 'general', null),
    ('STA', null, 'TGC', 0.5, 0.5, '15', 19, 19, false, 'general', null),
    ('STA', null, 'LNZ', 4, 4, '10', 21, 21, false, 'general', null),
    ('STA', null, 'FUS', 1, 1, '10', 24, 24, false, 'general', null),
    ('STA', 'sau', 'RIF', 0.06, 0.06, '5', 26, 26, false, 'general', 'S. aureus'),
    ('STA', null, 'RIF', 0.06, 0.06, '5', 30, 30, false, 'general', 'coagulase-negative staphylococci'),
    ('STA', null, 'SXT', 0.5, 0.5, '1.25-23.75', 24, 24, false, 'general', null),
    ('STA', 'sap', 'NIT', 64, 64, '100', 13, 13, false, 'uti', 'S. saprophyticus, uncomplicated UTI only'),
    -- Enterococcus
    ('ENC', null, 'AMP', 4, 4, '2', 10, 10, false, 'general', 'iv'),
    ('ENC', 'efa', 'IPM', 0.001, 4, '10', 50, 21, false, 'general', 'E. faecalis'),
    ('ENC', null, 'CIP', 4, 4, '5', 15, 15, false, 'uti', 'uncomplicated UTI only'),
    ('ENC', null, 'LVX', 4, 4, '5', 15, 15, false, 'uti', 'uncomplicated UTI only'),
    ('ENC', null, 'TEC', 2, 2, '30', 16, 16, false, 'general', null),
    ('ENC', 'efa', 'VAN', 4, 4, '5', 12, 12, false, 'general', 'E. faecalis and E. faecium'),
    ('ENC', 'efm', 'VAN', 4, 4, '5', 12, 12, false, 'general', 'E. faecalis and E. faecium'),
    ('ENC', null, 'VAN', 4, 4, '5', 15, 15, false, 'general', 'other enterococci'),
    ('ENC', null, 'TGC', 0.5, 0.5, '15', 20, 20, false, 'general', null),
    ('ENC', null, 'LNZ', 4, 4, '10', 20, 20, false, 'general', null),
    ('ENC', 'efa', 'NIT', 64, 64, '100', 15, 15, false, 'uti', 'E. faecalis, uncomplicated UTI only'),
    -- Streptococcus groups A, B, C, G
    ('SAG', 'spy', 'PEN', 0.03, 0.03, '1 unit', 23, 23, false, 'general', 'groups A, C and G'),
    ('SAG', 'bsa', 'PEN', 0.03, 0.03, '1 unit', 23, 23, false, 'general', 'groups A, C and G'),
    ('SAG', 'bsc', 'PEN', 0.03, 0.03, '1 unit', 23, 23, false, 'general', 'groups A, C and G'),
    ('SAG', 'bsg', 'PEN', 0.03, 0.03, '1 unit', 23, 23, false, 'general', 'groups A, C and G'),
    ('SAG', 'sgc', 'PEN', 0.125, 0.125, '1 unit', 18, 18, false, 'general', 'group B'),
    ('SAG', 'bsb', 'PEN', 0.125, 0.125, '1 unit', 18, 18, false, 'general', 'group B'),
    ('SAG', null, 'LVX', 0.001, 2, '5', 50, 17, false, 'general', null),
    ('SAG', null, 'MFX', 0.5, 0.5, '5', 19, 19, false, 'general', null),
    ('SAG', null, 'VAN', 2, 2, '5', 13, 13, false, 'general', null),
    ('SAG', null, 'ERY', 0.25, 0.25, '15', 21, 21, false, 'general', null),
    ('SAG', null, 'CLI', 0.5, 0.5, '2', 17, 17, false, 'general', null),
    ('SAG', null, 'DOX', 1, 1, null, null, null, false, 'general', null),
    ('SAG', null, 'TCY', 1, 1, '30', 23, 23, false, 'general', null),
    ('SAG', null, 'LNZ', 2, 2, '10', 19, 19, false, 'general', null),
    ('SAG', null, 'RIF', 0.25, 0.25, '5', 21, 21, false, 'general', null),
    ('SAG', null, 'SXT', 0.5, 0.5, '1.25-23.75', 16, 16, false, 'general', null),
    -- Streptococcus pneumoniae
    ('SPN', null, 'PEN', 0.06, 1, null, null, null, false, 'general', 'indications other than endocarditis and meningitis'),
    ('SPN', null, 'PEN', 0.06, 0.06, null, null, null, false, 'meningitis', 'endocarditis and meningitis'),
    ('SPN', null, 'AMP', 0.5, 1, '2', 22, 19, false, 'general', 'iv, other than endocarditis and meningitis'),
    ('SPN', null, 'AMP', 0.06, 0.06, null, null, null, false, 'meningitis', null),
    ('SPN', null, 'AMX', 0.5, 1, null, null, null, false, 'general', 'oral'),
    ('SPN', null, 'CTX', 0.5, 2, null, null, null, false, 'general', 'indications other than endocarditis and meningitis'),
    ('SPN', null, 'CTX', 0.5, 0.5, null, null, null, false, 'meningitis', null),
    ('SPN', null, 'CRO', 0.5, 2, null, null, null, false, 'general', 'indications other than endocarditis and meningitis'),
    ('SPN', null, 'CRO', 0.5, 0.5, null, null, null, false, 'meningitis', null),
    ('SPN', null, 'CXM', 0.5, 1, null, null, null, false, 'general', 'iv'),
    ('SPN', null, 'MEM', 2, 2, null, null, null, false, 'general', 'indications other than meningitis'),
    ('SPN', null, 'MEM', 0.25, 0.25, null, null, null, false, 'meningitis', null),
    ('SPN', null, 'LVX', 0.001, 2, '5', 50, 16, false, 'general', null),
    ('SPN', null, 'MFX', 0.5, 0.5, '5', 22, 22, false, 'general', null),
    ('SPN', null, 'VAN', 2, 2, '5', 16, 16, false, 'general', null),
    ('SPN', null, 'ERY', 0.25, 0.25, '15', 22, 22, false, 'general', null),
    ('SPN', null, 'CLI', 0.5, 0.5, '2', 19, 19, false, 'general', null),
    ('SPN', null, 'DOX', 1, 1, null, null, null, false, 'general', null),
    ('SPN', null, 'TCY', 1, 1, '30', 25, 25, false, 'general', null),
    ('SPN', null, 'LNZ', 2, 2, '10', 22, 22, false, 'general', null),
    ('SPN', null, 'RIF', 0.125, 0.125, '5', 22, 22, false, 'general', null),
    ('SPN', null, 'SXT', 1, 1, '1.25-23.75', 15, 15, false, 'general', null),
    -- Haemophilus influenzae
    ('HIN', null, 'AMP', 1, 1, '2', 18, 18, false, 'general', 'indications other than meningitis'),
    ('HIN', null, 'AMX', 2, 2, null, null, null, false, 'general', 'iv, other than meningitis'),
    ('HIN', null, 'AMC', 2, 2, '2-1', 15, 15, false, 'general', 'iv'),
    ('HIN', null, 'CTX', 0.125, 0.125, '5', 27, 27, false, 'general', 'ATU zone 25-27'),
    ('HIN', null, 'CRO', 0.125, 0.125, '30', 32, 32, false, 'general', 'ATU zone 31-33'),
    ('HIN', null, 'CXM', 1, 2, '30', 27, 25, false, 'general', 'iv'),
    ('HIN', null, 'MEM', 2, 2, '10', 20, 20, false, 'general', 'indications other than meningitis'),
    ('HIN', null, 'MEM', 0.25, 0.25, null, null, null, false, 'meningitis', null),
    ('HIN', null, 'CIP', 0.03, 0.03, '5', 32, 32, false, 'general', null),
    ('HIN', null, 'LVX', 0.06, 0.06, '5', 30, 30, false, 'general', null),
    ('HIN', null, 'TCY', 2, 2, '30', 25, 25, false, 'general', null),
    ('HIN', null, 'CHL', 2, 2, '30', 28, 28, false, 'general', null),
    ('HIN', null, 'SXT', 0.5, 0.5, '1.25-23.75', 23, 23, false, 'general', null)
  ) v(grp, org, abx, ms, mr, disk, zs, zr, br, ind, note)
  loop
    if r.ms is not null and r.ms <> 999 then
      insert into public.micro_breakpoints(hospital_id, bp_group, organism_code, antibiotic, method, potency, s, r, bracketed, indication, note)
      values (null, r.grp, r.org, r.abx, 'mic', null, r.ms, r.mr, r.br, r.ind, r.note)
      on conflict (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), guideline, bp_group, coalesce(organism_code, ''), antibiotic, method, indication)
      do update set s = excluded.s, r = excluded.r, bracketed = excluded.bracketed, note = excluded.note, version = '16.1';
    end if;
    if r.zs is not null then
      insert into public.micro_breakpoints(hospital_id, bp_group, organism_code, antibiotic, method, potency, s, r, bracketed, indication, note)
      values (null, r.grp, r.org, r.abx, 'disk', r.disk, r.zs, r.zr, r.br, r.ind, r.note)
      on conflict (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), guideline, bp_group, coalesce(organism_code, ''), antibiotic, method, indication)
      do update set s = excluded.s, r = excluded.r, potency = excluded.potency, bracketed = excluded.bracketed, note = excluded.note, version = '16.1';
    end if;
  end loop;
end $$;

-- expected (intrinsic) resistance — EUCAST Expected Resistant Phenotypes, common organisms
insert into public.micro_intrinsic(key_type, key, antibiotic)
select k.t, k.k, unnest(k.a) from (values
  ('gram', '+', array['ATM', 'COL', 'NAL']),
  ('family', 'EBC', array['CLI', 'DAP', 'FUS', 'VAN', 'TEC', 'LNZ', 'RIF', 'ERY', 'AZM']),
  ('organism', 'kpn', array['AMP']), ('organism', 'kox', array['AMP']), ('organism', 'kvi', array['AMP']), ('organism', 'kl-', array['AMP']), ('organism', 'cdi', array['AMP']),
  ('organism', 'ecl', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX']), ('organism', 'ehm', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX']), ('organism', 'en-', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX']),
  ('organism', 'eae', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX']), ('organism', 'cfr', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX']),
  ('organism', 'hal', array['AMP', 'AMX', 'AMC', 'COL']),
  ('organism', 'sma', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX', 'CXM', 'COL', 'NIT']), ('organism', 'se-', array['AMP', 'AMX', 'AMC', 'SAM', 'FOX', 'CXM', 'COL', 'NIT']),
  ('organism', 'mmo', array['AMP', 'AMX', 'AMC', 'SAM', 'CXM', 'TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'pmi', array['TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'pvu', array['AMP', 'AMX', 'CXM', 'TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'pst', array['AMP', 'AMX', 'AMC', 'SAM', 'TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'pre', array['AMP', 'AMX', 'AMC', 'SAM', 'TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'prv', array['AMP', 'AMX', 'AMC', 'SAM', 'TCY', 'DOX', 'MNO', 'TGC', 'COL', 'NIT']),
  ('organism', 'pae', array['AMP', 'AMX', 'AMC', 'SAM', 'CTX', 'CRO', 'CXM', 'ETP', 'CHL', 'TCY', 'DOX', 'MNO', 'TGC']),
  ('organism', 'aba', array['AMP', 'AMX', 'AMC', 'CTX', 'CRO', 'ATM', 'ETP', 'FOS', 'TCY', 'DOX']),
  ('organism', 'ac-', array['AMP', 'AMX', 'AMC', 'ATM', 'ETP', 'FOS']),
  ('organism', 'pma', array['AMP', 'AMX', 'AMC', 'SAM', 'TZP', 'CTX', 'CRO', 'ATM', 'ETP', 'IPM', 'MEM', 'GEN', 'AMK', 'TOB', 'FOS', 'TCY']),
  ('organism', 'pce', array['AMP', 'AMX', 'AMC', 'SAM', 'TZP', 'CTX', 'CRO', 'ATM', 'ETP', 'CIP', 'CHL', 'GEN', 'AMK', 'TOB', 'FOS', 'COL']),
  ('organism', 'sau', array['CAZ']),
  ('organism', 'sap', array['FUS', 'CAZ', 'FOS']),
  ('group', 'ENC', array['FUS', 'CXM', 'CTX', 'CRO', 'CAZ', 'FEP', 'FOX', 'CPT', 'ERY', 'AZM']),
  ('organism', 'efa', array['CLI']),
  ('family', 'STR', array['FUS', 'CAZ', 'GEN', 'AMK', 'TOB'])
) k(t, k, a)
on conflict do nothing;

-- Magiorakos 2012 categories
insert into public.micro_mdr_categories(bp_group, organism_code, category, antibiotics) values
  ('STA', 'sau', 'Aminoglycosides', '{GEN}'), ('STA', 'sau', 'Ansamycins', '{RIF}'), ('STA', 'sau', 'Anti-MRSA cephalosporins', '{CPT}'),
  ('STA', 'sau', 'Anti-staphylococcal beta-lactams', '{OXA,FOX}'), ('STA', 'sau', 'Fluoroquinolones', '{CIP,MFX}'), ('STA', 'sau', 'Folate pathway inhibitors', '{SXT}'),
  ('STA', 'sau', 'Fucidanes', '{FUS}'), ('STA', 'sau', 'Glycopeptides', '{VAN,TEC}'), ('STA', 'sau', 'Glycylcyclines', '{TGC}'), ('STA', 'sau', 'Lincosamides', '{CLI}'),
  ('STA', 'sau', 'Lipopeptides', '{DAP}'), ('STA', 'sau', 'Macrolides', '{ERY}'), ('STA', 'sau', 'Oxazolidinones', '{LNZ}'), ('STA', 'sau', 'Phenicols', '{CHL}'),
  ('STA', 'sau', 'Phosphonic acids', '{FOS}'), ('STA', 'sau', 'Streptogramins', '{QDA}'), ('STA', 'sau', 'Tetracyclines', '{TCY,DOX,MNO}'),
  ('ENC', null, 'Aminoglycosides (high level)', '{GEH}'), ('ENC', null, 'Streptomycin (high level)', '{STH}'), ('ENC', null, 'Carbapenems', '{IPM,MEM}'),
  ('ENC', null, 'Fluoroquinolones', '{CIP,LVX,MFX}'), ('ENC', null, 'Glycopeptides', '{VAN,TEC}'), ('ENC', null, 'Glycylcyclines', '{TGC}'), ('ENC', null, 'Lipopeptides', '{DAP}'),
  ('ENC', null, 'Oxazolidinones', '{LNZ}'), ('ENC', null, 'Penicillins', '{AMP}'), ('ENC', null, 'Streptogramins', '{QDA}'), ('ENC', null, 'Tetracyclines', '{DOX,MNO}'),
  ('ENT', null, 'Aminoglycosides', '{GEN,TOB,AMK}'), ('ENT', null, 'Anti-MRSA cephalosporins', '{CPT}'), ('ENT', null, 'Antipseudomonal penicillins + beta-lactamase inhibitors', '{TZP}'),
  ('ENT', null, 'Carbapenems', '{ETP,IPM,MEM}'), ('ENT', null, 'Non-extended spectrum cephalosporins', '{CXM}'), ('ENT', null, 'Extended-spectrum cephalosporins', '{CTX,CRO,CAZ,FEP}'),
  ('ENT', null, 'Cephamycins', '{FOX}'), ('ENT', null, 'Fluoroquinolones', '{CIP}'), ('ENT', null, 'Folate pathway inhibitors', '{SXT}'), ('ENT', null, 'Glycylcyclines', '{TGC}'),
  ('ENT', null, 'Monobactams', '{ATM}'), ('ENT', null, 'Penicillins', '{AMP}'), ('ENT', null, 'Penicillins + beta-lactamase inhibitors', '{AMC,SAM}'), ('ENT', null, 'Phenicols', '{CHL}'),
  ('ENT', null, 'Phosphonic acids', '{FOS}'), ('ENT', null, 'Polymyxins', '{COL}'), ('ENT', null, 'Tetracyclines', '{TCY,DOX,MNO}'),
  ('PSE', 'pae', 'Aminoglycosides', '{GEN,TOB,AMK}'), ('PSE', 'pae', 'Antipseudomonal carbapenems', '{IPM,MEM}'), ('PSE', 'pae', 'Antipseudomonal cephalosporins', '{CAZ,FEP}'),
  ('PSE', 'pae', 'Antipseudomonal fluoroquinolones', '{CIP,LVX}'), ('PSE', 'pae', 'Antipseudomonal penicillins + beta-lactamase inhibitors', '{TZP}'), ('PSE', 'pae', 'Monobactams', '{ATM}'),
  ('PSE', 'pae', 'Phosphonic acids', '{FOS}'), ('PSE', 'pae', 'Polymyxins', '{COL}'),
  ('ACI', null, 'Aminoglycosides', '{GEN,TOB,AMK}'), ('ACI', null, 'Antipseudomonal carbapenems', '{IPM,MEM}'), ('ACI', null, 'Antipseudomonal fluoroquinolones', '{CIP,LVX}'),
  ('ACI', null, 'Antipseudomonal penicillins + beta-lactamase inhibitors', '{TZP}'), ('ACI', null, 'Extended-spectrum cephalosporins', '{CTX,CRO,CAZ,FEP}'), ('ACI', null, 'Folate pathway inhibitors', '{SXT}'),
  ('ACI', null, 'Penicillins + beta-lactamase inhibitors', '{SAM}'), ('ACI', null, 'Polymyxins', '{COL}'), ('ACI', null, 'Tetracyclines', '{TCY,DOX,MNO}')
on conflict (bp_group, category) do update set organism_code = excluded.organism_code, antibiotics = excluded.antibiotics;

-- ================================================================= isolates and results
create table if not exists public.micro_isolates (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       uuid,
  visit_id         uuid,
  lab_test_id      uuid,
  legacy_result_id text unique,          -- microbiology_results.id this isolate was built from
  specimen_no      text,
  specimen_type    text not null default 'other',
  specimen_date    date not null default current_date,
  ward             text,
  ward_type        text check (ward_type in ('inx', 'out', 'eme', 'icu', 'oth')),
  organism_code    text,
  organism_name    text not null,
  phenotype        jsonb not null default '{}'::jsonb,  -- esbl, carbapenemase, beta_lactamase, d_test, meca: '+' / '-'
  onset            text check (onset in ('community', 'hospital')),
  onset_override   text check (onset_override in ('community', 'hospital')),
  flags            text[] not null default '{}',
  warnings         text[] not null default '{}',
  mdr_class        text check (mdr_class in ('none', 'MDR', 'possible XDR', 'XDR', 'PDR', 'insufficient')),
  mdr_detail       jsonb not null default '{}'::jsonb,
  status           text not null default 'preliminary' check (status in ('preliminary', 'final')),
  source           text not null default 'manual' check (source in ('manual', 'import', 'legacy')),
  instrument       text,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists micro_isolates_hospital_date on public.micro_isolates(hospital_id, specimen_date);
create index if not exists micro_isolates_patient on public.micro_isolates(patient_id, organism_code, specimen_date);
create unique index if not exists micro_isolates_specimen_org on public.micro_isolates(hospital_id, specimen_no, organism_code) where specimen_no is not null and organism_code is not null;

create table if not exists public.micro_ast (
  id             uuid primary key default gen_random_uuid(),
  isolate_id     uuid not null references public.micro_isolates(id) on delete cascade,
  hospital_id    uuid not null,
  antibiotic     text not null,
  method         text not null default 'mic' check (method in ('mic', 'disk', 'etest', 'sir')),
  raw_value      text,
  comparator     text check (comparator in ('<=', '<', '=', '>', '>=')),
  value          numeric,
  potency        text,
  entered_sir    text check (entered_sir in ('S', 'I', 'R')),
  interpretation text check (interpretation in ('S', 'I', 'R')),
  reported_sir   text check (reported_sir in ('S', 'I', 'R')),
  rule           text,                    -- breakpoint / entered / intrinsic / expert rule that set reported_sir
  breakpoint_id  uuid,
  created_at     timestamptz not null default now(),
  unique (isolate_id, antibiotic)
);
create index if not exists micro_ast_hospital_abx on public.micro_ast(hospital_id, antibiotic);

create table if not exists public.micro_instrument_maps (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  instrument    text not null,
  kind          text not null check (kind in ('antibiotic', 'organism', 'specimen')),
  external_code text not null,
  internal_code text not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists micro_instrument_maps_key on public.micro_instrument_maps(hospital_id, instrument, kind, lower(external_code));

-- ================================================================= interpretation
/** Split an instrument value such as "<=0.25", "≥ 32", ">16", "0.5" into comparator and number. */
create or replace function public.micro_parse_value(p_raw text, out comparator text, out value numeric)
language plpgsql immutable as $$
declare t text := replace(replace(replace(coalesce(p_raw, ''), '≤', '<='), '≥', '>='), ' ', '');
        m text[];
begin
  t := regexp_replace(t, '\*+$', '');
  m := regexp_match(t, '^(<=|>=|<|>|=)?([0-9]+(\.[0-9]+)?)$');
  if m is null then comparator := null; value := null; return; end if;
  comparator := coalesce(m[1], '=');
  value := m[2]::numeric;
end $$;

/** S / I / R from a value and a breakpoint (null = cannot be decided from this value). */
create or replace function public.micro_sir(p_method text, p_comparator text, p_value numeric, p_s numeric, p_r numeric)
returns text language sql immutable as $$
  select case
    when p_value is null or p_s is null or p_r is null then null
    when p_method = 'disk' then case when p_value >= p_s then 'S' when p_value < p_r then 'R' else 'I' end
    when coalesce(p_comparator, '=') in ('<=', '<') then case when p_value <= p_s then 'S' end
    when p_comparator = '>' then case when p_value >= p_r then 'R' end
    when p_comparator = '>=' then case when p_value > p_r then 'R' end
    else case when p_value <= p_s then 'S' when p_value > p_r then 'R' else 'I' end
  end
$$;

/** The breakpoint that applies: hospital row first, then species-specific, then group; meningitis / UTI rows when relevant. */
create or replace function public.micro_breakpoint_for(p_hospital uuid, p_org text, p_abx text, p_method text, p_indication text)
returns public.micro_breakpoints language sql stable security definer set search_path = public as $$
  select b.* from public.micro_breakpoints b
    join public.micro_organisms o on o.code = p_org
   where b.active and b.antibiotic = p_abx and b.method = case when p_method = 'etest' then 'mic' else p_method end
     and (b.hospital_id = p_hospital or b.hospital_id is null)
     and (b.organism_code = p_org or (b.organism_code is null and b.bp_group = o.bp_group))
     and (b.indication = 'general' or b.indication = p_indication)
   order by (b.hospital_id is null), (b.organism_code is null), (b.indication = p_indication) desc
   limit 1
$$;

create or replace function public.micro_is_intrinsic(p_org text, p_abx text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.micro_intrinsic i join public.micro_organisms o on o.code = p_org
                  where i.antibiotic = p_abx and ((i.key_type = 'organism' and i.key = o.code) or (i.key_type = 'family' and i.key = o.family)
                                                  or (i.key_type = 'group' and i.key = o.bp_group) or (i.key_type = 'gram' and i.key = o.gram)))
$$;

create or replace function public.micro_ast_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record; v_h uuid;
begin
  select hospital_id into v_h from public.micro_isolates where id = new.isolate_id;
  if v_h is null then raise exception 'Isolate not found'; end if;
  new.hospital_id := v_h;
  new.antibiotic := upper(trim(new.antibiotic));
  if not exists (select 1 from public.micro_antibiotics where code = new.antibiotic) then raise exception 'Unknown antibiotic code %', new.antibiotic; end if;
  new.entered_sir := nullif(upper(trim(new.entered_sir)), '');
  if new.method <> 'sir' and new.raw_value is not null then
    p := public.micro_parse_value(new.raw_value);
    if p.value is null then raise exception 'Cannot read % value "%" for %', new.method, new.raw_value, new.antibiotic; end if;
    new.comparator := p.comparator; new.value := p.value;
  end if;
  if new.method = 'sir' and new.entered_sir is null then raise exception 'Enter S, I or R for %', new.antibiotic; end if;
  if new.method <> 'sir' and new.value is null and new.entered_sir is null then raise exception 'Enter a value or S / I / R for %', new.antibiotic; end if;
  return new;
end $$;
drop trigger if exists trg_micro_ast_before on public.micro_ast;
create trigger trg_micro_ast_before before insert or update on public.micro_ast for each row execute function public.micro_ast_before();

/** Interpret every result, apply intrinsic resistance and expert rules, classify MDR / XDR / PDR, set onset and alert. */
create or replace function public.micro_isolate_refresh(p_isolate uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  iso public.micro_isolates; org public.micro_organisms; a record; bp public.micro_breakpoints; v_sir text; v_ind text;
  v_flags text[] := '{}'; v_warn text[] := '{}'; v_old text[]; v_ns text[]; c record; v_avail int := 0; v_aff int := 0; v_total int := 0; v_all_ns boolean := true;
  v_class text; v_detail jsonb := '[]'::jsonb; v_adm date; v_onset text; v_mr boolean := false; v_rep jsonb := '{}'::jsonb; v_critical text[];
begin
  select * into iso from public.micro_isolates where id = p_isolate for update;
  if iso.id is null then return; end if;
  select * into org from public.micro_organisms where code = iso.organism_code;
  v_old := iso.flags;
  v_ind := case iso.specimen_type when 'csf' then 'meningitis' when 'urine' then 'uti' else 'general' end;
  perform set_config('app.micro_refresh', 'on', true);

  -- 1. breakpoints / entered values
  for a in select * from public.micro_ast where isolate_id = p_isolate loop
    bp := null; v_sir := null;
    if org.code is not null and a.method <> 'sir' and a.value is not null then
      bp := public.micro_breakpoint_for(iso.hospital_id, org.code, a.antibiotic, a.method, v_ind);
      if bp.id is not null then v_sir := public.micro_sir(case when a.method = 'disk' then 'disk' else 'mic' end, a.comparator, a.value, bp.s, bp.r); end if;
    end if;
    update public.micro_ast set
      interpretation = coalesce(v_sir, a.entered_sir),
      reported_sir   = coalesce(v_sir, a.entered_sir),
      rule           = case when v_sir is not null then bp.guideline || ' ' || bp.version || case when bp.bracketed then ' (bracketed)' else '' end
                            when a.entered_sir is not null then 'entered' else 'no breakpoint' end,
      breakpoint_id  = bp.id
    where id = a.id;
    if v_sir is not null and a.entered_sir is not null and v_sir <> a.entered_sir then
      v_warn := v_warn || (a.antibiotic || ': instrument said ' || a.entered_sir || ', EUCAST breakpoint gives ' || v_sir);
    end if;
  end loop;

  if org.code is not null then
    -- 2. intrinsic resistance
    for a in select * from public.micro_ast where isolate_id = p_isolate and public.micro_is_intrinsic(org.code, antibiotic) loop
      if a.reported_sir = 'S' then v_warn := v_warn || (a.antibiotic || ' tested susceptible but ' || org.name || ' is intrinsically resistant: check identification and test'); end if;
      update public.micro_ast set reported_sir = 'R', rule = 'intrinsic resistance (EUCAST expected phenotype)' where id = a.id;
    end loop;
    select coalesce(jsonb_object_agg(antibiotic, reported_sir), '{}') into v_rep from public.micro_ast where isolate_id = p_isolate and reported_sir is not null;

    -- 3. expert rules
    if org.bp_group = 'STA' then
      v_mr := coalesce(v_rep->>'FOX' = 'R', false) or coalesce(v_rep->>'OXA' = 'R', false) or coalesce(iso.phenotype->>'meca' = '+', false) or coalesce(iso.phenotype->>'pbp2a' = '+', false);
      if v_mr then
        v_flags := v_flags || case when org.code = 'sau' then 'MRSA' else 'MRCoNS' end;
        update public.micro_ast set reported_sir = 'R', rule = 'expert rule: methicillin resistant, beta-lactams resistant (except anti-MRSA cephalosporins)'
         where isolate_id = p_isolate and antibiotic in ('PEN', 'AMP', 'AMX', 'AMC', 'SAM', 'TZP', 'OXA', 'FOX', 'CXM', 'CTX', 'CRO', 'CAZ', 'FEP', 'ETP', 'IPM', 'MEM') and coalesce(reported_sir, '') <> 'R';
      end if;
      if iso.phenotype->>'beta_lactamase' = '+' then
        update public.micro_ast set reported_sir = 'R', rule = 'expert rule: penicillinase producer' where isolate_id = p_isolate and antibiotic in ('PEN', 'AMP', 'AMX') and coalesce(reported_sir, '') <> 'R';
      end if;
      if org.code = 'sau' and v_rep->>'VAN' = 'R' then v_flags := array_append(v_flags, 'VRSA'::text); end if;
    end if;
    if org.bp_group in ('STA', 'SAG', 'SPN') and iso.phenotype->>'d_test' = '+' then
      v_flags := array_append(v_flags, 'iMLSB'::text);
      update public.micro_ast set reported_sir = 'R', rule = 'expert rule: inducible clindamycin resistance (D-test positive)' where isolate_id = p_isolate and antibiotic = 'CLI';
    end if;
    if org.family = 'EBC' then
      if iso.phenotype->>'esbl' = '+' then v_flags := array_append(v_flags, 'ESBL'::text);
      elsif coalesce(v_rep->>'CTX', v_rep->>'CRO', '') in ('I', 'R') or v_rep->>'CRO' in ('I', 'R') or v_rep->>'CAZ' in ('I', 'R') or v_rep->>'FEP' in ('I', 'R') then
        v_flags := v_flags || case when iso.phenotype->>'esbl' = '-' then 'AmpC probable' else 'ESBL probable' end;
      end if;
      if v_rep->>'MEM' in ('I', 'R') or v_rep->>'ETP' in ('I', 'R') or (v_rep->>'IPM' in ('I', 'R') and org.code not in ('mmo', 'pmi', 'pvu', 'pr-', 'pst', 'pre', 'prv')) then
        v_flags := array_append(v_flags, 'CRE'::text);
      end if;
      if iso.phenotype->>'carbapenemase' = '+' then v_flags := array_append(v_flags, 'CPE'::text); end if;
    end if;
    if org.bp_group = 'ACI' and (v_rep->>'IPM' = 'R' or v_rep->>'MEM' = 'R') then v_flags := array_append(v_flags, 'CRAB'::text); end if;
    if org.code = 'pae' and (v_rep->>'IPM' = 'R' or v_rep->>'MEM' = 'R') then v_flags := array_append(v_flags, 'CRPA'::text); end if;
    if org.bp_group = 'ENC' and v_rep->>'VAN' = 'R' then v_flags := array_append(v_flags, 'VRE'::text); end if;
    if org.code = 'spn' and v_rep->>'PEN' in ('I', 'R') then v_flags := array_append(v_flags, 'PNSP'::text); end if;
    if org.code in ('sat', 'saa') and v_rep->>'CRO' = 'R' then v_flags := array_append(v_flags, 'Ceftriaxone-resistant typhoid'::text); end if;

    -- 4. MDR / XDR / PDR (Magiorakos 2012)
    select coalesce(jsonb_object_agg(antibiotic, reported_sir), '{}') into v_rep from public.micro_ast where isolate_id = p_isolate and reported_sir is not null;
    for c in select * from public.micro_mdr_categories m where m.bp_group = org.bp_group and (m.organism_code is null or m.organism_code = org.code) loop
      v_total := v_total + 1;
      select array_agg(x) into v_ns from unnest(c.antibiotics) x where not public.micro_is_intrinsic(org.code, x);
      if v_ns is null then v_total := v_total - 1; continue; end if;   -- whole category intrinsic: excluded
      if exists (select 1 from unnest(v_ns) x where v_rep ? x) then
        v_avail := v_avail + 1;
        if exists (select 1 from unnest(v_ns) x where v_rep->>x = 'R') then
          v_aff := v_aff + 1;
          v_detail := v_detail || jsonb_build_object('category', c.category, 'non_susceptible', true);
        else
          v_detail := v_detail || jsonb_build_object('category', c.category, 'non_susceptible', false);
        end if;
        if exists (select 1 from unnest(v_ns) x where not (v_rep ? x) or v_rep->>x in ('S', 'I')) then v_all_ns := false; end if;
      else
        v_all_ns := false;
      end if;
    end loop;
    if v_total > 0 then
      v_class := case
        when v_avail = v_total and v_all_ns then 'PDR'
        when v_avail >= ceil(v_total / 2.0) and v_total - v_aff <= 2 then 'XDR'
        when v_aff >= 3 and v_avail - v_aff <= 2 and v_avail < v_total then 'possible XDR'   -- Magiorakos: not every category tested
        when v_aff >= 3 or (org.code = 'sau' and v_mr) then 'MDR'
        when v_avail < ceil(v_total / 2.0) and v_aff < 3 then 'insufficient'
        else 'none' end;
      if v_class in ('MDR', 'XDR', 'PDR') then v_flags := v_flags || v_class; elsif v_class = 'possible XDR' then v_flags := v_flags || array['MDR', 'possible XDR']; end if;
    end if;
  end if;

  -- 5. onset: hospital-onset when the specimen was taken on day 3 or later of an admission
  begin
    execute 'select max(left(to_jsonb(a)->>''admission_date'', 10)::date) from public.admissions a
              where (to_jsonb(a)->>''patient_id'') = $1 and left(to_jsonb(a)->>''admission_date'', 10)::date <= $2
                and coalesce(left(nullif(coalesce(to_jsonb(a)->>''discharge_date'', to_jsonb(a)->>''discharged_at''), ''''), 10)::date, $2) >= $2'
      into v_adm using iso.patient_id::text, iso.specimen_date;
  exception when others then v_adm := null;
  end;
  v_onset := coalesce(iso.onset_override, case when v_adm is not null and iso.specimen_date - v_adm >= 2 then 'hospital' else 'community' end);

  update public.micro_isolates set flags = v_flags, warnings = v_warn, mdr_class = v_class,
         mdr_detail = jsonb_build_object('categories_total', v_total, 'categories_tested', v_avail, 'categories_non_susceptible', v_aff, 'categories', v_detail),
         onset = v_onset, updated_at = now()
   where id = p_isolate;
  perform set_config('app.micro_refresh', '', true);

  -- 6. alert infection control for new priority resistance
  v_critical := array(select f from unnest(v_flags) f where f in ('MRSA', 'VRSA', 'CRE', 'CPE', 'CRAB', 'CRPA', 'VRE', 'XDR', 'possible XDR', 'PDR', 'Ceftriaxone-resistant typhoid') and not f = any(coalesce(v_old, '{}')));
  if cardinality(v_critical) > 0 then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', $2, $3, ''/microbiology'', $4)'
        using iso.hospital_id, 'Resistant organism: ' || array_to_string(v_critical, ', '),
              coalesce(org.name, iso.organism_name) || ' from ' || iso.specimen_type || coalesce(' (' || iso.ward || ')', '') || ' — apply contact precautions and review antibiotics',
              jsonb_build_object('isolate_id', iso.id, 'patient_id', iso.patient_id, 'flags', v_critical);
    exception when others then null;
    end;
  end if;
end $$;

create or replace function public.micro_isolates_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare o public.micro_organisms;
begin
  new.updated_at := now();
  if coalesce(trim(new.organism_name), '') = '' and new.organism_code is not null then
    select name into new.organism_name from public.micro_organisms where code = new.organism_code;
  end if;
  if new.organism_code is null and coalesce(trim(new.organism_name), '') <> '' then
    select * into o from public.micro_organisms where lower(name) = lower(trim(new.organism_name)) or lower(trim(new.organism_name)) = any(synonyms) limit 1;
    new.organism_code := o.code;
  end if;
  if coalesce(trim(new.organism_name), '') = '' then raise exception 'Give the organism'; end if;
  if new.specimen_date > current_date then raise exception 'The specimen date cannot be in the future'; end if;
  if not exists (select 1 from public.micro_specimen_types where code = new.specimen_type) then new.specimen_type := 'other'; end if;
  if tg_op = 'UPDATE' and old.status = 'final' and coalesce(current_setting('app.micro_refresh', true), '') <> 'on'
     and (new.organism_code, new.specimen_type, new.specimen_date) is distinct from (old.organism_code, old.specimen_type, old.specimen_date) then
    raise exception 'This isolate is final; amend it by setting it back to preliminary with a note';
  end if;
  return new;
end $$;
drop trigger if exists trg_micro_isolates_before on public.micro_isolates;
create trigger trg_micro_isolates_before before insert or update on public.micro_isolates for each row execute function public.micro_isolates_before();

create or replace function public.micro_isolates_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.micro_refresh', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' or (new.organism_code, new.specimen_type, new.phenotype, new.onset_override, new.patient_id, new.specimen_date)
                         is distinct from (old.organism_code, old.specimen_type, old.phenotype, old.onset_override, old.patient_id, old.specimen_date) then
    perform public.micro_isolate_refresh(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_micro_isolates_after on public.micro_isolates;
create trigger trg_micro_isolates_after after insert or update on public.micro_isolates for each row execute function public.micro_isolates_after();

create or replace function public.micro_ast_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.micro_refresh', true), '') = 'on' then return null; end if;
  perform public.micro_isolate_refresh(coalesce(new.isolate_id, old.isolate_id));
  return null;
end $$;
drop trigger if exists trg_micro_ast_after on public.micro_ast;
create trigger trg_micro_ast_after after insert or update or delete on public.micro_ast for each row execute function public.micro_ast_after();

-- ================================================================= cumulative antibiogram (first isolate per patient per organism)
create or replace function public.micro_antibiogram(p_hospital uuid, p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  with iso as (
    select i.*, row_number() over (partition by coalesce(i.patient_id::text, i.id::text), i.organism_code order by i.specimen_date, i.created_at) as rn
      from public.micro_isolates i
     where i.hospital_id = p_hospital and i.specimen_date between p_from and p_to and i.organism_code is not null
       and (p_filters->>'ward' is null or i.ward = p_filters->>'ward')
       and (p_filters->>'specimen_type' is null or i.specimen_type = p_filters->>'specimen_type')
       and (p_filters->>'onset' is null or i.onset = p_filters->>'onset')
       and (p_filters->>'ward_type' is null or i.ward_type = p_filters->>'ward_type')
  ), firsts as (select * from iso where rn = 1 or coalesce((p_filters->>'all_isolates')::boolean, false)),
  cells as (
    select f.organism_code, a.antibiotic, count(*) n,
           count(*) filter (where a.reported_sir = 'S') s, count(*) filter (where a.reported_sir = 'I') i, count(*) filter (where a.reported_sir = 'R') r
      from firsts f join public.micro_ast a on a.isolate_id = f.id
     where a.reported_sir is not null and not public.micro_is_intrinsic(f.organism_code, a.antibiotic)
     group by 1, 2
  ), orgs as (select organism_code, count(*) isolates from firsts group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'organism_code', o.organism_code, 'organism', mo.name, 'isolates', o.isolates, 'low_n', o.isolates < 30,
           'antibiotics', (select coalesce(jsonb_object_agg(c.antibiotic, jsonb_build_object('n', c.n, 's', c.s, 'i', c.i, 'r', c.r,
                                     'pct_s', round(100.0 * c.s / c.n), 'pct_si', round(100.0 * (c.s + c.i) / c.n))), '{}') from cells c where c.organism_code = o.organism_code))
         order by o.isolates desc), '[]'::jsonb)
    into v from orgs o join public.micro_organisms mo on mo.code = o.organism_code;
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'filters', p_filters, 'guideline', 'EUCAST 16.1',
                            'method', 'First isolate per patient per organism (CLSI M39); intrinsic resistance excluded; I = susceptible, increased exposure',
                            'organisms', v);
end $$;

-- ================================================================= cluster signals (same organism + resistance on one ward)
create or replace function public.micro_cluster_alerts(p_hospital uuid, p_days int default 14, p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  with marked as (
    select i.*, coalesce((select f from unnest(i.flags) f where f in ('CPE', 'CRE', 'CRAB', 'CRPA', 'VRE', 'MRSA', 'ESBL', 'ESBL probable') order by array_position(array['CPE', 'CRE', 'CRAB', 'CRPA', 'VRE', 'MRSA', 'ESBL', 'ESBL probable'], f) limit 1), 'any') pattern
      from public.micro_isolates i
     where i.hospital_id = p_hospital and i.organism_code is not null and coalesce(i.ward, '') <> '' and i.specimen_date between p_as_of - 90 - p_days and p_as_of
  ), recent as (
    select ward, organism_code, pattern, count(distinct coalesce(patient_id::text, id::text)) patients, min(specimen_date) first_date, max(specimen_date) last_date,
           count(*) filter (where onset = 'hospital') hospital_onset
      from marked where specimen_date > p_as_of - p_days group by 1, 2, 3
  ), baseline as (
    select ward, organism_code, pattern, count(distinct coalesce(patient_id::text, id::text)) * p_days / 90.0 expected
      from marked where specimen_date <= p_as_of - p_days group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object('ward', r.ward, 'organism_code', r.organism_code, 'organism', o.name, 'pattern', r.pattern,
                                               'patients', r.patients, 'hospital_onset', r.hospital_onset, 'first_date', r.first_date, 'last_date', r.last_date,
                                               'expected', round(coalesce(b.expected, 0), 1)) order by r.patients desc), '[]'::jsonb)
    into v
    from recent r join public.micro_organisms o on o.code = r.organism_code
    left join baseline b on b.ward = r.ward and b.organism_code = r.organism_code and b.pattern = r.pattern
   where r.patients >= 3 and r.patients >= 2 * coalesce(b.expected, 0) and (r.pattern <> 'any' or r.hospital_onset >= 2);
  return v;
end $$;

-- ================================================================= WHONET export
create or replace function public.micro_whonet_rows(p_hospital uuid, p_from date, p_to date, p_identifiable boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'PATIENT_ID', case when p_identifiable then coalesce(pj->>'patient_number', i.patient_id::text) else md5(coalesce(i.patient_id::text, i.id::text)) end,
           'SEX', upper(left(coalesce(pj->>'gender', pj->>'sex', ''), 1)),
           'AGE', nullif(substring(coalesce(pj->>'age', '') from '^\s*([0-9]+)'), ''),
           'DATE_BIRTH', case when p_identifiable then pj->>'date_of_birth' end,
           'WARD', i.ward, 'WARD_TYPE', i.ward_type, 'SPEC_NUM', i.specimen_no, 'SPEC_DATE', to_char(i.specimen_date, 'YYYY-MM-DD'),
           'SPEC_TYPE', st.whonet_code, 'ORGANISM', i.organism_code, 'ORIGIN', case i.onset when 'hospital' then 'h' when 'community' then 'c' end,
           'ESBL', i.phenotype->>'esbl', 'BETA_LACT', i.phenotype->>'beta_lactamase', 'MRSA', case when 'MRSA' = any(i.flags) then '+' end,
           'INDUC_CLI', i.phenotype->>'d_test', 'CARBAPENEM', i.phenotype->>'carbapenemase', 'COMMENT', array_to_string(i.flags, ' '),
           'results', (select coalesce(jsonb_agg(jsonb_build_object(
                         'field', a.antibiotic || '_E' || case a.method when 'disk' then 'D' || coalesce(ab.whonet_disk, '') when 'etest' then 'E' else 'M' end,
                         'value', case when a.method = 'sir' then a.reported_sir
                                       else coalesce(nullif(a.comparator, '='), '') || case when a.value::text like '%.%' then rtrim(rtrim(a.value::text, '0'), '.') else a.value::text end end)), '[]')
                         from public.micro_ast a left join public.micro_antibiotics ab on ab.code = a.antibiotic
                        where a.isolate_id = i.id and (a.value is not null or a.method = 'sir'))) order by i.specimen_date), '[]'::jsonb)
    into v
    from public.micro_isolates i
    left join lateral (select to_jsonb(p) pj from public.patients p where p.id = i.patient_id) pp on true
    left join public.micro_specimen_types st on st.code = i.specimen_type
   where i.hospital_id = p_hospital and i.specimen_date between p_from and p_to and i.organism_code is not null;
  return v;
end $$;

-- ================================================================= instrument import
/**
 * p_rows: [{ specimen_no, patient_number | patient_id, specimen_type, specimen_date, ward, organism, results: [{ code, method, value, sir }] }]
 * Codes go through the hospital's instrument map, then WHONET code, then name / alias. Unmapped codes are returned, not guessed.
 */
create or replace function public.micro_import(p_hospital uuid, p_instrument text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_j jsonb; res_j jsonb; v_org text; v_abx text; v_pat uuid; v_iso uuid; v_spec text; v_created int := 0; v_updated int := 0;
        v_unmapped jsonb := '[]'::jsonb; v_nopat jsonb := '[]'::jsonb; v_skipped int := 0; v_ext text; v_method text;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  for row_j in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_ext := trim(coalesce(row_j->>'organism', ''));
    select internal_code into v_org from public.micro_instrument_maps where hospital_id = p_hospital and instrument = p_instrument and kind = 'organism' and lower(external_code) = lower(v_ext);
    if v_org is null then
      select code into v_org from public.micro_organisms where lower(code) = lower(v_ext) or lower(name) = lower(v_ext) or lower(v_ext) = any(synonyms) limit 1;
    end if;
    if v_org is null then
      v_unmapped := v_unmapped || jsonb_build_object('kind', 'organism', 'code', v_ext); v_skipped := v_skipped + 1; continue;
    end if;
    v_pat := null;
    if row_j ? 'patient_id' and nullif(row_j->>'patient_id', '') is not null then v_pat := (row_j->>'patient_id')::uuid;
    elsif nullif(row_j->>'patient_number', '') is not null then
      select p.id into v_pat from public.patients p where p.hospital_id::text = p_hospital::text and (to_jsonb(p)->>'patient_number') = row_j->>'patient_number' limit 1;
      if v_pat is null then v_nopat := v_nopat || to_jsonb(row_j->>'patient_number'); end if;
    end if;
    v_spec := lower(coalesce(row_j->>'specimen_type', 'other'));
    select coalesce((select internal_code from public.micro_instrument_maps where hospital_id = p_hospital and instrument = p_instrument and kind = 'specimen' and lower(external_code) = v_spec),
                    (select code from public.micro_specimen_types where code = v_spec or whonet_code = v_spec or lower(label) = v_spec limit 1), 'other') into v_spec;
    select id into v_iso from public.micro_isolates where hospital_id = p_hospital and specimen_no = nullif(row_j->>'specimen_no', '') and organism_code = v_org;
    perform set_config('app.micro_refresh', 'on', true);
    if v_iso is null then
      insert into public.micro_isolates(hospital_id, patient_id, specimen_no, specimen_type, specimen_date, ward, organism_code, organism_name, source, instrument)
      values (p_hospital, v_pat, nullif(row_j->>'specimen_no', ''), v_spec, coalesce(nullif(row_j->>'specimen_date', '')::date, current_date), nullif(row_j->>'ward', ''),
              v_org, (select name from public.micro_organisms where code = v_org), 'import', p_instrument)
      returning id into v_iso;
      v_created := v_created + 1;
    else
      v_updated := v_updated + 1;
    end if;
    for res_j in select * from jsonb_array_elements(coalesce(row_j->'results', '[]'::jsonb)) loop
      v_ext := trim(coalesce(res_j->>'code', ''));
      select internal_code into v_abx from public.micro_instrument_maps where hospital_id = p_hospital and instrument = p_instrument and kind = 'antibiotic' and lower(external_code) = lower(v_ext);
      if v_abx is null then
        select code into v_abx from public.micro_antibiotics where code = upper(v_ext) or lower(name) = lower(v_ext) or lower(v_ext) = any(aliases) limit 1;
      end if;
      if v_abx is null then
        if not v_unmapped @> jsonb_build_array(jsonb_build_object('kind', 'antibiotic', 'code', v_ext)) then v_unmapped := v_unmapped || jsonb_build_object('kind', 'antibiotic', 'code', v_ext); end if;
        continue;
      end if;
      v_method := coalesce(nullif(res_j->>'method', ''), case when nullif(res_j->>'value', '') is null then 'sir' else 'mic' end);
      insert into public.micro_ast(isolate_id, hospital_id, antibiotic, method, raw_value, entered_sir)
      values (v_iso, p_hospital, v_abx, v_method, nullif(res_j->>'value', ''), nullif(upper(left(coalesce(res_j->>'sir', ''), 1)), ''))
      on conflict (isolate_id, antibiotic) do update set method = excluded.method, raw_value = excluded.raw_value, entered_sir = excluded.entered_sir;
    end loop;
    perform set_config('app.micro_refresh', '', true);
    perform public.micro_isolate_refresh(v_iso);
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'unmapped', v_unmapped, 'patients_not_found', v_nopat);
end $$;

-- ================================================================= old microbiology_results rows -> isolates
create or replace function public.micro_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create or replace function public.micro_sync_legacy(p_row jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_iso uuid; v_org text; k text; val jsonb; v_abx text; v_sir text; v_spec text; v_name text := trim(coalesce(p_row->>'organism_identified', ''));
        v_cols text[] := array['amoxicillin','amox_clav','ampicillin','cotrimoxazole','ciprofloxacin','levofloxacin','norfloxacin','gentamicin','amikacin','ceftriaxone','cefuroxime',
                               'ceftazidime','cefepime','meropenem','imipenem','piperacillin_tazo','nitrofurantoin','tetracycline','doxycycline','clindamycin','erythromycin',
                               'azithromycin','vancomycin','linezolid','chloramphenicol','metronidazole'];
begin
  if v_name = '' or lower(v_name) ~ '^(no growth|none|nil|sterile|mixed growth|normal flora)' then return null; end if;
  select code into v_org from public.micro_organisms where lower(name) = lower(v_name) or lower(v_name) = any(synonyms) or lower(code) = lower(v_name) limit 1;
  v_spec := lower(coalesce(p_row->>'sample_type', ''));
  v_spec := case when v_spec ~ 'blood' then 'blood' when v_spec ~ 'urine|msu|csu' then 'urine' when v_spec ~ 'sputum' then 'sputum' when v_spec ~ 'csf|spinal' then 'csf'
                 when v_spec ~ 'wound|pus|swab' then 'wound' when v_spec ~ 'stool|faec' then 'stool' when v_spec ~ 'throat' then 'throat' when v_spec ~ 'hvs|genital|urethral' then 'genital'
                 when v_spec ~ 'fluid|aspirate' then 'body_fluid' when v_spec ~ 'tip|catheter' then 'catheter' else 'other' end;
  perform set_config('app.micro_refresh', 'on', true);
  insert into public.micro_isolates(hospital_id, patient_id, visit_id, legacy_result_id, specimen_type, specimen_date, ward, organism_code, organism_name, phenotype, source, status)
  values ((p_row->>'hospital_id')::uuid, public.micro_uuid(p_row->>'patient_id'), public.micro_uuid(p_row->>'visit_id'), p_row->>'id', v_spec,
          least(coalesce(nullif(left(p_row->>'collection_date', 10), '')::date, nullif(left(p_row->>'created_at', 10), '')::date, current_date), current_date),
          nullif(p_row->>'ward_department', ''), v_org, v_name,
          jsonb_strip_nulls(jsonb_build_object('esbl', case when (p_row->>'esbl')::boolean then '+' end, 'meca', case when (p_row->>'mrsa')::boolean then '+' end)),
          'legacy', 'final')
  on conflict (legacy_result_id) do update set organism_code = excluded.organism_code, organism_name = excluded.organism_name, specimen_type = excluded.specimen_type,
          ward = excluded.ward, phenotype = excluded.phenotype
  returning id into v_iso;
  delete from public.micro_ast where isolate_id = v_iso;
  foreach k in array v_cols loop
    v_sir := upper(left(coalesce(p_row->>k, ''), 1));
    if v_sir in ('S', 'I', 'R') then
      select code into v_abx from public.micro_antibiotics where k = any(aliases) or lower(name) = replace(k, '_', ' ') limit 1;
      if v_abx is not null then insert into public.micro_ast(isolate_id, hospital_id, antibiotic, method, entered_sir) values (v_iso, (p_row->>'hospital_id')::uuid, v_abx, 'sir', v_sir) on conflict do nothing; end if;
    end if;
  end loop;
  for k, val in select * from jsonb_each(case when jsonb_typeof(p_row->'susceptibility_profile') = 'object' then p_row->'susceptibility_profile' else '{}'::jsonb end) loop
    v_sir := upper(left(coalesce(val->>'sir', case when jsonb_typeof(val) = 'string' then val #>> '{}' end, ''), 1));
    if v_sir in ('S', 'I', 'R') then
      select code into v_abx from public.micro_antibiotics where lower(k) = any(aliases) or lower(name) = lower(replace(k, '_', ' ')) or lower(coalesce(val->>'label', '')) = lower(name) or code = upper(k) limit 1;
      if v_abx is not null then insert into public.micro_ast(isolate_id, hospital_id, antibiotic, method, entered_sir) values (v_iso, (p_row->>'hospital_id')::uuid, v_abx, 'sir', v_sir) on conflict do nothing; end if;
    end if;
  end loop;
  perform set_config('app.micro_refresh', '', true);
  perform public.micro_isolate_refresh(v_iso);
  return v_iso;
end $$;

create or replace function public.micro_legacy_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from public.micro_isolates where legacy_result_id = old.id::text; return null; end if;
  begin perform public.micro_sync_legacy(to_jsonb(new)); exception when others then raise warning 'microbiology sync skipped: %', sqlerrm; end;
  return null;
end $$;

do $$
declare r record;
begin
  if to_regclass('public.microbiology_results') is null then return; end if;
  drop trigger if exists trg_micro_legacy_after on public.microbiology_results;
  create trigger trg_micro_legacy_after after insert or update or delete on public.microbiology_results for each row execute function public.micro_legacy_after();
  for r in execute 'select to_jsonb(m) j from public.microbiology_results m' loop
    begin perform public.micro_sync_legacy(r.j); exception when others then raise notice 'skipped old result %: %', r.j->>'id', sqlerrm; end;
  end loop;
end $$;

-- ================================================================= security
alter table public.micro_organisms enable row level security;
alter table public.micro_antibiotics enable row level security;
alter table public.micro_breakpoints enable row level security;
alter table public.micro_intrinsic enable row level security;
alter table public.micro_mdr_categories enable row level security;
alter table public.micro_specimen_types enable row level security;
alter table public.micro_isolates enable row level security;
alter table public.micro_ast enable row level security;
alter table public.micro_instrument_maps enable row level security;
do $$
declare t text;
begin
  foreach t in array array['micro_organisms', 'micro_antibiotics', 'micro_intrinsic', 'micro_mdr_categories', 'micro_specimen_types'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['micro_isolates', 'micro_ast', 'micro_instrument_maps'] loop
    execute format('drop policy if exists %I on public.%I', t || '_clinical', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id))', t || '_clinical', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists micro_breakpoints_read on public.micro_breakpoints;
drop policy if exists micro_breakpoints_write on public.micro_breakpoints;
create policy micro_breakpoints_read on public.micro_breakpoints for select to authenticated using (hospital_id is null or public.clin_can_access(hospital_id));
create policy micro_breakpoints_write on public.micro_breakpoints for all to authenticated
  using (hospital_id is not null and public.clin_can_access(hospital_id)) with check (hospital_id is not null and public.clin_can_access(hospital_id));
revoke all on public.micro_breakpoints from anon;
grant select, insert, update, delete on public.micro_breakpoints to authenticated;
grant all on public.micro_breakpoints to service_role;
-- interpretation fields are set by the database only
revoke update on public.micro_ast from authenticated;
grant update (method, raw_value, entered_sir, potency) on public.micro_ast to authenticated;
revoke update on public.micro_isolates from authenticated;
grant update (specimen_no, specimen_type, specimen_date, ward, ward_type, organism_code, organism_name, phenotype, onset_override, status, notes, patient_id, visit_id) on public.micro_isolates to authenticated;

revoke execute on function public.micro_ast_before(), public.micro_isolates_before(), public.micro_isolates_after(), public.micro_ast_after(), public.micro_legacy_after(),
  public.micro_isolate_refresh(uuid), public.micro_sync_legacy(jsonb), public.micro_breakpoint_for(uuid, text, text, text, text), public.micro_is_intrinsic(text, text)
  from public, anon, authenticated;
revoke execute on function public.micro_antibiogram(uuid, date, date, jsonb), public.micro_cluster_alerts(uuid, integer, date), public.micro_whonet_rows(uuid, date, date, boolean),
  public.micro_import(uuid, text, jsonb) from public, anon;
grant execute on function public.micro_antibiogram(uuid, date, date, jsonb), public.micro_cluster_alerts(uuid, integer, date), public.micro_whonet_rows(uuid, date, date, boolean),
  public.micro_import(uuid, text, jsonb), public.micro_parse_value(text), public.micro_sir(text, text, numeric, numeric, numeric) to authenticated, service_role;
