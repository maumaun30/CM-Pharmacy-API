const jwt = require("jsonwebtoken");
const supabase = require("../config/supabase");

// ─── Verify JWT token ─────────────────────────────────────────────────────────

exports.authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided, authorization denied" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error } = await supabase
      .from("users")
      .select(`
        id, username, role, is_active,
        branch_id, current_branch_id,
        branch:branches!users_branch_id_fkey               (id, name, code),
        currentBranch:branches!users_current_branch_id_fkey (id, name, code)
      `)
      .eq("id", decoded.id)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(401).json({ message: "Invalid token, user not found" });
    }

    if (!user.is_active) {
      return res.status(401).json({ message: "Account is inactive, access denied" });
    }

    req.user = {
      id:              user.id,
      username:        user.username,
      role:            user.role,
      branchId:        user.branch_id,
      currentBranchId: user.current_branch_id,
      branch:          user.branch,
      currentBranch:   user.currentBranch,
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Role-based authorization ─────────────────────────────────────────────────

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