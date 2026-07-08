// Reusable Drizzle select projections that reproduce the EXACT snake_case keys
// the previous supabase-js selects returned to the clients. Drizzle columns are
// camelCase; the frontend reads snake_case for raw DB columns, so we alias back.
// Use these anywhere a controller returned a full row (`select("*")`) to a client.
const { schema } = require("../config/db");

const b = schema.branches;
const u = schema.users;

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

module.exports = { branchFull, userProfile };
