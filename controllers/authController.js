const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { and, or, eq, inArray } = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const { db, schema } = require("../config/db");
const { branchFull, userProfile } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");
const { verifyGoogleIdToken } = require("../config/google");
const {
  ROLES,
  ALL_PERMISSIONS,
  permissionsForRole,
} = require("../config/permissions");

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
  permissions: permissionsForRole(user.role),
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

// ─── Change Password ──────────────────────────────────────────────────────────
// The logged-in user changes their own password. Unlike updateProfile, this
// verifies the current password first (self-service change flow).
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const [user] = await db
      .select({ id: users.id, password: users.password })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    const ok = await bcrypt.compare(String(currentPassword), user.password);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

    const hashed = await bcrypt.hash(String(newPassword), 10);
    await db.update(users).set({ password: hashed }).where(eq(users.id, user.id));

    await createLog(req, "UPDATE", "users", user.id, "Changed own password", {});

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Switch Branch ────────────────────────────────────────────────────────────

exports.switchBranch = async (req, res) => {
  try {
    const { branchId } = req.body;
    const userId = req.user.id;

    // Admins switch anywhere; managers only among their allowed branches (plus
    // their home). Cashiers cannot switch.
    if (req.user.role !== "admin") {
      if (req.user.role !== "manager") {
        return res.status(403).json({ message: "You are not allowed to switch branches" });
      }
      const allowed = new Set([
        ...(req.user.allowedBranchIds ?? []),
        ...(req.user.branchId ? [req.user.branchId] : []),
      ].map(Number));
      if (!allowed.has(Number(branchId))) {
        return res.status(403).json({ message: "You don't have access to this branch" });
      }
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
        allowed_branch_ids: users.allowedBranchIds,
        is_active: users.isActive,
        google_sub: users.googleSub,
        google_email: users.googleEmail,
        created_at: users.createdAt,
        updated_at: users.updatedAt,
        branch: {
          id: homeBranch.id, name: homeBranch.name, code: homeBranch.code,
          is_active: homeBranch.isActive, email: homeBranch.email, phone: homeBranch.phone,
          address: homeBranch.address, city: homeBranch.city, province: homeBranch.province,
          postal_code: homeBranch.postalCode, tin: homeBranch.tin,
        },
        currentBranch: {
          id: curBranch.id, name: curBranch.name, code: curBranch.code,
          is_active: curBranch.isActive, email: curBranch.email, phone: curBranch.phone,
          address: curBranch.address, city: curBranch.city, province: curBranch.province,
          postal_code: curBranch.postalCode, tin: curBranch.tin,
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

    // Branches a manager may switch between (home + granted). Used by the branch
    // switcher. Admins get all branches from /branches; cashiers get none.
    user.allowed_branch_ids = user.allowed_branch_ids ?? [];
    if (user.role === "manager") {
      const ids = Array.from(
        new Set([...(user.allowed_branch_ids || []), ...(user.branch_id ? [user.branch_id] : [])].map(Number)),
      );
      user.allowed_branches = ids.length
        ? await db
            .select({ id: branches.id, name: branches.name, code: branches.code, is_active: branches.isActive })
            .from(branches)
            .where(and(inArray(branches.id, ids), eq(branches.isActive, true)))
        : [];
    } else {
      user.allowed_branches = [];
    }

    // Expanded capability list drives what the UI renders for this user.
    user.permissions = permissionsForRole(user.role);

    // Surface Google link state without leaking the raw subject id to the client.
    user.google_linked = !!user.google_sub;
    delete user.google_sub;

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching current user:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Roles & Permissions matrix ───────────────────────────────────────────────
// Read-only view of the code-defined role→permission matrix. Powers the
// Settings › Roles & Permissions page. Source of truth is config/permissions.js.

exports.getRoles = async (req, res) => {
  try {
    return res.status(200).json({
      permissions: ALL_PERMISSIONS,
      roles: ROLES.map((role) => ({
        role,
        permissions: permissionsForRole(role),
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Google Login ─────────────────────────────────────────────────────────────
// Public. Matches ONLY by the stored google_sub — never by email — so a Google
// account can authenticate a staff user only if that user explicitly linked it
// while already logged in. Never creates accounts (staff are admin-provisioned).

exports.googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "Google idToken is required" });
    }

    let payload;
    try {
      payload = await verifyGoogleIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.googleSub, payload.sub))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        message:
          "No linked Google account. Sign in normally, then connect Google in Settings.",
      });
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
      `User ${user.username} logged in via Google`,
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

// ─── Link Google ──────────────────────────────────────────────────────────────
// Authenticated. Attaches the caller's Google account (by verified sub) to their
// existing staff record. Rejects if that Google account is already linked to a
// different user.

exports.linkGoogle = async (req, res) => {
  try {
    const { idToken } = req.body;
    const userId = req.user.id;

    if (!idToken) {
      return res.status(400).json({ message: "Google idToken is required" });
    }

    let payload;
    try {
      payload = await verifyGoogleIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    // Guard: this Google account must not already belong to someone else.
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.googleSub, payload.sub))
      .limit(1);

    if (owner && owner.id !== userId) {
      return res
        .status(409)
        .json({ message: "This Google account is linked to another user" });
    }

    const [updated] = await db
      .update(users)
      .set({
        googleSub: payload.sub,
        googleEmail: payload.email || null,
        googleLinkedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id, username: users.username, email: users.email, role: users.role });

    await createLog(
      req,
      "UPDATE",
      "auth",
      userId,
      `User ${updated.username} linked Google account`,
      { googleEmail: payload.email }
    );

    return res.status(200).json({
      message: "Google account linked",
      user: { ...safeUser(updated), googleLinked: true, googleEmail: payload.email || null },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Unlink Google ────────────────────────────────────────────────────────────
// Authenticated. Safe to remove because password is NOT NULL — the user always
// retains password/PIN login as a fallback.

exports.unlinkGoogle = async (req, res) => {
  try {
    const userId = req.user.id;

    const [updated] = await db
      .update(users)
      .set({ googleSub: null, googleEmail: null, googleLinkedAt: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id, username: users.username });

    if (!updated) return res.status(404).json({ message: "User not found" });

    await createLog(
      req,
      "UPDATE",
      "auth",
      userId,
      `User ${updated.username} unlinked Google account`
    );

    return res.status(200).json({ message: "Google account unlinked" });
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
