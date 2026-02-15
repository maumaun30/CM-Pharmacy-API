const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", productController.getAllProducts);
router.get("/:id", authorizeRoles("admin"), productController.getProductById);
router.post("/", authorizeRoles("admin"), productController.createProduct);
router.put("/:id", authorizeRoles("admin"), productController.updateProduct);
router.delete("/:id", authorizeRoles("admin"), productController.deleteProduct);
router.put(
  "/:id/stock",
  authorizeRoles("admin"),
  productController.updateStock,
);

router.patch(
  "/:id/toggle-status",
  authorizeRoles("admin"),
  productController.toggleProductStatus,
);

module.exports = router;
