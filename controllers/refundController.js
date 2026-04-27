const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");
const { emitDashboardRefresh, emitStockUpdate } = require("../utils/socket");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales/:saleId/refunds
//
// The refund flow touches multiple tables atomically:
//   refunds → refund_items → branch_stocks → stocks → sales (status update)
//
// Supabase JS has no client-side transaction API, so the write portion is
// handled by a Postgres function called via supabase.rpc().
//
// ── Create this function once in Supabase SQL Editor ─────────────────────────
//
// create or replace function process_refund(
//   p_sale_id       bigint,
//   p_branch_id     bigint,
//   p_refunded_by   bigint,
//   p_total_refund  numeric,
//   p_reason        text,
//   p_items         jsonb,
//   -- [{ sale_item_id, product_id, quantity, refund_amount }]
//   p_new_sale_status text
// )
// returns bigint as $$
// declare
//   v_refund_id      bigint;
//   v_item           jsonb;
//   v_current_stock  integer;
//   v_new_stock      integer;
// begin
//   -- 1. Create refund header
//   insert into refunds (sale_id, branch_id, refunded_by, total_refund, reason)
//   values (p_sale_id, p_branch_id, p_refunded_by, p_total_refund, p_reason)
//   returning id into v_refund_id;
//
//   -- 2. Process each item
//   for v_item in select * from jsonb_array_elements(p_items) loop
//     -- Create refund item
//     insert into refund_items (refund_id, sale_item_id, product_id, quantity, refund_amount)
//     values (
//       v_refund_id,
//       (v_item->>'sale_item_id')::bigint,
//       (v_item->>'product_id')::bigint,
//       (v_item->>'quantity')::integer,
//       (v_item->>'refund_amount')::numeric
//     );
//
//     -- Lock and fetch current branch stock
//     select current_stock into v_current_stock
//     from branch_stocks
//     where product_id = (v_item->>'product_id')::bigint
//       and branch_id  = p_branch_id
//     for update;
//
//     if v_current_stock is null then
//       raise exception 'BranchStock not found for product % at branch %',
//         (v_item->>'product_id'), p_branch_id;
//     end if;
//
//     v_new_stock := v_current_stock + (v_item->>'quantity')::integer;
//
//     -- Restore stock
//     update branch_stocks
//     set current_stock = v_new_stock
//     where product_id = (v_item->>'product_id')::bigint
//       and branch_id  = p_branch_id;
//
//     -- Log stock movement
//     insert into stocks (
//       product_id, branch_id, transaction_type,
//       quantity, quantity_before, quantity_after,
//       reference_id, reference_type, performed_by
//     )
//     values (
//       (v_item->>'product_id')::bigint,
//       p_branch_id,
//       'REFUND',
//       (v_item->>'quantity')::integer,
//       v_current_stock,
//       v_new_stock,
//       v_refund_id,
//       'refund',
//       p_refunded_by
//     );
//   end loop;
//
//   -- 3. Update sale status
//   update sales set status = p_new_sale_status where id = p_sale_id;
//
//   return v_refund_id;
// end;
// $$ language plpgsql;
// ─────────────────────────────────────────────────────────────────────────────

exports.createRefund = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { items, reason } = req.body;

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
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, role, branch_id, current_branch_id")
      .eq("id", req.user.id)
      .maybeSingle();

    if (userError) throw userError;

    const activeBranchId = user.current_branch_id || user.branch_id;
    if (!activeBranchId) {
      return res
        .status(400)
        .json({ message: "User is not assigned to any branch" });
    }

    // ── 3. Fetch the original sale with its items ────────────────────────────
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select(
        `
        id, branch_id, status,
        items:sale_items (
          id, product_id, quantity, price, discounted_price,
          product:products (id, name)
        )
      `,
      )
      .eq("id", saleId)
      .maybeSingle();

    if (saleError) throw saleError;
    if (!sale) return res.status(404).json({ message: "Sale not found" });

    if (user.role !== "admin" && sale.branch_id !== activeBranchId) {
      return res.status(403).json({
        message: "You are not allowed to refund sales from other branches",
      });
    }

    // ── 4. Fetch already-refunded quantities for this sale ───────────────────
    const { data: existingRefundItems, error: refundItemsError } =
      await supabase
        .from("refund_items")
        .select("sale_item_id, quantity, refund:refunds!inner (sale_id)")
        .eq("refund.sale_id", saleId);

    if (refundItemsError) throw refundItemsError;

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
      totalRefundedQty >= totalSaleQty
        ? "fully_refunded"
        : "partially_refunded";

    // ── 7. Execute atomic refund via RPC ─────────────────────────────────────
    const rpcItems = stockUpdates.map((su) => ({
      sale_item_id: su.saleItemId,
      product_id: su.productId,
      quantity: su.quantity,
      refund_amount: su.refundAmount,
    }));

    const { data: refundId, error: rpcError } = await supabase.rpc(
      "process_refund",
      {
        p_branch_id: sale.branch_id,
        p_items: rpcItems,
        p_new_sale_status: newSaleStatus,
        p_reason: reason || null,
        p_refunded_by: req.user.id,
        p_sale_id: parseInt(saleId),
        p_total_refund: calculatedTotalRefund,
      },
    );

    if (rpcError) throw rpcError;

    // ── 8. Fetch updated stock levels for socket emissions ───────────────────
    const productIds = stockUpdates.map((su) => su.productId);
    const { data: updatedStocks } = await supabase
      .from("branch_stocks")
      .select("product_id, current_stock")
      .eq("branch_id", sale.branch_id)
      .in("product_id", productIds);

    const stockMap = Object.fromEntries(
      (updatedStocks || []).map((s) => [s.product_id, s.current_stock]),
    );

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
      },
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
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales/:saleId/refunds
// ─────────────────────────────────────────────────────────────────────────────
exports.getRefundsBySale = async (req, res) => {
  try {
    const { saleId } = req.params;

    const { data: refunds, error } = await supabase
      .from("refunds")
      .select(
        `
        id, sale_id, total_refund, reason, created_at,
        refunder:users (id, username, first_name, last_name),
        items:refund_items (
          id, sale_item_id, quantity, refund_amount,
          product:products (id, name)
        )
      `,
      )
      .eq("sale_id", saleId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const response = refunds.map((refund) => ({
      id: refund.id,
      saleId: refund.sale_id,
      totalRefund: parseFloat(refund.total_refund),
      reason: refund.reason,
      createdAt: refund.created_at,
      refundedBy: refund.refunder
        ? {
            id: refund.refunder.id,
            name:
              refund.refunder.first_name && refund.refunder.last_name
                ? `${refund.refunder.first_name} ${refund.refunder.last_name}`.trim()
                : refund.refunder.username || "Unknown",
          }
        : null,
      items: refund.items.map((item) => ({
        id: item.id,
        saleItemId: item.sale_item_id,
        product: { id: item.product.id, name: item.product.name },
        quantity: item.quantity,
        refundAmount: parseFloat(item.refund_amount),
      })),
    }));

    return res.json(response);
  } catch (error) {
    console.error("Error fetching refunds:", error);
    return res
      .status(500)
      .json({ message: "Error fetching refunds", error: error.message });
  }
};
