const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");
const refundController = require("../controllers/refundController");
const { authenticateUser } = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.post("/", saleController.createSale);
router.get("/", saleController.getSales);

// Refunds are a supervisor action: admin/manager do them directly; a cashier
// may process one only by supplying a valid manager PIN (enforced in the
// controller, so the route stays open to any authenticated user). Viewing
// refunds stays open like viewing sales.
router.post("/:saleId/refunds", refundController.createRefund);
router.get("/:saleId/refunds", refundController.getRefundsBySale);

module.exports = router;
