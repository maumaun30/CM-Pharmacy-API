const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");
const {
  emitNewSale,
  emitDashboardRefresh,
  emitStockUpdate,
} = require("../utils/socket");

// ─────────────────────────────────────────────────────────────────────────────
// createSale uses a Postgres RPC for atomicity.
//
// Create this function once in Supabase SQL Editor:
//
// create or replace function create_sale(
//   p_sold_by      bigint,
//   p_branch_id    bigint,
//   p_subtotal     numeric,
//   p_discount     numeric,
//   p_total        numeric,
//   p_cash         numeric,
//   p_change       numeric,
//   p_items        jsonb
//   -- [{ product_id, quantity, price, discounted_price, discount_id, discount_amount }]
// )
// returns bigint as $$
// declare
//   v_sale_id       bigint;
//   v_item          jsonb;
//   v_current_stock integer;
//   v_new_stock     integer;
// begin
//   -- 1. Create sale header
//   insert into sales (
//     sold_by, branch_id, subtotal, total_discount,
//     total_amount, cash_amount, change_amount
//   )
//   values (
//     p_sold_by, p_branch_id, p_subtotal, p_discount,
//     p_total, p_cash, p_change
//   )
//   returning id into v_sale_id;
//
//   -- 2. Process each cart item
//   for v_item in select * from jsonb_array_elements(p_items) loop
//     -- Create sale item
//     insert into sale_items (
//       sale_id, product_id, quantity, price,
//       discounted_price, discount_id, discount_amount
//     )
//     values (
//       v_sale_id,
//       (v_item->>'product_id')::bigint,
//       (v_item->>'quantity')::integer,
//       (v_item->>'price')::numeric,
//       nullif(v_item->>'discounted_price', '')::numeric,
//       nullif(v_item->>'discount_id', '')::bigint,
//       (v_item->>'discount_amount')::numeric
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
//     v_new_stock := v_current_stock - (v_item->>'quantity')::integer;
//
//     if v_new_stock < 0 then
//       raise exception 'Insufficient stock for product %. Available: %, Requested: %',
//         (v_item->>'product_id'), v_current_stock, (v_item->>'quantity')::integer;
//     end if;
//
//     -- Deduct stock
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
//       'SALE',
//       -(v_item->>'quantity')::integer,
//       v_current_stock,
//       v_new_stock,
//       v_sale_id,
//       'sale',
//       p_sold_by
//     );
//   end loop;
//
//   return v_sale_id;
// end;
// $$ language plpgsql;
// ─────────────────────────────────────────────────────────────────────────────

exports.createSale = async (req, res) => {
  try {
    const { cart, subtotal, totalDiscount, total, cashAmount } = req.body;

    // ── 1. Resolve user and active branch ────────────────────────────────────
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

    // ── 2. Input validation ──────────────────────────────────────────────────
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty or invalid" });
    }

    for (const item of cart) {
      const productId = item.productId || item.product?.id;
      if (!productId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          message: "Invalid cart item format",
          receivedItem: item,
        });
      }
    }

    // ── 3. Fetch products with branch stock ───────────────────────────────────
    const productIds = cart.map((item) => item.productId || item.product.id);

    const { data: products, error: productError } = await supabase
      .from("products")
      .select(
        `
        id, name, price,
        branch_stocks!inner (branch_id, current_stock)
      `,
      )
      .in("id", productIds)
      .eq("branch_stocks.branch_id", activeBranchId);

    if (productError) throw productError;

    const productMap = new Map(products.map((p) => [p.id, p]));

    // ── 4. Validate stock and calculate totals ────────────────────────────────
    let calculatedSubtotal = 0;
    let calculatedTotalDiscount = 0;

    for (const item of cart) {
      const productId = item.productId || item.product.id;
      const product = productMap.get(productId);

      if (!product) {
        return res
          .status(404)
          .json({ message: `Product ID ${productId} not found` });
      }

      const branchStock = product.branch_stocks[0];
      if (!branchStock) {
        return res.status(404).json({
          message: `Product "${product.name}" not available at this branch`,
        });
      }

      if (item.quantity > branchStock.current_stock) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name} at this branch. Available: ${branchStock.current_stock}, Requested: ${item.quantity}`,
        });
      }

      calculatedSubtotal += Number(product.price) * item.quantity;

      if (item.discountId && item.discountedPrice) {
        calculatedTotalDiscount +=
          (Number(product.price) - Number(item.discountedPrice)) *
          item.quantity;
      }
    }

    const calculatedTotal = calculatedSubtotal - calculatedTotalDiscount;

    // Validate totals (allow small floating point differences)
    if (subtotal && Math.abs(calculatedSubtotal - subtotal) > 0.01) {
      return res.status(400).json({
        message: "Subtotal mismatch",
        calculated: calculatedSubtotal,
        received: subtotal,
      });
    }
    if (
      totalDiscount &&
      Math.abs(calculatedTotalDiscount - totalDiscount) > 0.01
    ) {
      return res.status(400).json({
        message: "Total discount mismatch",
        calculated: calculatedTotalDiscount,
        received: totalDiscount,
      });
    }

    // ── 5. Build RPC item payload ─────────────────────────────────────────────
    const rpcItems = cart.map((item) => {
      const productId = item.productId || item.product.id;
      const product = productMap.get(productId);
      const price = Number(product.price);
      const discountedPrice = item.discountedPrice
        ? Number(item.discountedPrice)
        : null;

      return {
        product_id: productId,
        quantity: item.quantity,
        price,
        discounted_price:
          discountedPrice !== null ? String(discountedPrice) : "",
        discount_id: item.discountId ? String(item.discountId) : "",
        discount_amount: discountedPrice
          ? (price - discountedPrice) * item.quantity
          : 0,
      };
    });

    // ── 6. Execute atomic sale via RPC ────────────────────────────────────────
    const parsedCash = cashAmount ? parseFloat(cashAmount) : null;
    const { data: saleId, error: rpcError } = await supabase.rpc(
      "create_sale",
      {
        p_sold_by: req.user.id,
        p_branch_id: activeBranchId,
        p_subtotal: calculatedSubtotal,
        p_discount: calculatedTotalDiscount,
        p_total: calculatedTotal,
        // p_cash:      cashAmount || null,
        // p_change:    cashAmount ? cashAmount - calculatedTotal : null,
        p_cash: parsedCash,
        p_change: parsedCash ? parsedCash - calculatedTotal : null,
        p_items: rpcItems,
      },
    );

    if (rpcError) throw rpcError;

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    await createLog(
      req,
      "SALE",
      "sales",
      saleId,
      `Completed sale #${saleId} - Total: ₱${calculatedTotal.toFixed(2)}`,
      {
        items: cart.length,
        total: calculatedTotal,
        discount: calculatedTotalDiscount,
        branch: activeBranchId,
      },
    );

    // ── 8. Fetch sale + seller for socket emission ─────────────────────────────
    const { data: completeSale } = await supabase
      .from("sales")
      .select(
        `
        id, total_amount, sold_at, branch_id,
        seller:users (id, username, first_name, last_name)
      `,
      )
      .eq("id", saleId)
      .maybeSingle();

    // ── 9. Fetch updated stock levels for socket emissions ────────────────────
    const { data: updatedStocks } = await supabase
      .from("branch_stocks")
      .select("product_id, current_stock")
      .eq("branch_id", activeBranchId)
      .in("product_id", productIds);

    const stockMap = Object.fromEntries(
      (updatedStocks || []).map((s) => [s.product_id, s.current_stock]),
    );

    // ── 10. Socket emissions ───────────────────────────────────────────────────
    if (completeSale) {
      emitNewSale({
        id: completeSale.id,
        totalAmount: parseFloat(completeSale.total_amount),
        soldAt: completeSale.sold_at,
        branchId: completeSale.branch_id,
        user: {
          fullName: completeSale.seller
            ? `${completeSale.seller.first_name || ""} ${completeSale.seller.last_name || ""}`.trim() ||
              completeSale.seller.username
            : "Unknown",
          username: completeSale.seller?.username || "unknown",
        },
      });

      emitDashboardRefresh(completeSale.branch_id);
    }

    for (const item of cart) {
      const productId = item.productId || item.product.id;
      const newStock = stockMap[productId];
      emitStockUpdate(activeBranchId, { productId, newStock });
      console.log(
        `📦 Stock update emitted: Product ${productId} -> ${newStock} units (Branch ${activeBranchId})`,
      );
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
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales
// ─────────────────────────────────────────────────────────────────────────────

exports.getSales = async (req, res) => {
  try {
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

    let query = supabase
      .from("sales")
      .select(
        `
        id, subtotal, total_discount, total_amount,
        cash_amount, change_amount, sold_at, sold_by, branch_id, status,
        branch:branches (id, name, code),
        seller:users (id, username, email, first_name, last_name),
        items:sale_items (
          id, quantity, price, discounted_price, discount_amount,
          product:products (id, name),
          discount:discounts (id, name, discount_type, discount_value)
        )
      `,
      )
      .order("sold_at", { ascending: false });

    // Branch filter — mirror original logic
    if (user.role !== "admin") {
      query = query.eq("branch_id", activeBranchId);
    } else if (user.current_branch_id) {
      query = query.eq("branch_id", user.current_branch_id);
    }
    // admin with no current_branch_id → no filter, sees all

    const { data: sales, error } = await query;
    if (error) throw error;

    const response = sales.map((sale) => ({
      id: sale.id,
      branch: sale.branch ?? null,
      subtotal: sale.subtotal ? parseFloat(sale.subtotal) : null,
      totalDiscount: sale.total_discount ? parseFloat(sale.total_discount) : 0,
      totalAmount: parseFloat(sale.total_amount),
      cashAmount: sale.cash_amount ? parseFloat(sale.cash_amount) : null,
      changeAmount: sale.change_amount ? parseFloat(sale.change_amount) : null,
      soldAt: sale.sold_at,
      soldBy: sale.sold_by,
      status: sale.status,
      seller: sale.seller
        ? {
            id: sale.seller.id,
            name:
              sale.seller.first_name && sale.seller.last_name
                ? `${sale.seller.first_name} ${sale.seller.last_name}`.trim()
                : sale.seller.username || "Unknown",
            email: sale.seller.email,
          }
        : null,
      items: sale.items.map((item) => ({
        id: item.id,
        product: { id: item.product.id, name: item.product.name },
        quantity: item.quantity,
        price: parseFloat(item.price),
        discountedPrice: item.discounted_price
          ? parseFloat(item.discounted_price)
          : null,
        discountAmount: item.discount_amount
          ? parseFloat(item.discount_amount)
          : 0,
        discount: item.discount
          ? {
              id: item.discount.id,
              name: item.discount.name,
              type: item.discount.discount_type,
              value: parseFloat(item.discount.discount_value),
            }
          : null,
      })),
    }));

    return res.json(response);
  } catch (error) {
    console.error("Error fetching sales:", error);
    return res
      .status(500)
      .json({ message: "Error fetching sales", error: error.message });
  }
};
