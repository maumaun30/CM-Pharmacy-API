const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Get All Branches ─────────────────────────────────────────────────────────

exports.getAllBranches = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    let query = supabase
      .from("branches")
      .select("*")
      .order("is_main_branch", { ascending: false })
      .order("name", { ascending: true });

    if (isActive !== undefined) {
      query = query.eq("is_active", isActive === "true");
    }

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,code.ilike.%${search}%,city.ilike.%${search}%`
      );
    }

    const { data: branches, error } = await query;

    if (error) throw error;

    return res.status(200).json(branches);
  } catch (error) {
    console.error("Error fetching branches:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Branch By ID (with users) ───────────────────────────────────────────

exports.getBranchById = async (req, res) => {
  try {
    const { data: branch, error } = await supabase
      .from("branches")
      .select(`
        *,
        users (id, username, email, role)
      `)
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    return res.status(200).json(branch);
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

    // Check duplicate code
    const { data: existing } = await supabase
      .from("branches")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ message: "Branch code already exists" });
    }

    // If setting as main branch, unset existing main branch first.
    // The partial unique index on the DB prevents two main branches,
    // so we must clear it before inserting the new one.
    if (isMainBranch) {
      const { error: unsetError } = await supabase
        .from("branches")
        .update({ is_main_branch: false })
        .eq("is_main_branch", true);
      if (unsetError) throw unsetError;
    }

    const { data: branch, error } = await supabase
      .from("branches")
      .insert({
        name,
        code,
        address,
        city,
        province,
        postal_code: postalCode,
        phone,
        email,
        manager_name: managerName,
        is_active: isActive !== undefined ? isActive : true,
        is_main_branch: isMainBranch || false,
        operating_hours: operatingHours || null,
      })
      .select()
      .single();

    if (error) throw error;

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

    const { data: branch, error: fetchError } = await supabase
      .from("branches")
      .select("*")
      .eq("id", branchId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    // Check code uniqueness if changing
    if (code && code !== branch.code) {
      const { data: taken } = await supabase
        .from("branches")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (taken) {
        return res.status(400).json({ message: "Branch code already exists" });
      }
    }

    // Unset existing main branch if promoting this one
    if (isMainBranch && !branch.is_main_branch) {
      const { error: unsetError } = await supabase
        .from("branches")
        .update({ is_main_branch: false })
        .eq("is_main_branch", true);
      if (unsetError) throw unsetError;
    }

    // Build update payload with fallback to existing values
    const updates = {
      name:            name            ?? branch.name,
      code:            code            ?? branch.code,
      address:         address         !== undefined ? address         : branch.address,
      city:            city            !== undefined ? city            : branch.city,
      province:        province        !== undefined ? province        : branch.province,
      postal_code:     postalCode      !== undefined ? postalCode      : branch.postal_code,
      phone:           phone           !== undefined ? phone           : branch.phone,
      email:           email           !== undefined ? email           : branch.email,
      manager_name:    managerName     !== undefined ? managerName     : branch.manager_name,
      is_active:       isActive        !== undefined ? isActive        : branch.is_active,
      is_main_branch:  isMainBranch    !== undefined ? isMainBranch    : branch.is_main_branch,
      operating_hours: operatingHours  !== undefined ? operatingHours  : branch.operating_hours,
    };

    const { data: updatedBranch, error: updateError } = await supabase
      .from("branches")
      .update(updates)
      .eq("id", branchId)
      .select()
      .single();

    if (updateError) throw updateError;

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
    const { data: branch, error: fetchError } = await supabase
      .from("branches")
      .select("id, name")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    // Check for associated records before deleting
    const [
      { count: userCount },
      { count: saleCount },
      { count: stockCount },
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }).eq("branch_id", branch.id),
      supabase.from("sales").select("id", { count: "exact", head: true }).eq("branch_id", branch.id),
      supabase.from("stocks").select("id", { count: "exact", head: true }).eq("branch_id", branch.id),
    ]);

    if (userCount > 0 || saleCount > 0 || stockCount > 0) {
      return res.status(400).json({
        message: "Cannot delete branch with associated users, sales, or stock records",
      });
    }

    const { error: deleteError } = await supabase
      .from("branches")
      .delete()
      .eq("id", branch.id);

    if (deleteError) throw deleteError;

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
    const { data: branch, error: fetchError } = await supabase
      .from("branches")
      .select("id, name, is_active")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const newStatus = !branch.is_active;

    const { error: updateError } = await supabase
      .from("branches")
      .update({ is_active: newStatus })
      .eq("id", branch.id);

    if (updateError) throw updateError;

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

    const [
      { count: userCount },
      { count: todaySales },
      { count: monthlySales },
      { count: stockTransactions },
    ] = await Promise.all([
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId),
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("sold_at", startOfDay),
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("sold_at", startOfMonth),
      supabase
        .from("stocks")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId)
        .gte("created_at", sevenDaysAgo),
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