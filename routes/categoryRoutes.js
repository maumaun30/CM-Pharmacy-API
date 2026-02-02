const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  categoryController.getAllCategories,
);
router.get(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  categoryController.getCategoryById,
);
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  categoryController.createCategory,
);
router.put(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  categoryController.updateCategory,
);
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  categoryController.deleteCategory,
);

module.exports = router;
