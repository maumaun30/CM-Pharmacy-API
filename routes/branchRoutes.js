// routes/branchRoutes.js
const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// Public routes (authenticated users can view)
router.get("/", authenticateUser, branchController.getAllBranches);
router.get("/:id", authenticateUser, branchController.getBranchById);

// Admin-only routes
router.get(
  "/:id/stats",
  authenticateUser,
  authorizeRoles("admin"),
  branchController.getBranchStats
);

router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  branchController.createBranch
);

router.put(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  branchController.updateBranch
);

router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  branchController.deleteBranch
);

router.patch(
  "/:id/toggle",
  authenticateUser,
  authorizeRoles("admin"),
  branchController.toggleBranchStatus
);

module.exports = router;