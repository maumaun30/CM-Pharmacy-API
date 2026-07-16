const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticateUser, requirePermission } = require("../middleware/authMiddleware");

router.use(authenticateUser);
router.use(requirePermission("notifications.read"));

router.get("/", notificationController.listNotifications);
router.put("/read-all", notificationController.markAllRead);
router.put("/:id/read", notificationController.markRead);

module.exports = router;
