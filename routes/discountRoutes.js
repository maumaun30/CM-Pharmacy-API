const express = require("express");
const router = express.Router();
const discountController = require("../controllers/discountController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// Get all discounts (public - to show active discounts to customers)
router.get("/", discountController.getAllDiscounts);

// Get discount by ID (admin only)
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  discountController.getDiscountById,
);

// Create new discount (admin only)
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  discountController.createDiscount,
);

// Update discount (admin only)
router.put(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  discountController.updateDiscount,
);

// Delete discount (admin only)
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  discountController.deleteDiscount,
);

// Toggle discount enabled/disabled status (admin only)
router.patch(
  "/:id/toggle",
  authenticateUser,
  authorizeRoles("admin"),
  discountController.toggleDiscountStatus,
);

// Get applicable discounts for a specific product (public)
router.get(
  "/product/:productId/applicable",
  discountController.getApplicableDiscounts,
);

// Calculate discount for a product (public - for cart/checkout)
router.get(
  "/product/:productId/calculate/:discountId",
  discountController.calculateProductDiscount,
);

module.exports = router;