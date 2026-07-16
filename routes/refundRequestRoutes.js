const express = require("express");
const router = express.Router();
const refundRequestController = require("../controllers/refundRequestController");
const { authenticateUser, requirePermission } = require("../middleware/authMiddleware");

router.use(authenticateUser);

// Reviewers see the branch queue; requesters may list their own (?mine=true —
// the controller forces own-only scoping for non-reviewers).
router.get(
  "/",
  requirePermission("refund_requests.review", "refund_requests.create"),
  refundRequestController.listRefundRequests
);

router.put("/:id/approve", requirePermission("refund_requests.review"), refundRequestController.approveRefundRequest);
router.put("/:id/decline", requirePermission("refund_requests.review"), refundRequestController.declineRefundRequest);

module.exports = router;
