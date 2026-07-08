// Reusable Drizzle select projections that reproduce the EXACT snake_case keys
// the previous supabase-js selects returned to the clients. Drizzle columns are
// camelCase; the frontend reads snake_case for raw DB columns, so we alias back.
// Use these anywhere a controller returned a full row (`select("*")`) to a client.
const { schema } = require("../config/db");

const b = schema.branches;
const u = schema.users;
const p = schema.products;
const bs = schema.branchStocks;

// Full branches row (matches `branches.select("*")`).
const branchFull = {
  id: b.id,
  name: b.name,
  code: b.code,
  address: b.address,
  city: b.city,
  province: b.province,
  postal_code: b.postalCode,
  phone: b.phone,
  email: b.email,
  manager_name: b.managerName,
  is_active: b.isActive,
  is_main_branch: b.isMainBranch,
  operating_hours: b.operatingHours,
  created_at: b.createdAt,
  updated_at: b.updatedAt,
};

// Public user profile (matches the explicit select in authController.getProfile).
const userProfile = {
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  first_name: u.firstName,
  last_name: u.lastName,
  contact_number: u.contactNumber,
  branch_id: u.branchId,
  current_branch_id: u.currentBranchId,
  is_active: u.isActive,
  created_at: u.createdAt,
  updated_at: u.updatedAt,
};

// Full products row (matches `products.select("*")`).
const productFull = {
  id: p.id,
  name: p.name,
  sku: p.sku,
  barcode: p.barcode,
  description: p.description,
  price: p.price,
  cost: p.cost,
  expiry_date: p.expiryDate,
  brand_name: p.brandName,
  generic_name: p.genericName,
  dosage: p.dosage,
  form: p.form,
  requires_prescription: p.requiresPrescription,
  status: p.status,
  category_id: p.categoryId,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
};

// Full branch_stocks row (matches `branch_stocks.select("*")`).
const branchStockFull = {
  id: bs.id,
  product_id: bs.productId,
  branch_id: bs.branchId,
  current_stock: bs.currentStock,
  minimum_stock: bs.minimumStock,
  maximum_stock: bs.maximumStock,
  reorder_point: bs.reorderPoint,
  created_at: bs.createdAt,
  updated_at: bs.updatedAt,
};

const st = schema.stocks;
const d = schema.discounts;

// Full discounts row (matches `discounts.select("*")`).
const discountFull = {
  id: d.id,
  name: d.name,
  description: d.description,
  discount_type: d.discountType,
  discount_value: d.discountValue,
  discount_category: d.discountCategory,
  start_date: d.startDate,
  end_date: d.endDate,
  is_enabled: d.isEnabled,
  requires_verification: d.requiresVerification,
  applicable_to: d.applicableTo,
  minimum_purchase_amount: d.minimumPurchaseAmount,
  maximum_discount_amount: d.maximumDiscountAmount,
  priority: d.priority,
  stackable: d.stackable,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
};

// Full stocks (ledger) row (matches `stocks.select("*")`).
const stockFull = {
  id: st.id,
  branch_id: st.branchId,
  product_id: st.productId,
  transaction_type: st.transactionType,
  quantity: st.quantity,
  quantity_before: st.quantityBefore,
  quantity_after: st.quantityAfter,
  unit_cost: st.unitCost,
  total_cost: st.totalCost,
  batch_number: st.batchNumber,
  expiry_date: st.expiryDate,
  supplier: st.supplier,
  reference_id: st.referenceId,
  reference_type: st.referenceType,
  reason: st.reason,
  performed_by: st.performedBy,
  created_at: st.createdAt,
};

module.exports = { branchFull, userProfile, productFull, branchStockFull, stockFull, discountFull };
