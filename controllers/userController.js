const bcrypt = require("bcryptjs");
const { eq, desc } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { userProfile } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { users } = schema;

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
      pin,
    } = req.body;

    if (!username || !email || !role || isActive === undefined) {
      return res.status(400).json({
        message:
          "Missing required fields: username, email, role and status are required",
      });
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

    const hashedPassword = await bcrypt.hash("staff123", 10);

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
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─── Delete User ──────────────────────────────────────────────────────────────

exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const [user] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.user.id === user.id) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

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
      pin,
    } = req.body;
    const userId = req.params.id;

    const [user] = await db
      .select(userProfile)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });

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
