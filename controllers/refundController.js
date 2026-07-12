const bcrypt = require("bcryptjs");
const { and, eq, desc, inArray, isNotNull, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { dbErrorMessage } = require("../utils/dbError");
const { emitDashboardRefresh, emitStockUpdate } = require("../utils/socket");
const { invalidate } = require("../utils/cache");

const { users, products, branchStocks, sales, saleItems, refunds, refundItems } = schema;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales/:saleId/refunds
//
// The refund write path is atomic via the process_refund Postgres function
// (db/functions/process_refund.sql): refunds → refund_items → branch_stocks
// (restore) → stocks (ledger) → sales.status. Keep that SQL in sync with any
// refund/stock logic changes.
// ─────────────────────────────────────────────────────────────────────────────

exports.createRefund = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { items, reason, managerPin } = req.body;

    // ── 1. Input validation ──────────────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Refund items are required" });
    }
    for (const item of items) {
      if (!item.saleItemId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          message: "Each refund item must have a valid saleItemId and quantity",
        });
      }
    }

    // ── 2. Resolve user and active branch ────────────────────────────────────
    const [user] = await db
      .select({ id: users.id, role: users.role, branch_id: users.branchId, current_branch_id: users.currentBranchId })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const activeBranchId = user.current_branch_id || user.branch_id;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    // ── 3. Fetch the original sale with its items ────────────────────────────
    const [sale] = await db
      .select({ id: sales.id, branch_id: sales.branchId, status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    if (!sale) return res.status(404).json({ message: "Sale not found" });

    if (user.role !== "admin" && sale.branch_id !== activeBranchId) {
      return res.status(403).json({
        message: "You are not allowed to refund sales from other branches",
      });
    }

    // ── 3a. Authorization ────────────────────────────────────────────────────
    // Admin/manager refund directly. Anyone else (cashier) must supply a valid
    // manager/admin PIN to authorize the refund; we record who authorized it.
    let authorizer = null;
    const canRefundDirectly = user.role === "admin" || user.role === "manager";
    if (!canRefundDirectly) {
      if (!managerPin) {
        return res.status(403).json({
          message: "A manager PIN is required to authorize this refund.",
        });
      }
      const supervisors = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          pin: users.pin,
          branch_id: users.branchId,
          current_branch_id: users.currentBranchId,
        })
        .from(users)
        .where(and(inArray(users.role, ["admin", "manager"]), isNotNull(users.pin), eq(users.isActive, true)));

      for (const s of supervisors) {
        // Admins can authorize anywhere; a manager only at their own branch.
        const branchOk =
          s.role === "admin" ||
          s.branch_id === activeBranchId ||
          s.current_branch_id === activeBranchId;
        if (branchOk && (await bcrypt.compare(String(managerPin), s.pin))) {
          authorizer = s;
          break;
        }
      }
      if (!authorizer) {
        return res.status(403).json({ message: "Invalid manager PIN." });
      }
    }

    sale.items = await db
      .select({
        id: saleItems.id,
        product_id: saleItems.productId,
        quantity: saleItems.quantity,
        price: saleItems.price,
        discounted_price: saleItems.discountedPrice,
        product: { id: products.id, name: products.name },
      })
      .from(saleItems)
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(eq(saleItems.saleId, saleId));

    // ── 4. Fetch already-refunded quantities for this sale ───────────────────
    const existingRefundItems = await db
      .select({ sale_item_id: refundItems.saleItemId, quantity: refundItems.quantity })
      .from(refundItems)
      .innerJoin(refunds, eq(refundItems.refundId, refunds.id))
      .where(eq(refunds.saleId, saleId));

    const alreadyRefunded = existingRefundItems.reduce((acc, ri) => {
      acc[ri.sale_item_id] = (acc[ri.sale_item_id] || 0) + ri.quantity;
      return acc;
    }, {});

    // ── 5. Validate each requested refund item ───────────────────────────────
    const saleItemMap = new Map(sale.items.map((si) => [si.id, si]));
    let calculatedTotalRefund = 0;
    const stockUpdates = [];

    for (const item of items) {
      const saleItem = saleItemMap.get(item.saleItemId);
      if (!saleItem) {
        return res.status(404).json({
          message: `SaleItem ID ${item.saleItemId} does not belong to Sale #${saleId}`,
        });
      }

      const previouslyRefunded = alreadyRefunded[item.saleItemId] || 0;
      const refundableQty = saleItem.quantity - previouslyRefunded;

      if (item.quantity > refundableQty) {
        return res.status(400).json({
          message: `Cannot refund ${item.quantity} of "${saleItem.product.name}". Refundable: ${refundableQty}`,
        });
      }

      const unitPrice = saleItem.discounted_price
        ? Number(saleItem.discounted_price)
        : Number(saleItem.price);
      const refundAmount = unitPrice * item.quantity;

      calculatedTotalRefund += refundAmount;
      stockUpdates.push({
        productId: saleItem.product_id,
        quantity: item.quantity,
        saleItemId: saleItem.id,
        refundAmount,
        unitPrice,
      });
    }

    // ── 6. Determine new sale status ─────────────────────────────────────────
    const totalSaleQty = sale.items.reduce((s, i) => s + i.quantity, 0);
    const totalRefundedQty =
      Object.values(alreadyRefunded).reduce((s, q) => s + q, 0) +
      items.reduce((s, i) => s + i.quantity, 0);

    const newSaleStatus =
      totalRefundedQty >= totalSaleQty ? "fully_refunded" : "partially_refunded";

    // ── 7. Execute atomic refund via RPC ─────────────────────────────────────
    const rpcItems = stockUpdates.map((su) => ({
      sale_item_id: su.saleItemId,
      product_id: su.productId,
      quantity: su.quantity,
      refund_amount: su.refundAmount,
    }));

    const result = await db.execute(sql`
      select process_refund(
        ${parseInt(saleId)}::bigint,
        ${sale.branch_id}::bigint,
        ${req.user.id}::bigint,
        ${calculatedTotalRefund}::numeric,
        ${reason || null}::text,
        ${JSON.stringify(rpcItems)}::jsonb,
        ${newSaleStatus}::text
      ) as refund_id
    `);
    const refundId = Number(result.rows[0].refund_id);

    // ── 8. Fetch updated stock levels for socket emissions ───────────────────
    const productIds = stockUpdates.map((su) => su.productId);
    const updatedStocks = await db
      .select({ product_id: branchStocks.productId, current_stock: branchStocks.currentStock })
      .from(branchStocks)
      .where(and(eq(branchStocks.branchId, sale.branch_id), inArray(branchStocks.productId, productIds)));

    const stockMap = Object.fromEntries(updatedStocks.map((s) => [s.product_id, s.current_stock]));

    // Bust the dashboard cache so the refetch reflects the refund immediately.
    invalidate("dashboard:");

    // ── 9. Audit log ─────────────────────────────────────────────────────────
    await createLog(
      req,
      "REFUND",
      "refunds",
      refundId,
      `Processed refund #${refundId} for Sale #${saleId} - Refund: ₱${calculatedTotalRefund.toFixed(2)}`,
      {
        saleId: parseInt(saleId),
        items: items.length,
        totalRefund: calculatedTotalRefund,
        reason: reason || null,
        branch: sale.branch_id,
        authorizedBy: authorizer
          ? { id: authorizer.id, username: authorizer.username, role: authorizer.role }
          : null,
      }
    );

    // ── 10. Socket emissions ──────────────────────────────────────────────────
    for (const su of stockUpdates) {
      emitStockUpdate(sale.branch_id, {
        productId: su.productId,
        newStock: stockMap[su.productId] ?? null,
      });
    }
    emitDashboardRefresh(sale.branch_id);

    // ── 11. Response ──────────────────────────────────────────────────────────
    return res.status(201).json({
      message: "Refund processed successfully",
      refundId,
      saleId: parseInt(saleId),
      totalRefund: calculatedTotalRefund,
      reason: reason || null,
      items: stockUpdates.map((su) => ({
        saleItemId: su.saleItemId,
        productId: su.productId,
        quantity: su.quantity,
        refundAmount: su.refundAmount,
      })),
    });
  } catch (error) {
    console.error("Refund error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales/:saleId/refunds
// ─────────────────────────────────────────────────────────────────────────────
exports.getRefundsBySale = async (req, res) => {
  try {
    const { saleId } = req.params;

    const refundRows = await db
      .select({
        id: refunds.id,
        sale_id: refunds.saleId,
        total_refund: refunds.totalRefund,
        reason: refunds.reason,
        created_at: refunds.createdAt,
        refunder: { id: users.id, username: users.username, first_name: users.firstName, last_name: users.lastName },
      })
      .from(refunds)
      .leftJoin(users, eq(refunds.refundedBy, users.id))
      .where(eq(refunds.saleId, saleId))
      .orderBy(desc(refunds.createdAt));

    const refundIds = refundRows.map((r) => r.id);
    const itemRows = refundIds.length
      ? await db
          .select({
            refund_id: refundItems.refundId,
            id: refundItems.id,
            sale_item_id: refundItems.saleItemId,
            quantity: refundItems.quantity,
            refund_amount: refundItems.refundAmount,
            product: { id: products.id, name: products.name },
          })
          .from(refundItems)
          .leftJoin(products, eq(refundItems.productId, products.id))
          .where(inArray(refundItems.refundId, refundIds))
      : [];

    const itemsByRefund = new Map();
    for (const it of itemRows) {
      if (!itemsByRefund.has(it.refund_id)) itemsByRefund.set(it.refund_id, []);
      itemsByRefund.get(it.refund_id).push(it);
    }

    const response = refundRows.map((refund) => {
      const refunder = refund.refunder?.id ? refund.refunder : null;
      return {
        id: refund.id,
        saleId: refund.sale_id,
        totalRefund: parseFloat(refund.total_refund),
        reason: refund.reason,
        createdAt: refund.created_at,
        refundedBy: refunder
          ? {
              id: refunder.id,
              name:
                refunder.first_name && refunder.last_name
                  ? `${refunder.first_name} ${refunder.last_name}`.trim()
                  : refunder.username || "Unknown",
            }
          : null,
        items: (itemsByRefund.get(refund.id) || []).map((item) => ({
          id: item.id,
          saleItemId: item.sale_item_id,
          product: { id: item.product.id, name: item.product.name },
          quantity: item.quantity,
          refundAmount: parseFloat(item.refund_amount),
        })),
      };
    });

    return res.json(response);
  } catch (error) {
    console.error("Error fetching refunds:", error);
    return res.status(500).json({ message: "Error fetching refunds", error: dbErrorMessage(error) });
  }
};
