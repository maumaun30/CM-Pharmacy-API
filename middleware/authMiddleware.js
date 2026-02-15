const jwt = require("jsonwebtoken");
const { User, Branch } = require("../models");

// Verify JWT token middleware
exports.authenticateUser = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "No token provided, authorization denied" });
    }

    // Extract token
    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user with branch associations
    const user = await User.findByPk(decoded.id, {
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
        {
          model: Branch,
          as: "currentBranch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid token, user not found" });
    }

    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is inactive, access denied" });
    }

    // Add user data to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      // ✅ Add branch information
      branchId: user.branchId,
      currentBranchId: user.currentBranchId,
      // Optional: include full branch objects if needed
      branch: user.branch,
      currentBranch: user.currentBranch,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Role-based authorization middleware
exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role (${req.user.role}) is not authorized to access this resource`,
      });
    }

    next();
  };
};