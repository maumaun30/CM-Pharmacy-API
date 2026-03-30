const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");
const { emitStockUpdate, emitLowStockAlert, emitDashboardRefresh } = require("../utils/socket");

// ─── Shared select strings ────────────────────────────────────────────────────

const STOCK_WITH_DETAILS = `
  *,
  product:products (id, name, sku),
  user:users       (id, username, first_name, last_name),
  branch:branches  (id, name, code)
`;

// ─── Helper: resolve user's active branch ────────────────────────────────────

const getUserActiveBranch = async (userId) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("id, role, branch_id, current_branch_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!user) throw new Error("User not found");

  const activeBranchId = user.current_branch_id || user.branch_id;

  return {
    user,
    activeBranchId,
    canViewAllBranches: user.role === "admin" && !user.current_branch_id,
  };
};

// ─── Helper: emit low stock alert if threshold crossed ───────────────────────

const maybeEmitLowStock = (activeBranchId, branchStock, product, quantityAfter) => {
  if (quantityAfter <= branchStock.reorder_point) {
    emitLowStockAlert(activeBranchId, {
      id:           product.id,
      name:         product.name,
      sku:          product.sku,
      currentStock: quantityAfter,
      reorderPoint: branchStock.reorder_point,
      minimumStock: branchStock.minimum_stock,
      branchId:     activeBranchId,
    });
  }
};

// ─── Get Product Stock History ────────────────────────────────────────────────

exports.getProductStockHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    const pageNum  = parseInt(page);
    const pageSize = parseInt(limit);
    const offset   = (pageNum - 1) * pageSize;

    let query = supabase
      .from("stocks")
      .select(STOCK_WITH_DETAILS, { count: "exact" })
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (!canViewAllBranches) query = query.eq("branch_id", activeBranchId);

    const { data: stocks, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      stocks,
      pagination: {
        total:      count,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(count / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get All Stock Transactions ───────────────────────────────────────────────

exports.getAllStockTransactions = async (req, res) => {
  try {
    const {
      transactionType,
      search,
      dateFrom,
      dateTo,
      page  = 1,
      limit = 50,
    } = req.query;

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    const pageNum  = parseInt(page);
    const pageSize = parseInt(limit);
    const offset   = (pageNum - 1) * pageSize;

    let query = supabase
      .from("stocks")
      .select(STOCK_WITH_DETAILS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (!canViewAllBranches)  query = query.eq("branch_id", activeBranchId);
    if (transactionType)      query = query.eq("transaction_type", transactionType);
    if (dateFrom)             query = query.gte("created_at", new Date(dateFrom).toISOString());
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.lte("created_at", endOfDay.toISOString());
    }

    // Product search — filter in JS post-fetch (Supabase can't filter on joined columns)
    const { data: stocks, count, error } = await query;
    if (error) throw error;

    let filtered = stocks;
    if (search) {
      const term = search.toLowerCase();
      filtered = stocks.filter(
        (s) =>
          s.product?.name?.toLowerCase().includes(term) ||
          s.product?.sku?.toLowerCase().includes(term)
      );
    }

    return res.status(200).json({
      stocks: filtered,
      pagination: {
        total:      count,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(count / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching stock transactions:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Add Stock (purchase / initial / return) ──────────────────────────────────

exports.addStock = async (req, res) => {
  try {
    const {
      productId, quantity, unitCost, batchNumber,
      expiryDate, supplier, transactionType = "PURCHASE",
    } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ message: "Product ID and positive quantity are required" });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    const { data: branchStock, error: stockError } = await supabase
      .from("branch_stocks")
      .select("*")
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId)
      .maybeSingle();

    if (stockError) throw stockError;
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = quantityBefore + Math.abs(quantity);

    // Update branch stock
    const { error: updateError } = await supabase
      .from("branch_stocks")
      .update({ current_stock: quantityAfter })
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId);
    if (updateError) throw updateError;

    // Create stock transaction
    const { data: stock, error: insertError } = await supabase
      .from("stocks")
      .insert({
        product_id:       productId,
        branch_id:        activeBranchId,
        transaction_type: transactionType,
        quantity:         Math.abs(quantity),
        quantity_before:  quantityBefore,
        quantity_after:   quantityAfter,
        unit_cost:        unitCost  ? parseFloat(unitCost) : null,
        total_cost:       unitCost  ? parseFloat(unitCost) * Math.abs(quantity) : null,
        batch_number:     batchNumber || null,
        expiry_date:      expiryDate  ? new Date(expiryDate).toISOString() : null,
        supplier:         supplier    || null,
        performed_by:     req.user.id,
      })
      .select(STOCK_WITH_DETAILS)
      .single();

    if (insertError) throw insertError;

    await createLog(
      req, "CREATE", "stocks", stock.id,
      `Added ${quantity} units to product ${productId} at branch ${activeBranchId}`,
      { stock }
    );

    emitStockUpdate(activeBranchId, { productId, newStock: quantityAfter });
    maybeEmitLowStock(activeBranchId, branchStock, stock.product, quantityAfter);
    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stock);
  } catch (error) {
    console.error("Error adding stock:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Adjust Stock (manual adjustment) ────────────────────────────────────────

exports.adjustStock = async (req, res) => {
  try {
    const { productId, quantity, reason } = req.body;

    if (!productId || !quantity || !reason) {
      return res.status(400).json({ message: "Product ID, quantity, and reason are required" });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    const { data: branchStock, error: stockError } = await supabase
      .from("branch_stocks")
      .select("*")
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId)
      .maybeSingle();

    if (stockError) throw stockError;
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = Math.max(0, quantityBefore + parseInt(quantity));

    const { error: updateError } = await supabase
      .from("branch_stocks")
      .update({ current_stock: quantityAfter })
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId);
    if (updateError) throw updateError;

    const { data: stock, error: insertError } = await supabase
      .from("stocks")
      .insert({
        product_id:       productId,
        branch_id:        activeBranchId,
        transaction_type: "ADJUSTMENT",
        quantity:         parseInt(quantity),
        quantity_before:  quantityBefore,
        quantity_after:   quantityAfter,
        reason:           reason || null,
        performed_by:     req.user.id,
      })
      .select(STOCK_WITH_DETAILS)
      .single();

    if (insertError) throw insertError;

    await createLog(
      req, "UPDATE", "stocks", stock.id,
      `Adjusted stock for product ${productId}: ${quantity > 0 ? "+" : ""}${quantity} at branch ${activeBranchId}`,
      { stock, reason }
    );

    emitStockUpdate(activeBranchId, { productId, newStock: quantityAfter });
    maybeEmitLowStock(activeBranchId, branchStock, stock.product, quantityAfter);
    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stock);
  } catch (error) {
    console.error("Error adjusting stock:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Record Stock Loss (damage / expired) ────────────────────────────────────

exports.recordStockLoss = async (req, res) => {
  try {
    const { productId, quantity, transactionType, reason, batchNumber } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ message: "Product ID and positive quantity are required" });
    }
    if (!["DAMAGE", "EXPIRED"].includes(transactionType)) {
      return res.status(400).json({ message: "Transaction type must be DAMAGE or EXPIRED" });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    const { data: branchStock, error: stockError } = await supabase
      .from("branch_stocks")
      .select("*")
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId)
      .maybeSingle();

    if (stockError) throw stockError;
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = Math.max(0, quantityBefore - Math.abs(quantity));

    const { error: updateError } = await supabase
      .from("branch_stocks")
      .update({ current_stock: quantityAfter })
      .eq("product_id", productId)
      .eq("branch_id", activeBranchId);
    if (updateError) throw updateError;

    const { data: stock, error: insertError } = await supabase
      .from("stocks")
      .insert({
        product_id:       productId,
        branch_id:        activeBranchId,
        transaction_type: transactionType,
        quantity:         -Math.abs(quantity),
        quantity_before:  quantityBefore,
        quantity_after:   quantityAfter,
        reason:           reason       || null,
        batch_number:     batchNumber  || null,
        performed_by:     req.user.id,
      })
      .select(STOCK_WITH_DETAILS)
      .single();

    if (insertError) throw insertError;

    await createLog(
      req, "CREATE", "stocks", stock.id,
      `Recorded ${transactionType.toLowerCase()} stock for product ${productId}: -${quantity} at branch ${activeBranchId}`,
      { stock, reason }
    );

    emitStockUpdate(activeBranchId, { productId, newStock: quantityAfter });
    maybeEmitLowStock(activeBranchId, branchStock, stock.product, quantityAfter);
    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stock);
  } catch (error) {
    console.error("Error recording stock loss:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Low Stock Products ───────────────────────────────────────────────────

exports.getLowStockProducts = async (req, res) => {
  try {
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    let query = supabase
      .from("branch_stocks")
      .select(`
        *,
        product:products!inner (id, name, sku, price, status),
        branch:branches (id, name, code)
      `)
      .eq("product.status", "ACTIVE")
      .order("current_stock", { ascending: true });

    if (!canViewAllBranches && activeBranchId) {
      query = query.eq("branch_id", activeBranchId);
    }

    const { data: allStocks, error } = await query;
    if (error) throw error;

    // Column-to-column comparison done in JS
    const lowStockItems = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    const formatted = lowStockItems.map((item) => ({
      id:           item.product.id,
      name:         item.product.name,
      sku:          item.product.sku,
      currentStock: item.current_stock,
      minimumStock: item.minimum_stock,
      reorderPoint: item.reorder_point,
      price:        parseFloat(item.product.price),
      branchId:     item.branch_id,
      branchName:   item.branch?.name,
      branchCode:   item.branch?.code,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching low stock products:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Stock Summary ────────────────────────────────────────────────────────

exports.getStockSummary = async (req, res) => {
  try {
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    let stockQuery = supabase
      .from("branch_stocks")
      .select(`
        product_id, branch_id, current_stock, minimum_stock, reorder_point,
        product:products!inner (status)
      `)
      .eq("product.status", "ACTIVE");

    if (!canViewAllBranches && activeBranchId) {
      stockQuery = stockQuery.eq("branch_id", activeBranchId);
    }

    const { data: branchStocks, error: stockError } = await stockQuery;
    if (stockError) throw stockError;

    // Column-to-column comparisons in JS
    const totalProducts  = new Set(branchStocks.map((bs) => bs.product_id)).size;
    const outOfStock     = branchStocks.filter((bs) => bs.current_stock === 0).length;
    const lowStock       = branchStocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.reorder_point).length;
    const criticalStock  = branchStocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock).length;

    // Recent transactions count (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let txQuery = supabase
      .from("stocks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo);

    if (!canViewAllBranches && activeBranchId) {
      txQuery = txQuery.eq("branch_id", activeBranchId);
    }

    const { count: recentTransactions, error: txError } = await txQuery;
    if (txError) throw txError;

    return res.status(200).json({
      totalProducts,
      outOfStock,
      lowStock,
      criticalStock,
      recentTransactions,
    });
  } catch (error) {
    console.error("Error fetching stock summary:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};