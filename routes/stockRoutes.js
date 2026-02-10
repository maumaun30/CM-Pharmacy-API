// routes/stockRoutes.js
const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stockController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// All stock routes require authentication
router.use(authenticateUser);

// Get all stock transactions
router.get(
  "/transactions",
  authorizeRoles("admin"),
  stockController.getAllStockTransactions
);

// Get stock summary/statistics
router.get(
  "/summary",
  authorizeRoles("admin"),
  stockController.getStockSummary
);

// Get low stock products
router.get(
  "/low-stock",
  authorizeRoles("admin"),
  stockController.getLowStockProducts
);

// Get stock history for a specific product
router.get(
  "/product/:productId",
  authorizeRoles("admin"),
  stockController.getProductStockHistory
);

// Add stock (purchase/return)
router.post(
  "/add",
  authorizeRoles("admin"),
  stockController.addStock
);

// Adjust stock (manual adjustment)
router.post(
  "/adjust",
  authorizeRoles("admin"),
  stockController.adjustStock
);

// Record damaged/expired stock
router.post(
  "/loss",
  authorizeRoles("admin"),
  stockController.recordStockLoss
);

module.exports = router;