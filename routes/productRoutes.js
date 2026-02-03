const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.get("/", productController.getAllProducts);
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  productController.getProductById,
);
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  productController.createProduct,
);
router.put(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  productController.updateProduct,
);
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  productController.deleteProduct,
);
router.put(
  "/:id/stock",
  authenticateUser,
  authorizeRoles("admin"),
  productController.updateStock,
);

// NEW: Toggle product status
router.patch(
  "/:id/toggle-status",
  authenticateUser,
  authorizeRoles("admin"),
  productController.toggleProductStatus,
);

module.exports = router;