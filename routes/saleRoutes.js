const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");
const refundController = require("../controllers/refundController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.post("/", saleController.createSale);
router.get("/", saleController.getSales);

// Issuing a refund is a supervisor action (admin + manager). Viewing refunds
// stays open to any authenticated user, like viewing sales.
router.post(
  "/:saleId/refunds",
  requirePermission("sales.refund"),
  refundController.createRefund,
);
router.get("/:saleId/refunds", refundController.getRefundsBySale);

module.exports = router;
