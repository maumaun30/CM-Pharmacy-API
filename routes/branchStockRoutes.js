const express = require("express");
const router = express.Router();
const branchStockController = require("../controllers/branchStockController");
const {
  authenticateUser,
  requirePermission,
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
  requirePermission("stock.write"),
  branchStockController.initializeBranchStock,
);

// Update branch stock settings (thresholds only, not quantity)
router.patch(
  "/:id/settings",
  requirePermission("stock.write"),
  branchStockController.updateBranchStockSettings,
);

// Transfer stock between branches
router.post(
  "/transfer",
  requirePermission("stock.write"),
  branchStockController.transferStock,
);

// Get stock alerts (low stock, out of stock)
// Query params: branchId (optional)
router.get("/alerts", branchStockController.getStockAlerts);

module.exports = router;
