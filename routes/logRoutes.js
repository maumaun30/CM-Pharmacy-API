// routes/logRoutes.js
const express = require("express");
const router = express.Router();
const logController = require("../controllers/logController");
const {
  authenticateUser,
  requirePermission,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", requirePermission("logs.read"), logController.getAllLogs);

router.get("/stats", requirePermission("logs.read"), logController.getLogStats);

router.get(
  "/:module/:recordId",
  requirePermission("logs.read"),
  logController.getRecordLogs,
);

module.exports = router;
