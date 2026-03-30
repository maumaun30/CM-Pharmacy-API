const bcrypt = require("bcryptjs");
const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PUBLIC_FIELDS = `
  id, username, email, role,
  first_name, last_name, contact_number,
  branch_id, current_branch_id,
  is_active, created_at, updated_at
`;

// ─── Get All Users ────────────────────────────────────────────────────────────

exports.getAllUsers = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from("users")
      .select(PUBLIC_FIELDS)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json(users);
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

    // Validate required fields first
    if (!username || !email || !role || isActive === undefined) {
      return res.status(400).json({
        message:
          "Missing required fields: username, email, role and status are required",
      });
    }

    // Check duplicate email
    const { data: existingEmail } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Check duplicate username
    const { data: existingUsername } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      return res.status(400).json({ message: "Username already in use" });
    }

    const hashedPassword = await bcrypt.hash("staff123", 10);

    let hashedPin = null;
    if (pin) {
      hashedPin = await bcrypt.hash(String(pin), 10);
    }

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        username,
        email,
        password: hashedPassword,
        role,
        first_name: firstName,
        last_name: lastName,
        contact_number: contactNumber,
        is_active: isActive,
        branch_id: branchId || null,
        pin: hashedPin,
      })
      .select(PUBLIC_FIELDS)
      .single();

    if (error) throw error;

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

    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.user.id === user.id) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (deleteError) throw deleteError;

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

    // Fetch existing user for comparison
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select(PUBLIC_FIELDS)
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check email uniqueness
    if (email && email !== user.email) {
      const { data: taken } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (taken) return res.status(400).json({ message: "Email already in use" });
    }

    // Check username uniqueness
    if (username && username !== user.username) {
      const { data: taken } = await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (taken) return res.status(400).json({ message: "Username already taken" });
    }

    // Build update payload — only include fields that were sent
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) updates.role = role;
    if (firstName !== undefined) updates.first_name = firstName;
    if (lastName !== undefined) updates.last_name = lastName;
    if (contactNumber !== undefined) updates.contact_number = contactNumber;
    if (isActive !== undefined) updates.is_active = isActive;
    if (branchId !== undefined) updates.branch_id = branchId || null;
    if (pin !== undefined) {
      updates.pin = pin ? await bcrypt.hash(String(pin), 10) : null;
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select(PUBLIC_FIELDS)
      .single();

    if (updateError) throw updateError;

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