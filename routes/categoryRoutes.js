const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");
const { cacheFor } = require("../middleware/cacheControl");

router.use(authenticateUser);

// Categories change rarely; let the client's HTTP cache answer repeat reads.
// 30s is short enough that a just-created category shows up on the next screen.
const cacheCategories = cacheFor(30);

router.get("/", cacheCategories, requirePermission("categories.read"), categoryController.getAllCategories);
router.get("/:id", cacheCategories, requirePermission("categories.read"), categoryController.getCategoryById);
router.post("/", requirePermission("categories.write"), categoryController.createCategory);
router.put("/:id", requirePermission("categories.write"), categoryController.updateCategory);
router.delete(
  "/:id",
  requirePermission("categories.write"),
  categoryController.deleteCategory,
);

module.exports = router;
