// routes/stockRoutes.js
const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stockController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get(
  "/transactions",
  requirePermission("stock.read"),
  stockController.getAllStockTransactions,
);
router.get(
  "/summary",
  requirePermission("stock.read"),
  stockController.getStockSummary,
);
router.get(
  "/low-stock",
  requirePermission("stock.read"),
  stockController.getLowStockProducts,
);
router.get(
  "/product/:productId",
  requirePermission("stock.read"),
  stockController.getProductStockHistory,
);
router.post("/add", requirePermission("stock.write"), stockController.addStock);
router.post("/adjust", requirePermission("stock.write"), stockController.adjustStock);
router.post("/loss", requirePermission("stock.write"), stockController.recordStockLoss);

module.exports = router;
