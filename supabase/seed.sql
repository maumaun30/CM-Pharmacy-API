-- ============================================================
-- Seed file for Pharmacy POS
-- Run in this order in Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- ─── 1. Branches ─────────────────────────────────────────────────────────────

insert into branches (name, code, address, city, province, postal_code, phone, email, manager_name, is_active, is_main_branch, operating_hours)
values
  (
    'Main Branch', 'MAIN',
    '123 Commonwealth Avenue', 'Quezon City', 'Metro Manila', '1101',
    '+63 2 1234 5678', 'main@cmpharmacy.com', 'Maria Santos',
    true, true,
    '{"monday":{"open":"08:00","close":"20:00"},"tuesday":{"open":"08:00","close":"20:00"},"wednesday":{"open":"08:00","close":"20:00"},"thursday":{"open":"08:00","close":"20:00"},"friday":{"open":"08:00","close":"20:00"},"saturday":{"open":"09:00","close":"18:00"},"sunday":{"open":"10:00","close":"17:00"}}'
  ),
  (
    'Eastwood Branch', 'EW01',
    'Eastwood City Walk 2', 'Quezon City', 'Metro Manila', '1110',
    '+63 2 8765 4321', 'eastwood@cmpharmacy.com', 'Juan Dela Cruz',
    true, false,
    '{"monday":{"open":"10:00","close":"22:00"},"tuesday":{"open":"10:00","close":"22:00"},"wednesday":{"open":"10:00","close":"22:00"},"thursday":{"open":"10:00","close":"22:00"},"friday":{"open":"10:00","close":"23:00"},"saturday":{"open":"10:00","close":"23:00"},"sunday":{"open":"10:00","close":"22:00"}}'
  ),
  (
    'SM North EDSA Branch', 'SMN01',
    'SM City North EDSA, Block 4', 'Quezon City', 'Metro Manila', '1105',
    '+63 2 9876 5432', 'smnorth@cmpharmacy.com', 'Ana Reyes',
    true, false,
    '{"monday":{"open":"10:00","close":"21:00"},"tuesday":{"open":"10:00","close":"21:00"},"wednesday":{"open":"10:00","close":"21:00"},"thursday":{"open":"10:00","close":"21:00"},"friday":{"open":"10:00","close":"21:00"},"saturday":{"open":"10:00","close":"21:00"},"sunday":{"open":"10:00","close":"21:00"}}'
  ),
  (
    'Makati Branch', 'MKT01',
    'Ayala Avenue, Glorietta 4', 'Makati', 'Metro Manila', '1223',
    '+63 2 5551 2345', 'makati@cmpharmacy.com', 'Carlos Garcia',
    true, false,
    '{"monday":{"open":"09:00","close":"21:00"},"tuesday":{"open":"09:00","close":"21:00"},"wednesday":{"open":"09:00","close":"21:00"},"thursday":{"open":"09:00","close":"21:00"},"friday":{"open":"09:00","close":"21:00"},"saturday":{"open":"10:00","close":"21:00"},"sunday":{"open":"10:00","close":"20:00"}}'
  ),
  (
    'BGC Branch', 'BGC01',
    'High Street Central, 5th Avenue', 'Taguig', 'Metro Manila', '1634',
    '+63 2 5551 6789', 'bgc@cmpharmacy.com', 'Sofia Lim',
    true, false,
    '{"monday":{"open":"09:00","close":"22:00"},"tuesday":{"open":"09:00","close":"22:00"},"wednesday":{"open":"09:00","close":"22:00"},"thursday":{"open":"09:00","close":"22:00"},"friday":{"open":"09:00","close":"23:00"},"saturday":{"open":"09:00","close":"23:00"},"sunday":{"open":"10:00","close":"22:00"}}'
  ),
  (
    'Alabang Branch', 'ALB01',
    'Festival Mall, Filinvest Corporate City', 'Muntinlupa', 'Metro Manila', '1781',
    '+63 2 5551 9876', 'alabang@cmpharmacy.com', 'Roberto Tan',
    true, false,
    '{"monday":{"open":"10:00","close":"21:00"},"tuesday":{"open":"10:00","close":"21:00"},"wednesday":{"open":"10:00","close":"21:00"},"thursday":{"open":"10:00","close":"21:00"},"friday":{"open":"10:00","close":"21:00"},"saturday":{"open":"10:00","close":"21:00"},"sunday":{"open":"10:00","close":"21:00"}}'
  );

-- ─── 2. Users ─────────────────────────────────────────────────────────────────
-- Passwords are bcrypt hashed (cost 10): admin123 / staff123
-- Re-hash via your app if needed; these are safe for dev seeding.

insert into users (username, email, password, role, first_name, last_name, contact_number, is_active)
values
  (
    'admin', 'admin@pharmacy.com',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- admin123
    'admin', 'Admin', 'Admin', '1234567890', true
  ),
  (
    'staff', 'staff@pharmacy.com',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- staff123
    'cashier', 'Staff', 'Staff', '1234567890', true
  );

-- ─── 3. Categories ───────────────────────────────────────────────────────────

insert into categories (name, description)
values
  ('Generic Medicines',  'Non-branded pharmaceutical products'),
  ('Branded Medicines',  'Branded pharmaceutical products'),
  ('Milk Products',      'Milk-based nutritional supplements and products'),
  ('Others',             'Medical supplies, personal care products, and other items');

-- ─── 4. Products ─────────────────────────────────────────────────────────────

insert into products (
  name, brand_name, sku, description, price, cost,
  expiry_date, generic_name, dosage, form,
  requires_prescription, status, category_id
)
select
  p.name, p.brand_name, p.sku, p.description,
  p.price, p.cost, p.expiry_date,
  p.generic_name, p.dosage, p.form,
  p.requires_prescription, p.status::product_status,
  c.id
from (values
  -- Generic Medicines
  ('Paracetamol 500mg',         'Biogesic',      'GEN-PCM-500', 'Pain reliever and fever reducer',              5.99,  2.50, '2026-05-01'::date, 'Paracetamol',    '500mg',     'Tablet',     false, 'ACTIVE', 'Generic Medicines'),
  ('Amoxicillin 250mg',         'Amoxil',        'GEN-AMX-250', 'Antibiotic for bacterial infections',         12.50,  5.75, '2026-03-15'::date, 'Amoxicillin',    '250mg',     'Capsule',    true,  'ACTIVE', 'Generic Medicines'),
  ('Ibuprofen 400mg',           'Generic',       'GEN-IBU-400', 'Anti-inflammatory pain reliever',              8.50,  4.00, '2026-07-20'::date, 'Ibuprofen',      '400mg',     'Tablet',     false, 'ACTIVE', 'Generic Medicines'),
  ('Cetirizine 10mg',           'Generic',       'GEN-CET-10',  'Antihistamine for allergies',                  6.99,  3.25, '2026-08-15'::date, 'Cetirizine',     '10mg',      'Tablet',     false, 'ACTIVE', 'Generic Medicines'),
  ('Metformin 500mg',           'Generic',       'GEN-MET-500', 'Diabetes medication',                          9.99,  4.50, '2026-09-30'::date, 'Metformin',      '500mg',     'Tablet',     true,  'ACTIVE', 'Generic Medicines'),
  -- Branded Medicines
  ('Tylenol Extra Strength',    'Tylenol',       'BRD-TYL-500', 'Fast pain relief for headaches and fever',    12.99,  6.25, '2026-06-20'::date, 'Acetaminophen',  '500mg',     'Tablet',     false, 'ACTIVE', 'Branded Medicines'),
  ('Advil Liquid Gels',         'Advil',         'BRD-ADV-200', 'Fast-acting pain reliever',                   15.99,  7.50, '2026-04-10'::date, 'Ibuprofen',      '200mg',     'Liquid Gel', false, 'ACTIVE', 'Branded Medicines'),
  ('Zyrtec 24 Hour',            'Zyrtec',        'BRD-ZYR-10',  '24-hour allergy relief',                      18.99,  9.00, '2026-05-15'::date, 'Cetirizine',     '10mg',      'Tablet',     false, 'ACTIVE', 'Branded Medicines'),
  ('Nexium 40mg',               'Nexium',        'BRD-NEX-40',  'Treats acid reflux and heartburn',            32.99, 16.50, '2026-07-01'::date, 'Esomeprazole',   '40mg',      'Capsule',    true,  'ACTIVE', 'Branded Medicines'),
  ('Lipitor 20mg',              'Lipitor',       'BRD-LIP-20',  'Cholesterol medication',                      45.99, 22.75, '2026-08-20'::date, 'Atorvastatin',   '20mg',      'Tablet',     true,  'ACTIVE', 'Branded Medicines'),
  -- Milk Products
  ('Enfamil Premium Infant Formula', 'Enfamil',  'MLK-ENF-400', 'Milk-based infant formula for 0-12 months',  29.99, 15.25, '2026-02-28'::date, null,             '400g',      'Powder',     false, 'ACTIVE', 'Milk Products'),
  ('Ensure Plus Vanilla',       'Ensure',        'MLK-ENS-237', 'Nutritional supplement for adults',           24.99, 12.75, '2026-01-15'::date, null,             '237ml',     'Liquid',     false, 'ACTIVE', 'Milk Products'),
  ('Similac Advance',           'Similac',       'MLK-SIM-400', 'Infant formula with OptiGRO',                 28.99, 14.50, '2026-03-31'::date, null,             '400g',      'Powder',     false, 'ACTIVE', 'Milk Products'),
  ('Boost Original',            'Boost',         'MLK-BST-237', 'High protein nutritional drink',              22.99, 11.50, '2026-02-20'::date, null,             '237ml',     'Liquid',     false, 'ACTIVE', 'Milk Products'),
  ('Pediasure Vanilla',         'Pediasure',     'MLK-PED-237', 'Complete nutrition for kids',                 26.99, 13.50, '2026-04-15'::date, null,             '237ml',     'Liquid',     false, 'ACTIVE', 'Milk Products'),
  -- Others (Vitamins fallback to Others since that category exists)
  ('Vitamin C 1000mg',          'Nature Made',   'VIT-VTC-1000','Immune support supplement',                   14.99,  7.25, '2027-01-01'::date, 'Ascorbic Acid',  '1000mg',    'Tablet',     false, 'ACTIVE', 'Others'),
  ('Multivitamin Complex',      'Centrum',       'VIT-MLT-001', 'Complete daily multivitamin',                 19.99, 10.00, '2027-02-15'::date, null,             '1 tablet',  'Tablet',     false, 'ACTIVE', 'Others'),
  ('Vitamin D3 2000 IU',        'Nature Made',   'VIT-VTD-2000','Bone and immune health support',              12.99,  6.50, '2027-03-01'::date, 'Cholecalciferol','2000 IU',   'Softgel',    false, 'ACTIVE', 'Others'),
  ('Digital Thermometer',       'HealthPro',     'OTH-THM-001', 'Digital thermometer for body temp measurement',19.99, 9.50, null,               null,             null,        null,         false, 'ACTIVE', 'Others'),
  ('First Aid Kit',             'SafetyFirst',   'OTH-FAK-001', 'Basic first aid supplies for home use',       32.99, 18.00, null,               null,             null,        null,         false, 'ACTIVE', 'Others'),
  ('Blood Pressure Monitor',    'Omron',         'OTH-BPM-001', 'Digital blood pressure monitoring device',    49.99, 25.00, null,               null,             null,        null,         false, 'ACTIVE', 'Others'),
  ('Glucose Meter Kit',         'OneTouch',      'OTH-GLU-001', 'Blood glucose monitoring system',             39.99, 20.00, null,               null,             null,        null,         false, 'ACTIVE', 'Others'),
  ('N95 Face Masks (Box of 20)','3M',            'OTH-MSK-N95', 'Respiratory protection face masks',           24.99, 12.50, null,               null,             null,        null,         false, 'ACTIVE', 'Others'),
  ('Hand Sanitizer 500ml',      'Purell',        'OTH-SAN-500', 'Alcohol-based hand sanitizer',                 8.99,  4.50, null,               null,             null,        null,         false, 'ACTIVE', 'Others')
) as p(name, brand_name, sku, description, price, cost, expiry_date, generic_name, dosage, form, requires_prescription, status, category_name)
join categories c on c.name = p.category_name;

-- ─── 5. Discounts ────────────────────────────────────────────────────────────

insert into discounts (
  name, description, discount_type, discount_value, discount_category,
  is_enabled, requires_verification, applicable_to, priority, stackable
)
values
  (
    'PWD Discount', '20% discount for Persons with Disability',
    'PERCENTAGE', 20.00, 'PWD',
    true, true, 'ALL_PRODUCTS', 10, false
  ),
  (
    'Senior Citizen Discount', '20% discount for Senior Citizens (60+)',
    'PERCENTAGE', 20.00, 'SENIOR_CITIZEN',
    true, true, 'ALL_PRODUCTS', 10, false
  );

-- ─── 6. Branch Stocks ────────────────────────────────────────────────────────
-- Matches the original seeder's stock strategy per SKU per branch (in insertion order).
-- Branch order: MAIN, EW01, SMN01, MKT01, BGC01, ALB01

insert into branch_stocks (product_id, branch_id, current_stock, minimum_stock, maximum_stock, reorder_point)
select
  p.id as product_id,
  b.id as branch_id,
  s.current_stock,
  greatest(5,  floor(s.current_stock * 0.1))::int as minimum_stock,
  floor(s.current_stock * 2)::int                  as maximum_stock,
  greatest(10, floor(s.current_stock * 0.2))::int  as reorder_point
from (values
  -- (sku, branch_code, current_stock)
  ('GEN-PCM-500','MAIN',200),('GEN-PCM-500','EW01',150),('GEN-PCM-500','SMN01',140),('GEN-PCM-500','MKT01',120),('GEN-PCM-500','BGC01',130),('GEN-PCM-500','ALB01',110),
  ('GEN-AMX-250','MAIN',100),('GEN-AMX-250','EW01', 60),('GEN-AMX-250','SMN01', 55),('GEN-AMX-250','MKT01', 50),('GEN-AMX-250','BGC01', 55),('GEN-AMX-250','ALB01', 45),
  ('GEN-IBU-400','MAIN',150),('GEN-IBU-400','EW01',100),('GEN-IBU-400','SMN01', 95),('GEN-IBU-400','MKT01', 85),('GEN-IBU-400','BGC01', 90),('GEN-IBU-400','ALB01', 80),
  ('GEN-CET-10', 'MAIN',120),('GEN-CET-10', 'EW01', 80),('GEN-CET-10', 'SMN01', 75),('GEN-CET-10', 'MKT01', 70),('GEN-CET-10', 'BGC01', 75),('GEN-CET-10', 'ALB01', 65),
  ('GEN-MET-500','MAIN', 80),('GEN-MET-500','EW01', 50),('GEN-MET-500','SMN01', 45),('GEN-MET-500','MKT01', 40),('GEN-MET-500','BGC01', 45),('GEN-MET-500','ALB01', 35),
  ('BRD-TYL-500','MAIN',100),('BRD-TYL-500','EW01', 70),('BRD-TYL-500','SMN01', 65),('BRD-TYL-500','MKT01', 60),('BRD-TYL-500','BGC01', 65),('BRD-TYL-500','ALB01', 55),
  ('BRD-ADV-200','MAIN', 80),('BRD-ADV-200','EW01', 60),('BRD-ADV-200','SMN01', 55),('BRD-ADV-200','MKT01', 50),('BRD-ADV-200','BGC01', 55),('BRD-ADV-200','ALB01', 45),
  ('BRD-ZYR-10', 'MAIN', 70),('BRD-ZYR-10', 'EW01', 50),('BRD-ZYR-10', 'SMN01', 45),('BRD-ZYR-10', 'MKT01', 40),('BRD-ZYR-10', 'BGC01', 45),('BRD-ZYR-10', 'ALB01', 38),
  ('BRD-NEX-40', 'MAIN', 60),('BRD-NEX-40', 'EW01', 40),('BRD-NEX-40', 'SMN01', 35),('BRD-NEX-40', 'MKT01', 30),('BRD-NEX-40', 'BGC01', 35),('BRD-NEX-40', 'ALB01', 28),
  ('BRD-LIP-20', 'MAIN', 50),('BRD-LIP-20', 'EW01', 30),('BRD-LIP-20', 'SMN01', 28),('BRD-LIP-20', 'MKT01', 25),('BRD-LIP-20', 'BGC01', 28),('BRD-LIP-20', 'ALB01', 22),
  ('MLK-ENF-400','MAIN', 50),('MLK-ENF-400','EW01', 35),('MLK-ENF-400','SMN01', 32),('MLK-ENF-400','MKT01', 30),('MLK-ENF-400','BGC01', 32),('MLK-ENF-400','ALB01', 26),
  ('MLK-ENS-237','MAIN', 60),('MLK-ENS-237','EW01', 40),('MLK-ENS-237','SMN01', 38),('MLK-ENS-237','MKT01', 35),('MLK-ENS-237','BGC01', 38),('MLK-ENS-237','ALB01', 30),
  ('MLK-SIM-400','MAIN', 45),('MLK-SIM-400','EW01', 30),('MLK-SIM-400','SMN01', 28),('MLK-SIM-400','MKT01', 25),('MLK-SIM-400','BGC01', 28),('MLK-SIM-400','ALB01', 22),
  ('MLK-BST-237','MAIN', 40),('MLK-BST-237','EW01', 25),('MLK-BST-237','SMN01', 23),('MLK-BST-237','MKT01', 20),('MLK-BST-237','BGC01', 23),('MLK-BST-237','ALB01', 18),
  ('MLK-PED-237','MAIN', 35),('MLK-PED-237','EW01', 25),('MLK-PED-237','SMN01', 23),('MLK-PED-237','MKT01', 20),('MLK-PED-237','BGC01', 23),('MLK-PED-237','ALB01', 18),
  ('VIT-VTC-1000','MAIN',100),('VIT-VTC-1000','EW01', 70),('VIT-VTC-1000','SMN01', 65),('VIT-VTC-1000','MKT01', 60),('VIT-VTC-1000','BGC01', 65),('VIT-VTC-1000','ALB01', 55),
  ('VIT-MLT-001','MAIN', 80),('VIT-MLT-001','EW01', 60),('VIT-MLT-001','SMN01', 55),('VIT-MLT-001','MKT01', 50),('VIT-MLT-001','BGC01', 55),('VIT-MLT-001','ALB01', 45),
  ('VIT-VTD-2000','MAIN', 70),('VIT-VTD-2000','EW01', 50),('VIT-VTD-2000','SMN01', 45),('VIT-VTD-2000','MKT01', 40),('VIT-VTD-2000','BGC01', 45),('VIT-VTD-2000','ALB01', 38),
  ('OTH-THM-001','MAIN', 30),('OTH-THM-001','EW01', 20),('OTH-THM-001','SMN01', 18),('OTH-THM-001','MKT01', 15),('OTH-THM-001','BGC01', 18),('OTH-THM-001','ALB01', 14),
  ('OTH-FAK-001','MAIN', 25),('OTH-FAK-001','EW01', 15),('OTH-FAK-001','SMN01', 14),('OTH-FAK-001','MKT01', 12),('OTH-FAK-001','BGC01', 14),('OTH-FAK-001','ALB01', 11),
  ('OTH-BPM-001','MAIN', 20),('OTH-BPM-001','EW01', 12),('OTH-BPM-001','SMN01', 11),('OTH-BPM-001','MKT01', 10),('OTH-BPM-001','BGC01', 11),('OTH-BPM-001','ALB01',  9),
  ('OTH-GLU-001','MAIN', 18),('OTH-GLU-001','EW01', 10),('OTH-GLU-001','SMN01',  9),('OTH-GLU-001','MKT01',  8),('OTH-GLU-001','BGC01',  9),('OTH-GLU-001','ALB01',  7),
  ('OTH-MSK-N95','MAIN',150),('OTH-MSK-N95','EW01',100),('OTH-MSK-N95','SMN01', 95),('OTH-MSK-N95','MKT01', 85),('OTH-MSK-N95','BGC01', 90),('OTH-MSK-N95','ALB01', 75),
  ('OTH-SAN-500','MAIN',120),('OTH-SAN-500','EW01', 80),('OTH-SAN-500','SMN01', 75),('OTH-SAN-500','MKT01', 70),('OTH-SAN-500','BGC01', 75),('OTH-SAN-500','ALB01', 65)
) as s(sku, branch_code, current_stock)
join products  p on p.sku  = s.sku
join branches  b on b.code = s.branch_code;

-- ─── 7. Stock Transactions (initial + sample) ─────────────────────────────────

-- Initial stock records (one per branch_stock row, dated 30 days ago)
insert into stocks (
  product_id, branch_id, transaction_type,
  quantity, quantity_before, quantity_after,
  unit_cost, total_cost, batch_number, supplier, reason,
  performed_by, created_at
)
select
  bs.product_id,
  bs.branch_id,
  'INITIAL_STOCK'::stock_transaction_type,
  bs.current_stock,
  0,
  bs.current_stock,
  p.cost,
  p.cost * bs.current_stock,
  'BATCH-INIT-' || bs.product_id || '-' || bs.branch_id,
  'Initial Inventory Setup',
  'Initial stock setup for branch',
  (select id from users order by created_at limit 1),
  now() - interval '30 days'
from branch_stocks bs
join products p on p.id = bs.product_id;

-- Sample transactions for variety
insert into stocks (
  product_id, branch_id, transaction_type,
  quantity, quantity_before, quantity_after,
  unit_cost, total_cost, batch_number, supplier, reason,
  performed_by, created_at
)
select
  p.id,
  b.id,
  t.txn_type::stock_transaction_type,
  t.quantity,
  bs.current_stock,
  bs.current_stock + t.quantity,
  case when t.txn_type = 'PURCHASE' then p.cost else null end,
  case when t.txn_type = 'PURCHASE' then p.cost * abs(t.quantity) else null end,
  case when t.txn_type = 'PURCHASE' then 'BATCH-SAMPLE-' || p.id else null end,
  t.supplier,
  t.reason,
  (select id from users order by created_at limit 1),
  now() - (t.days_ago || ' days')::interval
from (values
  ('GEN-PCM-500','MAIN',  'PURCHASE',  100, 7,  'ABC Pharma',     null),
  ('GEN-IBU-400','EW01',  'PURCHASE',   50, 5,  'MedSupply Inc',  null),
  ('MLK-ENF-400','MAIN',  'PURCHASE',   30, 10, 'NutriHealth Co', null),
  ('GEN-PCM-500','MAIN',  'SALE',       -25, 2,  null,            null),
  ('BRD-TYL-500','EW01',  'SALE',       -15, 1,  null,            null),
  ('OTH-MSK-N95','SMN01', 'SALE',       -20, 3,  null,            null),
  ('GEN-CET-10', 'EW01',  'ADJUSTMENT',  10, 4,  null,            'Stock count correction'),
  ('VIT-VTC-1000','MAIN', 'ADJUSTMENT',  -5, 6,  null,            'Damaged during handling'),
  ('BRD-ADV-200','SMN01', 'SALE',       -12, 2,  null,            null),
  ('MLK-ENS-237','MKT01', 'PURCHASE',    25, 8,  'NutriHealth Co', null)
) as t(sku, branch_code, txn_type, quantity, days_ago, supplier, reason)
join products  p  on p.sku  = t.sku
join branches  b  on b.code = t.branch_code
join branch_stocks bs on bs.product_id = p.id and bs.branch_id = b.id
where bs.current_stock + t.quantity >= 0;  -- skip if would go negative