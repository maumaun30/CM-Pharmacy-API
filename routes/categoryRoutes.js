const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", requirePermission("categories.read"), categoryController.getAllCategories);
router.get("/:id", requirePermission("categories.read"), categoryController.getCategoryById);
router.post("/", requirePermission("categories.write"), categoryController.createCategory);
router.put("/:id", requirePermission("categories.write"), categoryController.updateCategory);
router.delete(
  "/:id",
  requirePermission("categories.write"),
  categoryController.deleteCategory,
);

module.exports = router;
