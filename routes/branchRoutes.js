// routes/branchRoutes.js
const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");
const { cacheFor } = require("../middleware/cacheControl");

router.use(authenticateUser);

// The branch list is near-static and is fetched on nearly every app boot.
// NOTE: /:id/stats is deliberately NOT cached -- those numbers move per sale.
const cacheBranches = cacheFor(30);

// Public routes (authenticated users can view)
router.get("/", cacheBranches, branchController.getAllBranches);
router.get("/:id", cacheBranches, branchController.getBranchById);

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
