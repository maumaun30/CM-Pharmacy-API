// config/permissions.js
// ─────────────────────────────────────────────────────────────────────────────
// Central role → permission matrix. This is the SINGLE source of truth for what
// each role may do. The API enforces it via requirePermission() middleware; the
// UI mirrors the (already-expanded) permission list it receives on /auth/me to
// decide what to render. Change capabilities here — nowhere else.
//
// Permission keys are "resource.action". A role's list may use wildcards:
//   "*"          → every permission in ALL_PERMISSIONS
//   "resource.*" → every action on that resource
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = ["admin", "manager", "cashier"];

// The full catalogue of concrete permissions in the system. Wildcards in
// ROLE_PERMISSIONS are expanded against this list, and the Roles & Permissions
// settings page renders it as the column set.
const ALL_PERMISSIONS = [
  "dashboard.view",
  "pos.use",
  "sales.read",
  "sales.refund",
  "refund_requests.create",
  "refund_requests.review",
  "notifications.read",
  "products.read",
  "products.write",
  "products.delete",
  "stock.read",
  "stock.write",
  "categories.read",
  "categories.write",
  "discounts.read",
  "discounts.write",
  "branches.read",
  "branches.write",
  "branches.switch",
  "users.read",
  "users.write",
  "logs.read",
];

const ROLE_PERMISSIONS = {
  // Full access to everything.
  admin: ["*"],

  // Runs a branch: full product + inventory control, and can read sales.
  // Intentionally NOT granted: categories, discounts, users, branches, logs.
  manager: [
    "dashboard.view",
    "pos.use",
    "sales.read",
    "sales.refund",
    "refund_requests.create",
    "refund_requests.review",
    "notifications.read",
    "products.read",
    "products.write",
    "stock.read",
    "stock.write",
    // Read-only categories so the products page (filters + product form) loads.
    "categories.read",
    // Switch among granted branches. The switchBranch controller still enforces
    // that the target is in the manager's allowed_branch_ids (+ home).
    "branches.switch",
  ],

  // Front-of-house: sell at the POS and look things up. No management access.
  cashier: [
    "dashboard.view",
    "pos.use",
    "sales.read",
    "refund_requests.create",
    "notifications.read",
    "products.read",
  ],
};

// Expand a role's (possibly wildcarded) list into concrete permission keys.
// Admin's "*" becomes the whole ALL_PERMISSIONS list so the client receives a
// plain array it can test with .includes().
function permissionsForRole(role) {
  const listed = ROLE_PERMISSIONS[role] || [];
  if (listed.includes("*")) return [...ALL_PERMISSIONS];

  const out = new Set();
  for (const entry of listed) {
    if (entry.endsWith(".*")) {
      const resource = entry.slice(0, -2);
      ALL_PERMISSIONS.forEach((p) => {
        if (p.startsWith(`${resource}.`)) out.add(p);
      });
    } else {
      out.add(entry);
    }
  }
  return [...out];
}

// Does a role hold a specific permission? Wildcards ("*" and "resource.*") count.
function hasPermission(role, permission) {
  const listed = ROLE_PERMISSIONS[role] || [];
  if (listed.includes("*") || listed.includes(permission)) return true;
  const resource = permission.split(".")[0];
  return listed.includes(`${resource}.*`);
}

module.exports = {
  ROLES,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  hasPermission,
};
