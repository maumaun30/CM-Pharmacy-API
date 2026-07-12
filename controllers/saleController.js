const { and, eq, inArray, desc, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { createLog } = require("../middleware/logMiddleware");
const { dbErrorMessage } = require("../utils/dbError");
const {
  emitNewSale,
  emitDashboardRefresh,
  emitStockUpdate,
  emitLowStockAlert,
} = require("../utils/socket");

const { users, products, branchStocks, sales, saleItems, branches, discounts } = schema;

// ─────────────────────────────────────────────────────────────────────────────
// createSale uses the create_sale Postgres RPC for atomicity.
// The function definition lives in db/functions/create_sale.sql (loaded by
// db/bootstrap.sh). It atomically:
//   1. inserts the sale header
//   2. inserts each sale_item
//   3. for products with track_inventory = true, locks branch_stocks FOR UPDATE,
//      validates + deducts stock, and RAISEs "Insufficient stock for product %"
//      if any product is short. Products with track_inventory = false skip all
//      branch_stocks handling (the pre-check in this controller skips them too).
// Keep db/functions/create_sale.sql in sync with any changes to sale/stock logic.
// ─────────────────────────────────────────────────────────────────────────────

exports.createSale = async (req, res) => {
  try {
    const {
      cart, subtotal, totalDiscount, total, cashAmount,
      customerName, customerIdNumber, customerDiscountType,
    } = req.body;

    // ── 1. Resolve user and active branch ────────────────────────────────────
    const [user] = await db
      .select({ id: users.id, role: users.role, branch_id: users.branchId, current_branch_id: users.currentBranchId })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const activeBranchId = user.current_branch_id || user.branch_id;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    // ── 2. Input validation ──────────────────────────────────────────────────
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty or invalid" });
    }

    for (const item of cart) {
      const productId = item.productId || item.product?.id;
      if (!productId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: "Invalid cart item format", receivedItem: item });
      }
    }

    // ── 3. Fetch products with branch stock (left join to the active branch) ──
    // Left join so products that don't track inventory (no branch_stocks row)
    // are still returned; stock is validated below only for tracked products.
    const productIds = cart.map((item) => item.productId || item.product.id);

    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        track_inventory: products.trackInventory,
        branch_id: branchStocks.branchId,
        current_stock: branchStocks.currentStock,
      })
      .from(products)
      .leftJoin(
        branchStocks,
        and(eq(branchStocks.productId, products.id), eq(branchStocks.branchId, activeBranchId))
      )
      .where(inArray(products.id, productIds));

    const productMap = new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          price: r.price,
          track_inventory: r.track_inventory,
          branch_stocks: r.branch_id != null ? [{ branch_id: r.branch_id, current_stock: r.current_stock }] : [],
        },
      ])
    );

    // ── 4. Validate stock and calculate totals ────────────────────────────────
    let calculatedSubtotal = 0;
    let calculatedTotalDiscount = 0;

    for (const item of cart) {
      const productId = item.productId || item.product.id;
      const product = productMap.get(productId);

      if (!product) {
        return res.status(404).json({ message: `Product ID ${productId} not found` });
      }

      // Stock is only validated for products that track inventory. Untracked
      // products (services / non-stock items) sell freely regardless of any
      // branch_stocks row, matching the create_sale RPC.
      if (product.track_inventory) {
        const branchStock = product.branch_stocks[0];
        if (!branchStock) {
          return res.status(404).json({ message: `Product "${product.name}" not available at this branch` });
        }

        if (item.quantity > branchStock.current_stock) {
          return res.status(400).json({
            message: `Insufficient stock for ${product.name} at this branch. Available: ${branchStock.current_stock}, Requested: ${item.quantity}`,
          });
        }
      }

      calculatedSubtotal += Number(product.price) * item.quantity;

      if (item.discountId && item.discountedPrice) {
        calculatedTotalDiscount +=
          (Number(product.price) - Number(item.discountedPrice)) * item.quantity;
      }
    }

    const calculatedTotal = calculatedSubtotal - calculatedTotalDiscount;

    // Validate totals (allow small floating point differences)
    if (subtotal && Math.abs(calculatedSubtotal - subtotal) > 0.01) {
      return res.status(400).json({ message: "Subtotal mismatch", calculated: calculatedSubtotal, received: subtotal });
    }
    if (totalDiscount && Math.abs(calculatedTotalDiscount - totalDiscount) > 0.01) {
      return res.status(400).json({ message: "Total discount mismatch", calculated: calculatedTotalDiscount, received: totalDiscount });
    }

    // ── 5. Build RPC item payload ─────────────────────────────────────────────
    const rpcItems = cart.map((item) => {
      const productId = item.productId || item.product.id;
      const product = productMap.get(productId);
      const price = Number(product.price);
      const discountedPrice = item.discountedPrice ? Number(item.discountedPrice) : null;

      return {
        product_id: productId,
        quantity: item.quantity,
        price,
        discounted_price: discountedPrice !== null ? String(discountedPrice) : "",
        discount_id: item.discountId ? String(item.discountId) : "",
        discount_amount: discountedPrice ? (price - discountedPrice) * item.quantity : 0,
      };
    });

    // ── 6. Execute atomic sale via RPC ────────────────────────────────────────
    const parsedCash = cashAmount ? parseFloat(cashAmount) : null;
    const result = await db.execute(sql`
      select create_sale(
        ${req.user.id}::bigint,
        ${activeBranchId}::bigint,
        ${calculatedSubtotal}::numeric,
        ${calculatedTotalDiscount}::numeric,
        ${calculatedTotal}::numeric,
        ${parsedCash}::numeric,
        ${parsedCash !== null ? parsedCash - calculatedTotal : null}::numeric,
        ${JSON.stringify(rpcItems)}::jsonb,
        ${customerName || null}::text,
        ${customerIdNumber || null}::text,
        ${customerDiscountType || null}::text
      ) as sale_id
    `);
    // create_sale returns bigint; node-pg yields it as a string.
    const saleId = Number(result.rows[0].sale_id);

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    await createLog(
      req,
      "SALE",
      "sales",
      saleId,
      `Completed sale #${saleId} - Total: ₱${calculatedTotal.toFixed(2)}`,
      { items: cart.length, total: calculatedTotal, discount: calculatedTotalDiscount, branch: activeBranchId }
    );

    // ── 8. Fetch sale + seller for socket emission ─────────────────────────────
    const [completeSale] = await db
      .select({
        id: sales.id,
        total_amount: sales.totalAmount,
        sold_at: sales.soldAt,
        branch_id: sales.branchId,
        seller: { id: users.id, username: users.username, first_name: users.firstName, last_name: users.lastName },
      })
      .from(sales)
      .leftJoin(users, eq(sales.soldBy, users.id))
      .where(eq(sales.id, saleId))
      .limit(1);

    // ── 9. Fetch updated stock levels for socket emissions ────────────────────
    // Also pull thresholds so a sale that drives stock low/critical raises an alert.
    const updatedStocks = await db
      .select({
        product_id: branchStocks.productId,
        current_stock: branchStocks.currentStock,
        reorder_point: branchStocks.reorderPoint,
        minimum_stock: branchStocks.minimumStock,
      })
      .from(branchStocks)
      .where(and(eq(branchStocks.branchId, activeBranchId), inArray(branchStocks.productId, productIds)));

    const stockMap = Object.fromEntries(updatedStocks.map((s) => [s.product_id, s]));

    // ── 10. Socket emissions ───────────────────────────────────────────────────
    if (completeSale) {
      const seller = completeSale.seller?.id ? completeSale.seller : null;
      emitNewSale({
        id: completeSale.id,
        totalAmount: parseFloat(completeSale.total_amount),
        soldAt: completeSale.sold_at,
        branchId: completeSale.branch_id,
        user: {
          fullName: seller
            ? `${seller.first_name || ""} ${seller.last_name || ""}`.trim() || seller.username
            : "Unknown",
          username: seller?.username || "unknown",
        },
      });

      emitDashboardRefresh(completeSale.branch_id);
    }

    for (const item of cart) {
      const productId = item.productId || item.product.id;
      // Untracked products have no branch_stocks row → nothing to broadcast.
      if (!(productId in stockMap)) continue;
      const row = stockMap[productId];
      const newStock = row.current_stock;
      emitStockUpdate(activeBranchId, { productId, newStock });
      console.log(`📦 Stock update emitted: Product ${productId} -> ${newStock} units (Branch ${activeBranchId})`);

      // If this sale drove the product to/below its reorder point, alert the
      // branch (and admins). The client distinguishes critical (≤ minimum) from
      // low using the thresholds in the payload.
      if (row.reorder_point != null && newStock <= row.reorder_point) {
        const product = productMap.get(productId);
        emitLowStockAlert(activeBranchId, {
          id: productId,
          name: product?.name ?? `#${productId}`,
          current_stock: newStock,
          reorder_point: row.reorder_point,
          minimum_stock: row.minimum_stock,
          branch_id: activeBranchId,
        });
      }
    }

    // ── 11. Response ───────────────────────────────────────────────────────────
    return res.status(201).json({
      message: "Sale recorded successfully",
      saleId,
      subtotal: calculatedSubtotal,
      totalDiscount: calculatedTotalDiscount,
      totalAmount: calculatedTotal,
      cashAmount: cashAmount || null,
      changeAmount: cashAmount ? cashAmount - calculatedTotal : null,
    });
  } catch (error) {
    console.error("Sale error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales
// ─────────────────────────────────────────────────────────────────────────────

exports.getSales = async (req, res) => {
  try {
    const [user] = await db
      .select({ id: users.id, role: users.role, branch_id: users.branchId, current_branch_id: users.currentBranchId })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    const activeBranchId = user.current_branch_id || user.branch_id;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    // Branch filter — mirror original logic.
    const conds = [];
    if (user.role !== "admin") conds.push(eq(sales.branchId, activeBranchId));
    else if (user.current_branch_id) conds.push(eq(sales.branchId, user.current_branch_id));
    // admin with no current_branch_id → no filter, sees all.

    const saleRows = await db
      .select({
        id: sales.id,
        subtotal: sales.subtotal,
        total_discount: sales.totalDiscount,
        total_amount: sales.totalAmount,
        cash_amount: sales.cashAmount,
        change_amount: sales.changeAmount,
        customer_name: sales.customerName,
        customer_id_number: sales.customerIdNumber,
        customer_discount_type: sales.customerDiscountType,
        sold_at: sales.soldAt,
        sold_by: sales.soldBy,
        branch_id: sales.branchId,
        status: sales.status,
        branch: {
          id: branches.id, name: branches.name, code: branches.code,
          address: branches.address, city: branches.city, province: branches.province,
          postal_code: branches.postalCode, phone: branches.phone, tin: branches.tin,
        },
        seller: { id: users.id, username: users.username, email: users.email, first_name: users.firstName, last_name: users.lastName },
      })
      .from(sales)
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .leftJoin(users, eq(sales.soldBy, users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(sales.soldAt));

    // Fetch and group sale_items (with product + discount).
    const saleIds = saleRows.map((s) => s.id);
    const itemRows = saleIds.length
      ? await db
          .select({
            sale_id: saleItems.saleId,
            id: saleItems.id,
            quantity: saleItems.quantity,
            price: saleItems.price,
            discounted_price: saleItems.discountedPrice,
            discount_amount: saleItems.discountAmount,
            product: { id: products.id, name: products.name },
            discount: { id: discounts.id, name: discounts.name, discount_type: discounts.discountType, discount_value: discounts.discountValue, discount_category: discounts.discountCategory },
          })
          .from(saleItems)
          .leftJoin(products, eq(saleItems.productId, products.id))
          .leftJoin(discounts, eq(saleItems.discountId, discounts.id))
          .where(inArray(saleItems.saleId, saleIds))
      : [];

    const itemsBySale = new Map();
    for (const it of itemRows) {
      if (!itemsBySale.has(it.sale_id)) itemsBySale.set(it.sale_id, []);
      itemsBySale.get(it.sale_id).push(it);
    }

    const response = saleRows.map((sale) => {
      const branch = sale.branch?.id ? sale.branch : null;
      const seller = sale.seller?.id ? sale.seller : null;
      const items = itemsBySale.get(sale.id) || [];

      return {
        id: sale.id,
        branch: branch ?? null,
        subtotal: sale.subtotal ? parseFloat(sale.subtotal) : null,
        totalDiscount: sale.total_discount ? parseFloat(sale.total_discount) : 0,
        totalAmount: parseFloat(sale.total_amount),
        cashAmount: sale.cash_amount ? parseFloat(sale.cash_amount) : null,
        changeAmount: sale.change_amount ? parseFloat(sale.change_amount) : null,
        customerName: sale.customer_name ?? null,
        customerIdNumber: sale.customer_id_number ?? null,
        customerDiscountType: sale.customer_discount_type ?? null,
        soldAt: sale.sold_at,
        soldBy: sale.sold_by,
        status: sale.status,
        seller: seller
          ? {
              id: seller.id,
              name:
                seller.first_name && seller.last_name
                  ? `${seller.first_name} ${seller.last_name}`.trim()
                  : seller.username || "Unknown",
              email: seller.email,
            }
          : null,
        items: items.map((item) => {
          const discount = item.discount?.id ? item.discount : null;
          return {
            id: item.id,
            product: { id: item.product.id, name: item.product.name },
            quantity: item.quantity,
            price: parseFloat(item.price),
            discountedPrice: item.discounted_price ? parseFloat(item.discounted_price) : null,
            discountAmount: item.discount_amount ? parseFloat(item.discount_amount) : 0,
            discount: discount
              ? {
                  id: discount.id,
                  name: discount.name,
                  type: discount.discount_type,
                  value: parseFloat(discount.discount_value),
                  category: discount.discount_category,
                }
              : null,
          };
        }),
      };
    });

    return res.json(response);
  } catch (error) {
    console.error("Error fetching sales:", error);
    return res.status(500).json({ message: "Error fetching sales", error: dbErrorMessage(error) });
  }
};
