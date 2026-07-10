const express = require("express");
const router = express.Router();
const discountController = require("../controllers/discountController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", discountController.getAllDiscounts);
router.get("/:id", requirePermission("discounts.read"), discountController.getDiscountById);
router.post("/", requirePermission("discounts.write"), discountController.createDiscount);
router.put("/:id", requirePermission("discounts.write"), discountController.updateDiscount);
router.delete(
  "/:id",
  requirePermission("discounts.write"),
  discountController.deleteDiscount,
);
router.patch(
  "/:id/toggle",
  requirePermission("discounts.write"),
  discountController.toggleDiscountStatus,
);
router.get(
  "/product/:productId/applicable",
  discountController.getApplicableDiscounts,
);
router.get(
  "/product/:productId/calculate/:discountId",
  discountController.calculateProductDiscount,
);

module.exports = router;
