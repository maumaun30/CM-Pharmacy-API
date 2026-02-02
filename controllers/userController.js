const { User } = require("../models");
const bcrypt = require("bcryptjs");

// Admin only: Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
    });

    return res.status(200).json(users);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { username, email, role, isActive } = req.body;
    const hashedPassword = await bcrypt.hash("staff123", 10);

    // Check if email already exists
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Validate required fields
    if (!username || !email || !role || isActive === undefined) {
      return res.status(400).json({
        message:
          "Missing required fields: username, email, role and status are required",
      });
    }

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword, // default password
      role,
      isActive,
    });

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

exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.user.id === user.id) {
      return res
        .status(400)
        .json({ message: "You cannot delete your own account" });
    }

    await user.destroy();

    return res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Admin only: Update user (including role)
exports.updateUser = async (req, res) => {
  try {
    const { username, email, role, isActive } = req.body;
    const userId = req.params.id;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
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
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    return res.status(200).json({
      message: "User updated successfully",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
