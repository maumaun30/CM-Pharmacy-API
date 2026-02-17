const express = require("express");
const router = express.Router();
const branchStockController = require("../controllers/branchStockController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// All routes require authentication
router.use(authenticateUser);

// Get all branch stocks (with filters)
// Query params: branchId, productId, status (OUT_OF_STOCK, CRITICAL, LOW, IN_STOCK)
router.get("/", branchStockController.getAllBranchStocks);

// Get stock for specific product across all branches
router.get(
  "/product/:productId",
  branchStockController.getProductStockAllBranches,
);

// Get stock for specific branch (all products)
// Query params: status, search
router.get("/branch/:branchId", branchStockController.getBranchStock);

// Initialize stock for a product in a branch
router.post(
  "/initialize",
  authorizeRoles(["ADMIN", "MANAGER"]),
  branchStockController.initializeBranchStock,
);

// Update branch stock settings (thresholds only, not quantity)
router.patch(
  "/:id/settings",
  authorizeRoles(["ADMIN", "MANAGER"]),
  branchStockController.updateBranchStockSettings,
);

// Transfer stock between branches
router.post(
  "/transfer",
  authorizeRoles(["ADMIN", "MANAGER"]),
  branchStockController.transferStock,
);

// Get stock alerts (low stock, out of stock)
// Query params: branchId (optional)
router.get("/alerts", branchStockController.getStockAlerts);

module.exports = router;
