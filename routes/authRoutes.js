const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);

// Protected routes
router.get("/profile", authenticateUser, authController.getProfile);
router.put("/profile", authenticateUser, authController.updateProfile);

// Admin only routes
router.get(
  "/users",
  authenticateUser,
  authorizeRoles("admin"),
  authController.getAllUsers
);
router.put(
  "/users/:id",
  authenticateUser,
  authorizeRoles("admin"),
  authController.updateUser
);

module.exports = router;
