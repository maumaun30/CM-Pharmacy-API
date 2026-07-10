// routes/branchRoutes.js
const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

// Public routes (authenticated users can view)
router.get("/", branchController.getAllBranches);
router.get("/:id", branchController.getBranchById);

// Management routes
router.get(
  "/:id/stats",
  requirePermission("branches.read"),
  branchController.getBranchStats,
);

router.post("/", requirePermission("branches.write"), branchController.createBranch);
router.put("/:id", requirePermission("branches.write"), branchController.updateBranch);
router.delete("/:id", requirePermission("branches.write"), branchController.deleteBranch);

router.patch(
  "/:id/toggle",
  requirePermission("branches.write"),
  branchController.toggleBranchStatus,
);

module.exports = router;
