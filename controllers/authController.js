const jwt = require("jsonwebtoken");
const { User, Branch } = require("../models");
const { createLog } = require("../middleware/logMiddleware");

// Register new user
exports.register = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Basic validation
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "Username, email, and password are required" });
    }

    // Check if username or email already exists
    const existingUser = await User.findOne({
      where: {
        [User.sequelize.Op.or]: [{ username }, { email }],
      },
    });

    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Username or email already in use" });
    }

    // Create new user - the password will be hashed by model hooks
    const newUser = await User.create({
      username,
      email,
      password,
      role: role || "staff", // Default to staff if not specified
    });

    // Create JWT token
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    return res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
      },
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Find user by username
    const user = await User.findOne({
      where: { username },
    });

    // Check if user exists and password is correct
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check if user is active
    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is inactive. Contact administrator." });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    await createLog(
      req,
      "LOGIN",
      "auth",
      user.id,
      `User ${user.username} logged in`,
      { role: user.role },
    );

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const userId = req.user.id;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if username already exists (if changing)
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ where: { username } });
      if (existingUsername) {
        return res.status(400).json({ message: "Username already taken" });
      }
    }

    // Check if email already exists
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ where: { email } });
      if (existingEmail) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    // Update fields
    if (username) user.username = username;
    if (email) user.email = email;
    if (password) user.password = password;

    await user.save();

    await createLog(
      req,
      "UPDATE",
      "auth",
      user.id,
      `Updated user: ${user.username}`,
      {
        before: { ...user._previousDataValues },
        after: { ...user.toJSON() },
      },
    );

    return res.status(200).json({
      message: "Profile updated successfully",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

exports.switchBranch = async (req, res) => {
  try {
    const { branchId } = req.body;
    const userId = req.user.id;

    // Only admins can switch branches
    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Only admins can switch branches",
      });
    }

    // Verify branch exists and is active
    const branch = await Branch.findOne({
      where: { id: branchId, isActive: true },
    });

    if (!branch) {
      return res.status(404).json({
        message: "Branch not found or inactive",
      });
    }

    // Update current branch
    await User.update({ currentBranchId: branchId }, { where: { id: userId } });

    await createLog(
      req,
      "UPDATE",
      "users",
      userId,
      `Switched to branch: ${branch.name}`,
      { branchId, branchName: branch.name },
    );

    return res.status(200).json({
      message: `Switched to ${branch.name}`,
      currentBranch: branch,
    });
  } catch (error) {
    console.error("Error switching branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

exports.resetToBranchHome = async (req, res) => {
  try {
    const userId = req.user.id;

    await User.update({ currentBranchId: null }, { where: { id: userId } });

    return res.status(200).json({
      message: "Reset to home branch",
    });
  } catch (error) {
    console.error("Error resetting branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: {
        exclude: ["password"], // Don't send password
      },
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code", "isActive", "email", "phone"],
          required: false, // LEFT JOIN - user might not have a branch
        },
        {
          model: Branch,
          as: "currentBranch",
          attributes: ["id", "name", "code", "isActive", "email", "phone"],
          required: false,
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Convert to JSON and clean up
    const userData = user.toJSON();

    return res.status(200).json(userData);
  } catch (error) {
    console.error("Error fetching current user:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
