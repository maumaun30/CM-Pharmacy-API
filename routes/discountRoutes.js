const express = require("express");
const router = express.Router();
const discountController = require("../controllers/discountController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", discountController.getAllDiscounts);
router.get("/:id", authorizeRoles("admin"), discountController.getDiscountById);
router.post("/", authorizeRoles("admin"), discountController.createDiscount);
router.put("/:id", authorizeRoles("admin"), discountController.updateDiscount);
router.delete(
  "/:id",
  authorizeRoles("admin"),
  discountController.deleteDiscount,
);
router.patch(
  "/:id/toggle",
  authorizeRoles("admin"),
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
