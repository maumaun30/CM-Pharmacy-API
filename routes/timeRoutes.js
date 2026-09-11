const express = require("express");
const router = express.Router();
const timeController = require("../controllers/timeController");
const { authenticateUser, requirePermission } = require("../middleware/authMiddleware");

router.use(authenticateUser);

// ── Own shift (mobile app) ───────────────────────────────────────────────────
router.get("/current", requirePermission("time.clock", "time.view_own"), timeController.getCurrent);
router.post("/clock-in", requirePermission("time.clock"), timeController.clockIn);
router.post("/clock-out", requirePermission("time.clock"), timeController.clockOut);
router.post("/break", requirePermission("time.clock"), timeController.toggleBreak);

// ── Timesheets ───────────────────────────────────────────────────────────────
// Both clients share this: the controller scopes to own entries unless the
// caller holds time.view_all, so a staff member cannot widen it from the query.
router.get("/entries", requirePermission("time.view_own", "time.view_all"), timeController.listEntries);
router.post("/entries/approve", requirePermission("time.approve"), timeController.approveEntries);
router.put("/entries/:id", requirePermission("time.approve"), timeController.updateEntry);

// ── Console supervision ──────────────────────────────────────────────────────
router.get("/on-shift", requirePermission("time.view_all"), timeController.getOnShift);
router.get("/overview", requirePermission("time.view_all"), timeController.getOverview);
router.get("/roster", requirePermission("time.view_own", "time.view_all"), timeController.getRoster);

// ── Audit log (admin) ────────────────────────────────────────────────────────
router.get("/audit", requirePermission("time.admin"), timeController.getAudit);

// ── Settings ─────────────────────────────────────────────────────────────────
router.get("/settings", requirePermission("time.view_all"), timeController.getSettings);
router.put("/settings/rules", requirePermission("time.settings"), timeController.updateClockRules);
router.put("/settings/pay-rules", requirePermission("time.settings"), timeController.updatePayRules);
router.post("/settings/access-points", requirePermission("time.settings"), timeController.addAccessPoint);
router.delete("/settings/access-points/:id", requirePermission("time.settings"), timeController.deleteAccessPoint);

module.exports = router;
