const { and, or, eq, ilike, gte, asc, desc, count } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { branchFull } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { branches, users, sales, stocks } = schema;

// Small helper: COUNT(*) over a table with an optional where.
const countWhere = async (table, where) => {
  const [{ n }] = await db.select({ n: count() }).from(table).where(where);
  return n;
};

// ─── Get All Branches ─────────────────────────────────────────────────────────

exports.getAllBranches = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const conds = [];
    if (isActive !== undefined) conds.push(eq(branches.isActive, isActive === "true"));
    if (search)
      conds.push(
        or(
          ilike(branches.name, `%${search}%`),
          ilike(branches.code, `%${search}%`),
          ilike(branches.city, `%${search}%`)
        )
      );

    const rows = await db
      .select(branchFull)
      .from(branches)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(branches.isMainBranch), asc(branches.name));

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching branches:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Branch By ID (with users) ───────────────────────────────────────────

exports.getBranchById = async (req, res) => {
  try {
    const [branch] = await db
      .select(branchFull)
      .from(branches)
      .where(eq(branches.id, req.params.id))
      .limit(1);

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const branchUsers = await db
      .select({ id: users.id, username: users.username, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.branchId, req.params.id));

    return res.status(200).json({ ...branch, users: branchUsers });
  } catch (error) {
    console.error("Error fetching branch:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Create Branch ────────────────────────────────────────────────────────────

exports.createBranch = async (req, res) => {
  try {
    const {
      name, code, address, city, province,
      postalCode, phone, email, managerName,
      isActive, isMainBranch, operatingHours,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ message: "Name and code are required" });
    }

    const [existing] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.code, code))
      .limit(1);

    if (existing) {
      return res.status(400).json({ message: "Branch code already exists" });
    }

    // Partial unique index allows only one main branch — clear it first.
    if (isMainBranch) {
      await db.update(branches).set({ isMainBranch: false }).where(eq(branches.isMainBranch, true));
    }

    const [branch] = await db
      .insert(branches)
      .values({
        name,
        code,
        address,
        city,
        province,
        postalCode: postalCode,
        phone,
        email,
        managerName: managerName,
        isActive: isActive !== undefined ? isActive : true,
        isMainBranch: isMainBranch || false,
        operatingHours: operatingHours || null,
      })
      .returning(branchFull);

    await createLog(
      req, "CREATE", "branches", branch.id,
      `Created branch: ${branch.name}`,
      { branch }
    );

    return res.status(201).json(branch);
  } catch (error) {
    console.error("Error creating branch:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Branch ────────────────────────────────────────────────────────────

exports.updateBranch = async (req, res) => {
  try {
    const branchId = req.params.id;
    const {
      name, code, address, city, province,
      postalCode, phone, email, managerName,
      isActive, isMainBranch, operatingHours,
    } = req.body;

    const [branch] = await db
      .select(branchFull)
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    if (code && code !== branch.code) {
      const [taken] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.code, code))
        .limit(1);
      if (taken) {
        return res.status(400).json({ message: "Branch code already exists" });
      }
    }

    // Unset existing main branch if promoting this one.
    if (isMainBranch && !branch.is_main_branch) {
      await db.update(branches).set({ isMainBranch: false }).where(eq(branches.isMainBranch, true));
    }

    // Fallback to existing values; keys are camelCase for Drizzle .set().
    const updates = {
      name:           name           ?? branch.name,
      code:           code           ?? branch.code,
      address:        address        !== undefined ? address        : branch.address,
      city:           city           !== undefined ? city           : branch.city,
      province:       province       !== undefined ? province       : branch.province,
      postalCode:     postalCode     !== undefined ? postalCode     : branch.postal_code,
      phone:          phone          !== undefined ? phone          : branch.phone,
      email:          email          !== undefined ? email          : branch.email,
      managerName:    managerName    !== undefined ? managerName    : branch.manager_name,
      isActive:       isActive       !== undefined ? isActive       : branch.is_active,
      isMainBranch:   isMainBranch   !== undefined ? isMainBranch   : branch.is_main_branch,
      operatingHours: operatingHours !== undefined ? operatingHours : branch.operating_hours,
    };

    const [updatedBranch] = await db
      .update(branches)
      .set(updates)
      .where(eq(branches.id, branchId))
      .returning(branchFull);

    await createLog(
      req, "UPDATE", "branches", branchId,
      `Updated branch: ${updatedBranch.name}`,
      { before: branch, after: updatedBranch }
    );

    return res.status(200).json(updatedBranch);
  } catch (error) {
    console.error("Error updating branch:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete Branch ────────────────────────────────────────────────────────────

exports.deleteBranch = async (req, res) => {
  try {
    const [branch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, req.params.id))
      .limit(1);

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const [userCount, saleCount, stockCount] = await Promise.all([
      countWhere(users, eq(users.branchId, branch.id)),
      countWhere(sales, eq(sales.branchId, branch.id)),
      countWhere(stocks, eq(stocks.branchId, branch.id)),
    ]);

    if (userCount > 0 || saleCount > 0 || stockCount > 0) {
      return res.status(400).json({
        message: "Cannot delete branch with associated users, sales, or stock records",
      });
    }

    await db.delete(branches).where(eq(branches.id, branch.id));

    await createLog(
      req, "DELETE", "branches", branch.id,
      `Deleted branch: ${branch.name}`,
      { branch }
    );

    return res.status(200).json({ message: "Branch deleted successfully" });
  } catch (error) {
    console.error("Error deleting branch:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Toggle Branch Status ─────────────────────────────────────────────────────

exports.toggleBranchStatus = async (req, res) => {
  try {
    const [branch] = await db
      .select({ id: branches.id, name: branches.name, is_active: branches.isActive })
      .from(branches)
      .where(eq(branches.id, req.params.id))
      .limit(1);

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const newStatus = !branch.is_active;

    await db.update(branches).set({ isActive: newStatus }).where(eq(branches.id, branch.id));

    await createLog(
      req, "UPDATE", "branches", branch.id,
      `${newStatus ? "Activated" : "Deactivated"} branch: ${branch.name}`,
      { is_active: newStatus }
    );

    return res.status(200).json({
      message: `Branch ${newStatus ? "activated" : "deactivated"}`,
      isActive: newStatus,
    });
  } catch (error) {
    console.error("Error toggling branch status:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Branch Stats ─────────────────────────────────────────────────────────

exports.getBranchStats = async (req, res) => {
  try {
    const branchId = req.params.id;

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [userCount, todaySales, monthlySales, stockTransactions] = await Promise.all([
      countWhere(users, eq(users.branchId, branchId)),
      countWhere(sales, and(eq(sales.branchId, branchId), gte(sales.soldAt, startOfDay))),
      countWhere(sales, and(eq(sales.branchId, branchId), gte(sales.soldAt, startOfMonth))),
      countWhere(stocks, and(eq(stocks.branchId, branchId), gte(stocks.createdAt, sevenDaysAgo))),
    ]);

    return res.status(200).json({
      userCount,
      todaySales,
      monthlySales,
      stockTransactions,
    });
  } catch (error) {
    console.error("Error fetching branch stats:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
