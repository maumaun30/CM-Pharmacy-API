const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// All routes require authentication
router.use(authenticateUser);

// Get all products
// Query params: categoryId, minPrice, maxPrice, requiresPrescription, search, inStock, status, branchId
router.get("/", productController.getAllProducts);

// Get product by ID
// Query params: branchId (optional, to filter branch stocks)
router.get("/:id", productController.getProductById);

// Create new product
router.post(
  "/",
  authorizeRoles(["admin", "manager"]),
  productController.createProduct,
);

// Update product
router.put(
  "/:id",
  authorizeRoles(["admin", "manager"]),
  productController.updateProduct,
);

// Delete product
router.delete(
  "/:id",
  authorizeRoles(["admin"]),
  productController.deleteProduct,
);

// Toggle product status
router.patch(
  "/:id/toggle-status",
  authorizeRoles(["admin", "manager"]),
  productController.toggleProductStatus,
);

// Get product stock for specific branch
router.get(
  "/:productId/branch/:branchId/stock",
  productController.getProductBranchStock,
);

// Update stock levels for specific branch (thresholds only)
router.patch(
  "/:productId/branch/:branchId/stock",
  authorizeRoles(["admin", "manager"]),
  productController.updateBranchStock,
);

// Get low stock products
// Query params: branchId (optional)
router.get("/reports/low-stock", productController.getLowStockProducts);

module.exports = router;
