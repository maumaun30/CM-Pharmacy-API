const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  userController.getAllUsers,
);
router.post(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  userController.createUser,
);
router.put(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  userController.updateUser,
);
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles("admin"),
  userController.deleteUser,
);

module.exports = router;
