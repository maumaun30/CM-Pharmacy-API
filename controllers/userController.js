const bcrypt = require("bcryptjs");
const { eq, desc } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { userProfile } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { users } = schema;

// Default password assigned to new accounts and on an admin password reset.
// Staff are expected to change it after first login.
const DEFAULT_PASSWORD = "staff123";

// Guards for mutations on privileged accounts
// (spec: docs/superpowers/specs/2026-07-17-superadmin-totp-design.md):
//   - the superadmin account is untouchable by anyone but itself
//   - accounts holding the admin role require users.manage_admins (superadmin-only)
// Returns an error message, or null when the mutation may proceed.
const guardTargetUser = (req, target) => {
  if (target.role === "superadmin" && req.user.id !== target.id) {
    return "The superadmin account can only be modified by the superadmin";
  }
  if (
    target.role === "admin" &&
    !req.user.permissions.includes("users.manage_admins")
  ) {
    return "Only the superadmin can manage admin accounts";
  }
  return null;
};

// ─── Get All Users ────────────────────────────────────────────────────────────

exports.getAllUsers = async (req, res) => {
  try {
    const rows = await db
      .select(userProfile)
      .from(users)
      .orderBy(desc(users.createdAt));

    return res.status(200).json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Create User ──────────────────────────────────────────────────────────────

exports.createUser = async (req, res) => {
  try {
    const {
      username,
      email,
      role,
      firstName,
      lastName,
      contactNumber,
      isActive,
      branchId,
      allowedBranchIds,
      pin,
    } = req.body;

    // Only managers use multi-branch access; normalize to a clean number array.
    const normalizedAllowed =
      role === "manager" && Array.isArray(allowedBranchIds)
        ? [...new Set(allowedBranchIds.map(Number).filter((n) => Number.isFinite(n)))]
        : [];

    if (!username || !email || !role || isActive === undefined) {
      return res.status(400).json({
        message:
          "Missing required fields: username, email, role and status are required",
      });
    }

    // Superadmin is never assignable through the API (DB-script promotion only;
    // the users_one_superadmin unique index is the backstop).
    if (role === "superadmin") {
      return res.status(400).json({ message: "The superadmin role cannot be assigned" });
    }
    if (role === "admin" && !req.user.permissions.includes("users.manage_admins")) {
      return res.status(403).json({ message: "Only the superadmin can create admin accounts" });
    }

    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const [existingUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUsername) {
      return res.status(400).json({ message: "Username already in use" });
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    let hashedPin = null;
    if (pin) {
      hashedPin = await bcrypt.hash(String(pin), 10);
    }

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        email,
        password: hashedPassword,
        role,
        firstName: firstName,
        lastName: lastName,
        contactNumber: contactNumber,
        isActive: isActive,
        branchId: branchId || null,
        allowedBranchIds: normalizedAllowed,
        pin: hashedPin,
      })
      .returning(userProfile);

    await createLog(
      req,
      "CREATE",
      "users",
      newUser.id,
      `Created user: ${newUser.username}`,
      { user: newUser }
    );

    return res.status(201).json({
      message: "User created successfully",
      newUser,
      defaultPassword: DEFAULT_PASSWORD,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Reset Password ─────────────────────────────────────────────────────────────
// Admin action: reset a user's password back to the shared default. The user is
// expected to change it after logging in. Returns the default so the UI can
// display it once.
exports.resetPassword = async (req, res) => {
  try {
    const userId = req.params.id;

    const [user] = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    const guardError = guardTargetUser(req, user);
    if (guardError) return res.status(403).json({ message: guardError });

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));

    await createLog(
      req, "UPDATE", "users", user.id,
      `Reset password for user: ${user.username}`,
      { userId: user.id }
    );

    return res.status(200).json({
      message: "Password reset successfully",
      defaultPassword: DEFAULT_PASSWORD,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete User ──────────────────────────────────────────────────────────────

exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const [user] = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.user.id === user.id) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

    // Self-delete is already rejected above, so this blocks EVERYONE from
    // deleting the superadmin, and non-superadmins from deleting admins.
    const guardError = guardTargetUser(req, user);
    if (guardError) return res.status(403).json({ message: guardError });

    await db.delete(users).where(eq(users.id, userId));

    await createLog(
      req,
      "DELETE",
      "users",
      userId,
      `Deleted user: ${user.username}`,
      { user }
    );

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Update User ──────────────────────────────────────────────────────────────

exports.updateUser = async (req, res) => {
  try {
    const {
      username,
      email,
      role,
      firstName,
      lastName,
      contactNumber,
      isActive,
      branchId,
      allowedBranchIds,
      pin,
    } = req.body;
    const userId = req.params.id;

    const [user] = await db
      .select(userProfile)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    const guardError = guardTargetUser(req, user);
    if (guardError) return res.status(403).json({ message: guardError });

    // Promotion to superadmin is DB-script only; promotion to admin is a
    // superadmin-exclusive action.
    if (role === "superadmin" && user.role !== "superadmin") {
      return res.status(400).json({ message: "The superadmin role cannot be assigned" });
    }
    if (
      role === "admin" &&
      user.role !== "admin" &&
      !req.user.permissions.includes("users.manage_admins")
    ) {
      return res.status(403).json({ message: "Only the superadmin can create admin accounts" });
    }
    // The superadmin cannot demote itself through the API (avoids stranding the
    // system with no superadmin by accident; use the DB script deliberately).
    if (user.role === "superadmin" && role !== undefined && role !== "superadmin") {
      return res.status(400).json({ message: "The superadmin role cannot be changed here" });
    }

    if (email && email !== user.email) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (taken) return res.status(400).json({ message: "Email already in use" });
    }

    if (username && username !== user.username) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (taken) return res.status(400).json({ message: "Username already taken" });
    }

    // Only include fields that were sent (keys camelCase for Drizzle .set()).
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) updates.role = role;
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (contactNumber !== undefined) updates.contactNumber = contactNumber;
    if (isActive !== undefined) updates.isActive = isActive;
    if (branchId !== undefined) updates.branchId = branchId || null;
    // Multi-branch access applies to managers only. Set when provided, and clear
    // when a user is moved off the manager role.
    if (allowedBranchIds !== undefined) {
      const effRole = role ?? user.role;
      updates.allowedBranchIds =
        effRole === "manager" && Array.isArray(allowedBranchIds)
          ? [...new Set(allowedBranchIds.map(Number).filter((n) => Number.isFinite(n)))]
          : [];
    } else if (role !== undefined && role !== "manager") {
      updates.allowedBranchIds = [];
    }
    if (pin !== undefined) {
      updates.pin = pin ? await bcrypt.hash(String(pin), 10) : null;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning(userProfile);

    await createLog(
      req,
      "UPDATE",
      "users",
      userId,
      `Updated user: ${updatedUser.username}`,
      { before: user, after: updatedUser }
    );

    return res.status(200).json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
