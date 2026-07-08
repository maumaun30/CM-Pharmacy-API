const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { and, or, eq } = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const { db, schema } = require("../config/db");
const { branchFull, userProfile } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { users, branches } = schema;

// ─── Helpers ────────────────────────────────────────────────────────────────

const signToken = (user) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

const safeUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
});

// ─── Register ────────────────────────────────────────────────────────────────

exports.register = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "Username, email, and password are required" });
    }

    // Check duplicate username or email
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);

    if (existing) {
      return res
        .status(400)
        .json({ message: "Username or email already in use" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        email,
        password: hashedPassword,
        role: role || "cashier",
        isActive: true,
      })
      .returning({ id: users.id, username: users.username, email: users.email, role: users.role });

    const token = signToken(newUser);

    return res.status(201).json({
      message: "User registered successfully",
      user: safeUser(newUser),
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Login ───────────────────────────────────────────────────────────────────

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        password: users.password,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const validPassword =
      user && (await bcrypt.compare(password, user.password));

    if (!user || !validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is inactive. Contact administrator." });
    }

    const token = signToken(user);

    await createLog(
      req,
      "LOGIN",
      "auth",
      user.id,
      `User ${user.username} logged in`,
      { role: user.role }
    );

    return res.status(200).json({
      message: "Login successful",
      user: safeUser(user),
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Get Profile ─────────────────────────────────────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const [user] = await db
      .select(userProfile)
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json(user);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Update Profile ───────────────────────────────────────────────────────────

exports.updateProfile = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const userId = req.user.id;

    const [user] = await db
      .select({ id: users.id, username: users.username, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Check username uniqueness
    if (username && username !== user.username) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (taken) return res.status(400).json({ message: "Username already taken" });
    }

    // Check email uniqueness
    if (email && email !== user.email) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (taken) return res.status(400).json({ message: "Email already in use" });
    }

    const updates = {};
    if (username) updates.username = username;
    if (email) updates.email = email;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(password, salt);
    }

    const [updatedUser] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({ id: users.id, username: users.username, email: users.email, role: users.role });

    await createLog(
      req,
      "UPDATE",
      "auth",
      userId,
      `Updated user: ${updatedUser.username}`,
      { before: safeUser(user), after: safeUser(updatedUser) }
    );

    return res.status(200).json({
      message: "Profile updated successfully",
      user: safeUser(updatedUser),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Switch Branch ────────────────────────────────────────────────────────────

exports.switchBranch = async (req, res) => {
  try {
    const { branchId } = req.body;
    const userId = req.user.id;

    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Only admins can switch branches" });
    }

    const [branch] = await db
      .select(branchFull)
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.isActive, true)))
      .limit(1);

    if (!branch) {
      return res.status(404).json({ message: "Branch not found or inactive" });
    }

    await db
      .update(users)
      .set({ currentBranchId: branchId })
      .where(eq(users.id, userId));

    await createLog(
      req,
      "UPDATE",
      "users",
      userId,
      `Switched to branch: ${branch.name}`,
      { branchId, branchName: branch.name }
    );

    return res.status(200).json({
      message: `Switched to ${branch.name}`,
      currentBranch: branch,
    });
  } catch (error) {
    console.error("Error switching branch:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Reset to Home Branch ─────────────────────────────────────────────────────

exports.resetToBranchHome = async (req, res) => {
  try {
    const userId = req.user.id;

    await db
      .update(users)
      .set({ currentBranchId: null })
      .where(eq(users.id, userId));

    return res.status(200).json({ message: "Reset to home branch" });
  } catch (error) {
    console.error("Error resetting branch:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Get Current User (with branch joins) ────────────────────────────────────

exports.getCurrentUser = async (req, res) => {
  try {
    const homeBranch = alias(branches, "home_branch");
    const curBranch = alias(branches, "cur_branch");

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        first_name: users.firstName,
        last_name: users.lastName,
        contact_number: users.contactNumber,
        branch_id: users.branchId,
        current_branch_id: users.currentBranchId,
        is_active: users.isActive,
        created_at: users.createdAt,
        updated_at: users.updatedAt,
        branch: {
          id: homeBranch.id, name: homeBranch.name, code: homeBranch.code,
          is_active: homeBranch.isActive, email: homeBranch.email, phone: homeBranch.phone,
        },
        currentBranch: {
          id: curBranch.id, name: curBranch.name, code: curBranch.code,
          is_active: curBranch.isActive, email: curBranch.email, phone: curBranch.phone,
        },
      })
      .from(users)
      .leftJoin(homeBranch, eq(users.branchId, homeBranch.id))
      .leftJoin(curBranch, eq(users.currentBranchId, curBranch.id))
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Collapse joined objects to null when no related branch (supabase semantics).
    user.branch = user.branch?.id ? user.branch : null;
    user.currentBranch = user.currentBranch?.id ? user.currentBranch : null;

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching current user:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Login With PIN ───────────────────────────────────────────────────────────

exports.loginWithPin = async (req, res) => {
  try {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res
        .status(400)
        .json({ message: "Username and PIN are required" });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be 4–6 digits" });
    }

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        pin: users.pin,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const validPin =
      user && user.pin && (await bcrypt.compare(pin, user.pin));

    if (!user || !validPin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is inactive. Contact administrator." });
    }

    const token = signToken(user);

    await createLog(
      req,
      "LOGIN",
      "auth",
      user.id,
      `User ${user.username} logged in via PIN`,
      { role: user.role }
    );

    return res.status(200).json({
      message: "Login successful",
      user: safeUser(user),
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Set PIN ──────────────────────────────────────────────────────────────────

exports.setPin = async (req, res) => {
  try {
    const { pin } = req.body;
    const userId = req.user.id;

    if (pin && !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ message: "PIN must be 4–6 digits" });
    }

    const [user] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    let hashedPin = null;
    if (pin) {
      const salt = await bcrypt.genSalt(10);
      hashedPin = await bcrypt.hash(pin, salt);
    }

    await db
      .update(users)
      .set({ pin: hashedPin })
      .where(eq(users.id, userId));

    await createLog(
      req,
      "UPDATE",
      "auth",
      userId,
      `User ${user.username} ${pin ? "set" : "removed"} PIN`
    );

    return res
      .status(200)
      .json({ message: pin ? "PIN set successfully" : "PIN removed" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
