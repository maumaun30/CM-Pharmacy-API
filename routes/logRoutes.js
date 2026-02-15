// routes/logRoutes.js
const express = require("express");
const router = express.Router();
const logController = require("../controllers/logController");
const {
  authenticateUser,
  authorizeRoles,
} = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/", authorizeRoles("admin"), logController.getAllLogs);

router.get("/stats", authorizeRoles("admin"), logController.getLogStats);

router.get(
  "/:module/:recordId",
  authorizeRoles("admin"),
  logController.getRecordLogs,
);

module.exports = router;
