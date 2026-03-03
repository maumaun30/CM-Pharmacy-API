const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");
const refundController = require("../controllers/refundController");
const { authenticateUser } = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.post("/", saleController.createSale);
router.get("/", saleController.getSales);

router.post("/:saleId/refunds", refundController.createRefund);
router.get("/:saleId/refunds", refundController.getRefundsBySale);

module.exports = router;
