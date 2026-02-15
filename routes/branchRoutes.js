// routes/branchRoutes.js
const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

// Public routes (authenticated users can view)
router.get("/", branchController.getAllBranches);
router.get("/:id", branchController.getBranchById);

// Admin-only routes
router.get(
  "/:id/stats",
  authorizeRoles("admin"),
  branchController.getBranchStats,
);

router.post("/", authorizeRoles("admin"), branchController.createBranch);
router.put("/:id", authorizeRoles("admin"), branchController.updateBranch);
router.delete("/:id", authorizeRoles("admin"), branchController.deleteBranch);

router.patch(
  "/:id/toggle",
  authorizeRoles("admin"),
  branchController.toggleBranchStatus,
);

module.exports = router;
