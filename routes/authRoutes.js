const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

// Public routes
// router.post("/register", authController.register);
router.post("/login", authController.login);

// Protected routes
router.get("/profile", authenticateUser, authController.getProfile);
router.put("/profile", authenticateUser, authController.updateProfile);

router.post(
  "/switch-branch",
  authenticateUser,
  requirePermission("branches.switch"),
  authController.switchBranch,
);

router.get("/me", authenticateUser, authController.getCurrentUser);
router.put("/change-password", authenticateUser, authController.changePassword);

// Read-only role→permission matrix (Settings page).
router.get(
  "/roles",
  authenticateUser,
  requirePermission("users.read"),
  authController.getRoles,
);

router.post("/login-pin", authController.loginWithPin);
router.put("/pin", authenticateUser, authController.setPin);

// Google account linking (web + mobile share these endpoints).
router.post("/google", authController.googleLogin);                       // public
router.post("/google/link", authenticateUser, authController.linkGoogle); // authed
router.delete("/google/link", authenticateUser, authController.unlinkGoogle);

module.exports = router;
