const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", authorizeRoles("admin"), categoryController.getAllCategories);
router.get("/:id", authorizeRoles("admin"), categoryController.getCategoryById);
router.post("/", authorizeRoles("admin"), categoryController.createCategory);
router.put("/:id", authorizeRoles("admin"), categoryController.updateCategory);
router.delete(
  "/:id",
  authorizeRoles("admin"),
  categoryController.deleteCategory,
);

module.exports = router;
