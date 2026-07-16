const { and, eq, desc, sql, count, inArray } = require("drizzle-orm");
const { alias } = require("drizzle-orm/pg-core");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { dbErrorMessage } = require("../utils/dbError");
const { invalidate } = require("../utils/cache");
const {
  emitRefundRequestNew,
  emitRefundRequestResolved,
  emitStockUpdate,
  emitDashboardRefresh,
} = require("../utils/socket");
const { notifyUsers, notifyBranchSupervisors } = require("../utils/notifications");
const { validateRefundItems } = require("./refundController");

const { users, sales, branchStocks, refundRequests } = schema;

// ─────────────────────────────────────────────────────────────────────────────
// Async refund requests: a cashier submits a request; an admin/manager reviews
// it remotely (new admin app or web /refunds). Approval executes the SAME
// atomic process_refund RPC as the direct/PIN refund path — this controller
// never touches stock on its own.
// ─────────────────────────────────────────────────────────────────────────────

// Project a Drizzle row to the snake_case response shape.
const toSnake = (row) => ({
  id: row.id,
  sale_id: row.saleId,
  branch_id: row.branchId,
  requested_by: row.requestedBy,
  items: row.items,
  reason: row.reason,
  total_refund: Number(row.totalRefund),
  status: row.status,
  reviewed_by: row.reviewedBy,
  review_note: row.reviewNote,
  refund_id: row.refundId,
  created_at: row.createdAt,
  reviewed_at: row.reviewedAt,
});

const displayName = (u) =>
  u && u.id
    ? u.first_name && u.last_name
      ? `${u.first_name} ${u.last_name}`.trim()
      : u.username || "Unknown"
    : null;

// ── POST /api/sales/:saleId/refund-requests ──────────────────────────────────
exports.createRefundRequest = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { items, reason } = req.body;

    const [user] = await db
      .select({ id: users.id, role: users.role, branch_id: users.branchId, current_branch_id: users.currentBranchId })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const activeBranchId = user.current_branch_id || user.branch_id;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    let sale, calculatedTotalRefund;
    try {
      ({ sale, calculatedTotalRefund } = await validateRefundItems(saleId, items));
    } catch (v) {
      if (v && v.status) return res.status(v.status).json({ message: v.message });
      throw v;
    }

    if (user.role !== "admin" && sale.branch_id !== activeBranchId) {
      return res.status(403).json({
        message: "You are not allowed to request refunds for sales from other branches",
      });
    }

    // A duplicate pending request for the same sale is confusing for reviewers.
    const [duplicate] = await db
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(and(eq(refundRequests.saleId, Number(saleId)), eq(refundRequests.status, "pending")))
      .limit(1);
    if (duplicate) {
      return res.status(409).json({
        message: `A pending refund request already exists for Sale #${saleId}`,
      });
    }

    const [inserted] = await db
      .insert(refundRequests)
      .values({
        saleId: Number(saleId),
        branchId: sale.branch_id,
        requestedBy: req.user.id,
        items: items.map((i) => ({ saleItemId: i.saleItemId, quantity: i.quantity })),
        reason: reason || null,
        totalRefund: calculatedTotalRefund,
      })
      .returning();

    const row = toSnake(inserted);

    await createLog(
      req,
      "CREATE",
      "refund_requests",
      row.id,
      `Requested refund of ₱${calculatedTotalRefund.toFixed(2)} for Sale #${saleId}`,
      { saleId: Number(saleId), items: items.length, totalRefund: calculatedTotalRefund, reason: reason || null }
    );

    await notifyBranchSupervisors(sale.branch_id, {
      type: "refund_request",
      title: "Refund request",
      body: `₱${calculatedTotalRefund.toFixed(2)} refund requested for Sale #${saleId} by ${req.user.username}`,
      data: { refundRequestId: row.id, saleId: Number(saleId) },
    });
    emitRefundRequestNew(sale.branch_id, row);

    return res.status(201).json({ message: "Refund request submitted", refund_request: row });
  } catch (error) {
    console.error("Create refund request error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── GET /api/refund-requests?status=&mine=true&page=&limit= ──────────────────
exports.listRefundRequests = async (req, res) => {
  try {
    const { status, mine } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    const conditions = [];
    if (status) conditions.push(eq(refundRequests.status, String(status)));

    const isReviewer = req.user.permissions.includes("refund_requests.review");
    if (mine === "true" || !isReviewer) {
      // Cashiers (and anyone asking for their own) see only their requests.
      conditions.push(eq(refundRequests.requestedBy, req.user.id));
    } else {
      // Reviewers: branch-scoped; admin with null current branch sees all.
      const activeBranchId = req.user.currentBranchId || req.user.branchId;
      if (!(req.user.role === "admin" && !req.user.currentBranchId)) {
        conditions.push(eq(refundRequests.branchId, activeBranchId));
      }
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const requester = alias(users, "requester");
    const reviewer = alias(users, "reviewer");

    const rows = await db
      .select({
        row: refundRequests,
        requester: {
          id: requester.id,
          username: requester.username,
          first_name: requester.firstName,
          last_name: requester.lastName,
        },
        reviewer: {
          id: reviewer.id,
          username: reviewer.username,
          first_name: reviewer.firstName,
          last_name: reviewer.lastName,
        },
        sale: { id: sales.id, total_amount: sales.totalAmount, created_at: sales.createdAt },
      })
      .from(refundRequests)
      .leftJoin(requester, eq(refundRequests.requestedBy, requester.id))
      .leftJoin(reviewer, eq(refundRequests.reviewedBy, reviewer.id))
      .leftJoin(sales, eq(refundRequests.saleId, sales.id))
      .where(where)
      .orderBy(desc(refundRequests.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ total }] = await db.select({ total: count() }).from(refundRequests).where(where);

    return res.json({
      refund_requests: rows.map((r) => ({
        ...toSnake(r.row),
        requester: r.requester?.id ? { id: r.requester.id, name: displayName(r.requester) } : null,
        reviewer: r.reviewer?.id ? { id: r.reviewer.id, name: displayName(r.reviewer) } : null,
        sale: r.sale?.id
          ? { id: r.sale.id, total_amount: Number(r.sale.total_amount), created_at: r.sale.created_at }
          : null,
      })),
      total: Number(total),
      page,
      limit,
    });
  } catch (error) {
    console.error("List refund requests error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// Claim a pending request (single-winner guard against double review).
const claimRequest = async (id, status, reviewerId, reviewNote = null) => {
  const [claimed] = await db
    .update(refundRequests)
    .set({
      status,
      reviewedBy: reviewerId,
      reviewNote,
      reviewedAt: sql`now()`,
    })
    .where(and(eq(refundRequests.id, Number(id)), eq(refundRequests.status, "pending")))
    .returning();
  return claimed || null;
};

const revertClaim = async (id) => {
  await db
    .update(refundRequests)
    .set({ status: "pending", reviewedBy: null, reviewNote: null, reviewedAt: null })
    .where(eq(refundRequests.id, Number(id)));
};

// ── PUT /api/refund-requests/:id/approve ─────────────────────────────────────
exports.approveRefundRequest = async (req, res) => {
  const { id } = req.params;
  let claimed = null;
  let refundExecuted = false;
  try {
    claimed = await claimRequest(id, "approved", req.user.id);
    if (!claimed) {
      return res.status(409).json({ message: "Request already reviewed" });
    }

    // Branch guard: a non-admin reviewer may only act on their active branch.
    const activeBranchId = req.user.currentBranchId || req.user.branchId;
    if (req.user.role !== "admin" && claimed.branchId !== activeBranchId) {
      await revertClaim(id);
      return res.status(403).json({
        message: "You are not allowed to review refund requests from other branches",
      });
    }

    // Quantities may no longer be refundable (e.g. a direct PIN refund landed
    // after this request was submitted) — re-validate before executing.
    let sale, stockUpdates, calculatedTotalRefund, newSaleStatus;
    try {
      ({ sale, stockUpdates, calculatedTotalRefund, newSaleStatus } =
        await validateRefundItems(claimed.saleId, claimed.items));
    } catch (v) {
      await revertClaim(id);
      if (v && v.status) return res.status(v.status).json({ message: v.message });
      throw v;
    }

    const rpcItems = stockUpdates.map((su) => ({
      sale_item_id: su.saleItemId,
      product_id: su.productId,
      quantity: su.quantity,
      refund_amount: su.refundAmount,
    }));

    const result = await db.execute(sql`
      select process_refund(
        ${claimed.saleId}::bigint,
        ${sale.branch_id}::bigint,
        ${req.user.id}::bigint,
        ${calculatedTotalRefund}::numeric,
        ${claimed.reason || null}::text,
        ${JSON.stringify(rpcItems)}::jsonb,
        ${newSaleStatus}::text
      ) as refund_id
    `);
    const refundId = Number(result.rows[0].refund_id);
    refundExecuted = true;

    const [updated] = await db
      .update(refundRequests)
      .set({ refundId })
      .where(eq(refundRequests.id, Number(id)))
      .returning();
    const row = toSnake(updated);

    // Everything past this point is best-effort: the refund is committed, so
    // notification/emission failures must not fail the request (or worse,
    // trigger a claim revert that would allow a second refund).
    try {
      invalidate("dashboard:");

      await createLog(
        req,
        "APPROVE",
        "refund_requests",
        row.id,
        `Approved refund request #${row.id} for Sale #${row.sale_id} - Refund: ₱${calculatedTotalRefund.toFixed(2)}`,
        { saleId: row.sale_id, refundId, totalRefund: calculatedTotalRefund, requestedBy: row.requested_by }
      );

      // Same emissions as the direct refund path.
      const productIds = stockUpdates.map((su) => su.productId);
      const updatedStocks = await db
        .select({ product_id: branchStocks.productId, current_stock: branchStocks.currentStock })
        .from(branchStocks)
        .where(and(eq(branchStocks.branchId, sale.branch_id), inArray(branchStocks.productId, productIds)));
      const stockMap = Object.fromEntries(updatedStocks.map((s) => [s.product_id, s.current_stock]));
      for (const su of stockUpdates) {
        emitStockUpdate(sale.branch_id, { productId: su.productId, newStock: stockMap[su.productId] ?? null });
      }
      emitDashboardRefresh(sale.branch_id);

      await notifyUsers([row.requested_by], {
        type: "refund_approved",
        title: "Refund request approved",
        body: `Your ₱${calculatedTotalRefund.toFixed(2)} refund request for Sale #${row.sale_id} was approved by ${req.user.username}`,
        data: { refundRequestId: row.id, saleId: row.sale_id, refundId },
        branchId: sale.branch_id,
      });
      emitRefundRequestResolved(sale.branch_id, row);
    } catch (postError) {
      console.error("Post-approval side effects error (refund already committed):", postError);
    }

    return res.json({ message: "Refund request approved", refund_request: row, refund_id: refundId });
  } catch (error) {
    console.error("Approve refund request error:", error);
    // Revert the claim ONLY if the refund itself never executed — otherwise a
    // revert would put a spent request back in the pending queue.
    if (claimed && !refundExecuted) {
      try {
        await revertClaim(id);
      } catch (revertError) {
        console.error("Failed to revert refund request claim:", revertError);
      }
    }
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/refund-requests/:id/decline ─────────────────────────────────────
exports.declineRefundRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body || {};

    const claimed = await claimRequest(id, "declined", req.user.id, reviewNote || null);
    if (!claimed) {
      return res.status(409).json({ message: "Request already reviewed" });
    }

    const activeBranchId = req.user.currentBranchId || req.user.branchId;
    if (req.user.role !== "admin" && claimed.branchId !== activeBranchId) {
      await revertClaim(id);
      return res.status(403).json({
        message: "You are not allowed to review refund requests from other branches",
      });
    }

    const row = toSnake(claimed);

    await createLog(
      req,
      "DECLINE",
      "refund_requests",
      row.id,
      `Declined refund request #${row.id} for Sale #${row.sale_id}`,
      { saleId: row.sale_id, requestedBy: row.requested_by, reviewNote: reviewNote || null }
    );

    await notifyUsers([row.requested_by], {
      type: "refund_declined",
      title: "Refund request declined",
      body:
        `Your refund request for Sale #${row.sale_id} was declined by ${req.user.username}` +
        (reviewNote ? ` — ${reviewNote}` : ""),
      data: { refundRequestId: row.id, saleId: row.sale_id },
      branchId: row.branch_id,
    });
    emitRefundRequestResolved(row.branch_id, row);

    return res.json({ message: "Refund request declined", refund_request: row });
  } catch (error) {
    console.error("Decline refund request error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};
