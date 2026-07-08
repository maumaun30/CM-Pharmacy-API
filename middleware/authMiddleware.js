const jwt = require("jsonwebtoken");
const { alias } = require("drizzle-orm/pg-core");
const { eq } = require("drizzle-orm");
const { db, schema } = require("../config/db");

const { users, branches } = schema;

// ─── Verify JWT token ─────────────────────────────────────────────────────────

exports.authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided, authorization denied" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Two aliased self-joins to branches: home branch + active (current) branch.
    const homeBranch = alias(branches, "home_branch");
    const curBranch = alias(branches, "cur_branch");

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        branchId: users.branchId,
        currentBranchId: users.currentBranchId,
        branch: { id: homeBranch.id, name: homeBranch.name, code: homeBranch.code },
        currentBranch: { id: curBranch.id, name: curBranch.name, code: curBranch.code },
      })
      .from(users)
      .leftJoin(homeBranch, eq(users.branchId, homeBranch.id))
      .leftJoin(curBranch, eq(users.currentBranchId, curBranch.id))
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user) {
      return res.status(401).json({ message: "Invalid token, user not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: "Account is inactive, access denied" });
    }

    req.user = {
      id:              user.id,
      username:        user.username,
      role:            user.role,
      branchId:        user.branchId,
      currentBranchId: user.currentBranchId,
      // Collapse the joined object to null when there is no related branch,
      // matching the previous supabase nested-select semantics.
      branch:          user.branch?.id ? user.branch : null,
      currentBranch:   user.currentBranch?.id ? user.currentBranch : null,
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
