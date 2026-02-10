// routes/logRoutes.js
const express = require("express");
const router = express.Router();
const logController = require("../controllers/logController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

// All log routes require admin access
router.get(
  "/",
  authenticateUser,
  authorizeRoles("admin"),
  logController.getAllLogs
);

router.get(
  "/stats",
  authenticateUser,
  authorizeRoles("admin"),
  logController.getLogStats
);

router.get(
  "/:module/:recordId",
  authenticateUser,
  authorizeRoles("admin"),
  logController.getRecordLogs
);

module.exports = router;