const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

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
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .or(`username.eq.${username},email.eq.${email}`)
      .maybeSingle();

    if (existing) {
      return res
        .status(400)
        .json({ message: "Username or email already in use" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        username,
        email,
        password: hashedPassword,
        role: role || "cashier",
        is_active: true,
      })
      .select("id, username, email, role")
      .single();

    if (error) throw error;

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

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    const validPassword =
      user && (await bcrypt.compare(password, user.password));

    if (!user || !validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.is_active) {
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
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, email, role, first_name, last_name, contact_number, branch_id, current_branch_id, is_active, created_at, updated_at")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw error;
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

    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check username uniqueness
    if (username && username !== user.username) {
      const { data: taken } = await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (taken) return res.status(400).json({ message: "Username already taken" });
    }

    // Check email uniqueness
    if (email && email !== user.email) {
      const { data: taken } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (taken) return res.status(400).json({ message: "Email already in use" });
    }

    const updates = {};
    if (username) updates.username = username;
    if (email) updates.email = email;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(password, salt);
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select("id, username, email, role")
      .single();

    if (updateError) throw updateError;

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

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("*")
      .eq("id", branchId)
      .eq("is_active", true)
      .maybeSingle();

    if (branchError) throw branchError;
    if (!branch) {
      return res.status(404).json({ message: "Branch not found or inactive" });
    }

    const { error } = await supabase
      .from("users")
      .update({ current_branch_id: branchId })
      .eq("id", userId);

    if (error) throw error;

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

    const { error } = await supabase
      .from("users")
      .update({ current_branch_id: null })
      .eq("id", userId);

    if (error) throw error;

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
    // Supabase foreign key joins — requires FK relationships set up in Supabase dashboard
    const { data: user, error } = await supabase
      .from("users")
      .select(`
        id, username, email, role,
        first_name, last_name, contact_number,
        branch_id, current_branch_id,
        is_active, created_at, updated_at,
        branch:branches!users_branch_id_fkey (
          id, name, code, is_active, email, phone
        ),
        currentBranch:branches!users_current_branch_id_fkey (
          id, name, code, is_active, email, phone
        )
      `)
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ message: "User not found" });

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

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    const validPin =
      user && user.pin && (await bcrypt.compare(pin, user.pin));

    if (!user || !validPin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.is_active) {
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

    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ message: "User not found" });

    let hashedPin = null;
    if (pin) {
      const salt = await bcrypt.genSalt(10);
      hashedPin = await bcrypt.hash(pin, salt);
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ pin: hashedPin })
      .eq("id", userId);

    if (updateError) throw updateError;

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