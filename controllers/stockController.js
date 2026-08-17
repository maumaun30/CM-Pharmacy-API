const { and, eq, gte, lte, desc, asc, count } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { stockFull } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");
const { emitStockUpdate, emitLowStockAlert, emitDashboardRefresh } = require("../utils/socket");
const { notifyLowStock } = require("../utils/notifications");
const { invalidate } = require("../utils/cache");

const { stocks, products, users, branches, branchStocks } = schema;

// Nested projections for the STOCK_WITH_DETAILS shape.
const stockDetails = {
  ...stockFull,
  product: { id: products.id, name: products.name, sku: products.sku },
  user: { id: users.id, username: users.username, first_name: users.firstName, last_name: users.lastName },
  branch: { id: branches.id, name: branches.name, code: branches.code },
};

const withStockDetails = (qb) =>
  qb
    .leftJoin(products, eq(stocks.productId, products.id))
    .leftJoin(users, eq(stocks.performedBy, users.id))
    .leftJoin(branches, eq(stocks.branchId, branches.id));

// ─── Helper: resolve user's active branch ────────────────────────────────────

const getUserActiveBranch = async (userId) => {
  const [user] = await db
    .select({ id: users.id, role: users.role, branch_id: users.branchId, current_branch_id: users.currentBranchId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

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
    const payload = {
      id:            product.id,
      name:          product.name,
      sku:           product.sku,
      current_stock: quantityAfter,
      reorder_point: branchStock.reorder_point,
      minimum_stock: branchStock.minimum_stock,
      branch_id:     activeBranchId,
    };
    emitLowStockAlert(activeBranchId, payload);
    // Persisted bell notification for supervisors (deduped per product; never throws).
    notifyLowStock(activeBranchId, payload);
  }
};

// Fetch a branch_stock row (snake_case) for a product at a branch.
const getBranchStockRow = async (productId, branchId) => {
  const [row] = await db
    .select({
      id: branchStocks.id,
      current_stock: branchStocks.currentStock,
      minimum_stock: branchStocks.minimumStock,
      reorder_point: branchStocks.reorderPoint,
    })
    .from(branchStocks)
    .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)))
    .limit(1);
  return row || null;
};

// Insert a stocks ledger row and return it with STOCK_WITH_DETAILS joins.
const insertStockWithDetails = async (values) => {
  const [inserted] = await db.insert(stocks).values(values).returning({ id: stocks.id });
  const [stock] = await withStockDetails(
    db.select(stockDetails).from(stocks)
  ).where(eq(stocks.id, inserted.id)).limit(1);
  return stock;
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

    const conds = [eq(stocks.productId, productId)];
    if (!canViewAllBranches) conds.push(eq(stocks.branchId, activeBranchId));
    const where = and(...conds);

    const rows = await withStockDetails(db.select(stockDetails).from(stocks))
      .where(where)
      .orderBy(desc(stocks.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(stocks).where(where);

    return res.status(200).json({
      stocks: rows,
      pagination: { total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get All Stock Transactions ───────────────────────────────────────────────

exports.getAllStockTransactions = async (req, res) => {
  try {
    const { transactionType, search, dateFrom, dateTo, page = 1, limit = 50 } = req.query;

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    const pageNum  = parseInt(page);
    const pageSize = parseInt(limit);
    const offset   = (pageNum - 1) * pageSize;

    const conds = [];
    if (!canViewAllBranches) conds.push(eq(stocks.branchId, activeBranchId));
    if (transactionType) conds.push(eq(stocks.transactionType, transactionType));
    if (dateFrom) conds.push(gte(stocks.createdAt, new Date(dateFrom).toISOString()));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conds.push(lte(stocks.createdAt, endOfDay.toISOString()));
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await withStockDetails(db.select(stockDetails).from(stocks))
      .where(where)
      .orderBy(desc(stocks.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(stocks).where(where);

    // Product search — filter in JS post-fetch.
    let filtered = rows;
    if (search) {
      const term = search.toLowerCase();
      filtered = rows.filter(
        (s) =>
          s.product?.name?.toLowerCase().includes(term) ||
          s.product?.sku?.toLowerCase().includes(term)
      );
    }

    return res.status(200).json({
      stocks: filtered,
      pagination: { total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    console.error("Error fetching stock transactions:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Add Stock (purchase / initial / return) ──────────────────────────────────

exports.addStock = async (req, res) => {
  try {
    const { productId, quantity, unitCost, sellingPrice, branchId, batchNumber, expiryDate, supplier, transactionType = "PURCHASE" } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ message: "Product ID and positive quantity are required" });
    }

    // Explicit branchId (admin in all-branches view) wins over the session branch.
    const { activeBranchId: sessionBranchId } = await getUserActiveBranch(req.user.id);
    const activeBranchId = branchId || sessionBranchId;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    const branchStock = await getBranchStockRow(productId, activeBranchId);
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = quantityBefore + Math.abs(quantity);

    await db.update(branchStocks)
      .set({ currentStock: quantityAfter })
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, activeBranchId)));

    const stock = await insertStockWithDetails({
      productId,
      branchId: activeBranchId,
      transactionType,
      quantity: Math.abs(quantity),
      quantityBefore,
      quantityAfter,
      unitCost: unitCost ? parseFloat(unitCost) : null,
      totalCost: unitCost ? parseFloat(unitCost) * Math.abs(quantity) : null,
      batchNumber: batchNumber || null,
      expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
      supplier: supplier || null,
      performedBy: req.user.id,
    });

    await createLog(
      req, "CREATE", "stocks", stock.id,
      `Added ${quantity} units to product ${productId} at branch ${activeBranchId}`,
      { stock }
    );

    // New cost/price/expiry supplied with the delivery updates the product master too
    // (products only track a single expiry_date, not per-batch — the newest delivery wins).
    const productUpdates = {};
    if (unitCost != null && unitCost !== "") productUpdates.cost = parseFloat(unitCost);
    if (sellingPrice != null && sellingPrice !== "") productUpdates.price = parseFloat(sellingPrice);
    if (expiryDate) productUpdates.expiryDate = new Date(expiryDate).toISOString();
    if (Object.keys(productUpdates).length > 0) {
      await db.update(products).set(productUpdates).where(eq(products.id, productId));
      await createLog(
        req, "UPDATE", "products", productId,
        `Updated product ${productId} pricing/expiry from stock entry`,
        { productUpdates }
      );
    }

    invalidate("dashboard:");
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
    const { productId, quantity, reason, unitCost, sellingPrice, branchId } = req.body;

    if (!productId || !quantity || !reason) {
      return res.status(400).json({ message: "Product ID, quantity, and reason are required" });
    }

    // Explicit branchId (admin in all-branches view) wins over the session
    // branch — same rule as addStock. Without it an admin picking a branch in
    // the UI would silently adjust whichever branch their session sits on.
    const { activeBranchId: sessionBranchId } = await getUserActiveBranch(req.user.id);
    const activeBranchId = branchId || sessionBranchId;
    if (!activeBranchId) {
      return res.status(400).json({ message: "User is not assigned to any branch" });
    }

    const branchStock = await getBranchStockRow(productId, activeBranchId);
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = Math.max(0, quantityBefore + parseInt(quantity));

    await db.update(branchStocks)
      .set({ currentStock: quantityAfter })
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, activeBranchId)));

    const stock = await insertStockWithDetails({
      productId,
      branchId: activeBranchId,
      transactionType: "ADJUSTMENT",
      quantity: parseInt(quantity),
      quantityBefore,
      quantityAfter,
      // The adjustment quantity is signed, so total_cost is signed too: a
      // deduction records the value taken off the shelf as a negative.
      unitCost: unitCost != null && unitCost !== "" ? parseFloat(unitCost) : null,
      totalCost: unitCost != null && unitCost !== "" ? parseFloat(unitCost) * parseInt(quantity) : null,
      reason: reason || null,
      performedBy: req.user.id,
    });

    await createLog(
      req, "UPDATE", "stocks", stock.id,
      `Adjusted stock for product ${productId}: ${quantity > 0 ? "+" : ""}${quantity} at branch ${activeBranchId}`,
      { stock, reason }
    );

    // Same rule as addStock: cost/price supplied alongside the movement also
    // updates the product master, so a recount can correct pricing in one pass.
    const productUpdates = {};
    if (unitCost != null && unitCost !== "") productUpdates.cost = parseFloat(unitCost);
    if (sellingPrice != null && sellingPrice !== "") productUpdates.price = parseFloat(sellingPrice);
    if (Object.keys(productUpdates).length > 0) {
      await db.update(products).set(productUpdates).where(eq(products.id, productId));
      await createLog(
        req, "UPDATE", "products", productId,
        `Updated product ${productId} pricing from stock adjustment`,
        { productUpdates }
      );
    }

    invalidate("dashboard:");
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

    const branchStock = await getBranchStockRow(productId, activeBranchId);
    if (!branchStock) {
      return res.status(404).json({ message: "Product not found in this branch inventory" });
    }

    const quantityBefore = branchStock.current_stock;
    const quantityAfter  = Math.max(0, quantityBefore - Math.abs(quantity));

    await db.update(branchStocks)
      .set({ currentStock: quantityAfter })
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, activeBranchId)));

    const stock = await insertStockWithDetails({
      productId,
      branchId: activeBranchId,
      transactionType,
      quantity: -Math.abs(quantity),
      quantityBefore,
      quantityAfter,
      reason: reason || null,
      batchNumber: batchNumber || null,
      performedBy: req.user.id,
    });

    await createLog(
      req, "CREATE", "stocks", stock.id,
      `Recorded ${transactionType.toLowerCase()} stock for product ${productId}: -${quantity} at branch ${activeBranchId}`,
      { stock, reason }
    );

    invalidate("dashboard:");
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

    const conds = [eq(products.status, "ACTIVE")];
    if (!canViewAllBranches && activeBranchId) conds.push(eq(branchStocks.branchId, activeBranchId));

    const allStocks = await db
      .select({
        current_stock: branchStocks.currentStock,
        minimum_stock: branchStocks.minimumStock,
        reorder_point: branchStocks.reorderPoint,
        branch_id: branchStocks.branchId,
        product: { id: products.id, name: products.name, sku: products.sku, price: products.price, status: products.status },
        branch: { id: branches.id, name: branches.name, code: branches.code },
      })
      .from(branchStocks)
      .innerJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(and(...conds))
      .orderBy(asc(branchStocks.currentStock));

    const lowStockItems = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    const formatted = lowStockItems.map((item) => ({
      id:            item.product.id,
      name:          item.product.name,
      sku:           item.product.sku,
      current_stock: item.current_stock,
      minimum_stock: item.minimum_stock,
      reorder_point: item.reorder_point,
      price:         parseFloat(item.product.price),
      branchId:      item.branch_id,
      branchName:    item.branch?.name,
      branchCode:    item.branch?.code,
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

    const conds = [eq(products.status, "ACTIVE")];
    if (!canViewAllBranches && activeBranchId) conds.push(eq(branchStocks.branchId, activeBranchId));

    const rows = await db
      .select({
        product_id: branchStocks.productId,
        branch_id: branchStocks.branchId,
        current_stock: branchStocks.currentStock,
        minimum_stock: branchStocks.minimumStock,
        reorder_point: branchStocks.reorderPoint,
      })
      .from(branchStocks)
      .innerJoin(products, eq(branchStocks.productId, products.id))
      .where(and(...conds));

    const totalProducts = new Set(rows.map((bs) => bs.product_id)).size;
    const outOfStock    = rows.filter((bs) => bs.current_stock === 0).length;
    const lowStock      = rows.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.reorder_point).length;
    const criticalStock = rows.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock).length;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const txConds = [gte(stocks.createdAt, sevenDaysAgo)];
    if (!canViewAllBranches && activeBranchId) txConds.push(eq(stocks.branchId, activeBranchId));

    const [{ recentTransactions }] = await db
      .select({ recentTransactions: count() })
      .from(stocks)
      .where(and(...txConds));

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
