// routes/stockRoutes.js
const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stockController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get(
  "/transactions",
  authorizeRoles("admin"),
  stockController.getAllStockTransactions,
);
router.get(
  "/summary",
  authorizeRoles("admin"),
  stockController.getStockSummary,
);
router.get(
  "/low-stock",
  authorizeRoles("admin"),
  stockController.getLowStockProducts,
);
router.get(
  "/product/:productId",
  authorizeRoles("admin"),
  stockController.getProductStockHistory,
);
router.post("/add", authorizeRoles("admin"), stockController.addStock);
router.post("/adjust", authorizeRoles("admin"), stockController.adjustStock);
router.post("/loss", authorizeRoles("admin"), stockController.recordStockLoss);

module.exports = router;
