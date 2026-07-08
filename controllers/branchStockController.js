const { and, eq, asc, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { branchStockFull } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");
const { dbErrorMessage } = require("../utils/dbError");

const { branchStocks, products, branches } = schema;

// Nested projections matching the supabase select strings.
const productStockMini = {
  id: products.id, name: products.name, sku: products.sku,
  brand_name: products.brandName, generic_name: products.genericName,
  price: products.price, cost: products.cost, status: products.status,
};
const branchStockBranch = {
  id: branches.id, name: branches.name, code: branches.code, address: branches.address,
};
const branchMini = { id: branches.id, name: branches.name, code: branches.code };

// ─── Get All Branch Stocks ────────────────────────────────────────────────────

exports.getAllBranchStocks = async (req, res) => {
  try {
    const { branchId, productId, status } = req.query;

    const conds = [];
    if (branchId) conds.push(eq(branchStocks.branchId, branchId));
    if (productId) conds.push(eq(branchStocks.productId, productId));

    const rows = await db
      .select({ ...branchStockFull, product: productStockMini, branch: branchStockBranch })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(branchStocks.branchId), asc(branchStocks.currentStock));

    // Precise column-to-column status filtering in JS.
    const filtered = filterByStatus(rows, status);

    return res.status(200).json(filtered);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Product Stock Across All Branches ────────────────────────────────────

exports.getProductStockAllBranches = async (req, res) => {
  try {
    const { productId } = req.params;

    const [product] = await db
      .select({ id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) return res.status(404).json({ message: "Product not found" });

    const stocks = await db
      .select({ ...branchStockFull, branch: branchStockBranch })
      .from(branchStocks)
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(eq(branchStocks.productId, productId))
      .orderBy(asc(branchStocks.branchId));

    const totalStock = stocks.reduce((sum, bs) => sum + (bs.current_stock || 0), 0);

    return res.status(200).json({ product, totalStock, branchStocks: stocks });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Stock For Specific Branch ───────────────────────────────────────────

exports.getBranchStock = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { status, search } = req.query;

    const [branch] = await db
      .select(branchMini)
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const rows = await db
      .select({ ...branchStockFull, product: productStockMini, branch: branchStockBranch })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(eq(branchStocks.branchId, branchId))
      .orderBy(asc(branchStocks.currentStock));

    let stocks = filterByStatus(rows, status);

    if (search) {
      const term = search.toLowerCase();
      stocks = stocks.filter((bs) => {
        const p = bs.product;
        return (
          p?.name?.toLowerCase().includes(term) ||
          p?.sku?.toLowerCase().includes(term) ||
          p?.brand_name?.toLowerCase().includes(term) ||
          p?.generic_name?.toLowerCase().includes(term)
        );
      });
    }

    const summary = buildSummary(stocks);

    return res.status(200).json({ branch, summary, stocks });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Transfer Stock Between Branches ─────────────────────────────────────────
// Atomic via the transfer_branch_stock Postgres function (db/functions/).

exports.transferStock = async (req, res) => {
  try {
    const { productId, fromBranchId, toBranchId, quantity, reason } = req.body;
    const performedBy = req.user.id;

    if (!productId || !fromBranchId || !toBranchId || !quantity) {
      return res.status(400).json({
        message: "Product, source branch, destination branch, and quantity are required",
      });
    }
    if (quantity <= 0) {
      return res.status(400).json({ message: "Quantity must be positive" });
    }
    if (String(fromBranchId) === String(toBranchId)) {
      return res.status(400).json({ message: "Cannot transfer to the same branch" });
    }

    const [[product], [fromBranch], [toBranch]] = await Promise.all([
      db.select({ id: products.id, name: products.name, sku: products.sku }).from(products).where(eq(products.id, productId)).limit(1),
      db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, fromBranchId)).limit(1),
      db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, toBranchId)).limit(1),
    ]);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!fromBranch || !toBranch) return res.status(404).json({ message: "Branch not found" });

    await db.execute(
      sql`select transfer_branch_stock(
        ${productId}::bigint, ${fromBranchId}::bigint, ${toBranchId}::bigint,
        ${quantity}::integer, ${performedBy}::bigint, ${reason || null}::text
      )`
    );

    await createLog(
      req, "TRANSFER", "stock", null,
      `Transferred ${quantity} units of ${product.name} from ${fromBranch.name} to ${toBranch.name}`,
      { productId, fromBranchId, toBranchId, quantity, reason }
    );

    const [[updatedFrom], [updatedTo]] = await Promise.all([
      db.select({ ...branchStockFull, branch: branchMini }).from(branchStocks)
        .leftJoin(branches, eq(branchStocks.branchId, branches.id))
        .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, fromBranchId))).limit(1),
      db.select({ ...branchStockFull, branch: branchMini }).from(branchStocks)
        .leftJoin(branches, eq(branchStocks.branchId, branches.id))
        .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, toBranchId))).limit(1),
    ]);

    return res.status(200).json({
      message: "Stock transferred successfully",
      transfer: {
        product: { id: product.id, name: product.name, sku: product.sku },
        from: updatedFrom || null,
        to: updatedTo || null,
        quantity,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Error transferring stock", error: dbErrorMessage(error) });
  }
};

// ─── Initialize Branch Stock ──────────────────────────────────────────────────

exports.initializeBranchStock = async (req, res) => {
  try {
    const { productId, branchId, currentStock, minimumStock, maximumStock, reorderPoint } = req.body;

    if (!productId || !branchId) {
      return res.status(400).json({ message: "Product ID and Branch ID are required" });
    }

    const [[product], [branch]] = await Promise.all([
      db.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, productId)).limit(1),
      db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId)).limit(1),
    ]);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const [existing] = await db
      .select({ id: branchStocks.id })
      .from(branchStocks)
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)))
      .limit(1);

    if (existing) {
      return res.status(400).json({
        message: "Branch stock already initialized for this product",
      });
    }

    const [inserted] = await db
      .insert(branchStocks)
      .values({
        productId,
        branchId,
        currentStock: currentStock || 0,
        minimumStock: minimumStock || 10,
        maximumStock: maximumStock || null,
        reorderPoint: reorderPoint || 20,
      })
      .returning({ id: branchStocks.id });

    const [branchStock] = await db
      .select({
        ...branchStockFull,
        product: { id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName },
        branch: branchMini,
      })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(eq(branchStocks.id, inserted.id))
      .limit(1);

    await createLog(
      req, "CREATE", "branch_stocks", branchStock.id,
      `Initialized stock for ${product.name} at ${branch.name}`,
      { branchStock }
    );

    return res.status(201).json(branchStock);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Branch Stock Settings ────────────────────────────────────────────

exports.updateBranchStockSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { minimumStock, maximumStock, reorderPoint } = req.body;

    const [existing] = await db
      .select(branchStockFull)
      .from(branchStocks)
      .where(eq(branchStocks.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Branch stock not found" });

    const updates = {
      minimumStock: minimumStock !== undefined ? minimumStock : existing.minimum_stock,
      maximumStock: maximumStock !== undefined ? maximumStock : existing.maximum_stock,
      reorderPoint: reorderPoint !== undefined ? reorderPoint : existing.reorder_point,
    };

    await db.update(branchStocks).set(updates).where(eq(branchStocks.id, id));

    const [updated] = await db
      .select({
        ...branchStockFull,
        product: { id: products.id, name: products.name, sku: products.sku },
        branch: branchMini,
      })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(eq(branchStocks.id, id))
      .limit(1);

    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Stock Alerts ─────────────────────────────────────────────────────────

exports.getStockAlerts = async (req, res) => {
  try {
    const { branchId } = req.query;

    const conds = [eq(products.status, "ACTIVE")]; // only active products (inner join)
    if (branchId) conds.push(eq(branchStocks.branchId, branchId));

    const allStocks = await db
      .select({
        ...branchStockFull,
        product: { id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName, status: products.status },
        branch: branchMini,
      })
      .from(branchStocks)
      .innerJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(and(...conds))
      .orderBy(asc(branchStocks.currentStock), asc(branchStocks.branchId));

    const alerts = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    const grouped = {
      outOfStock: alerts.filter((a) => a.current_stock === 0),
      critical: alerts.filter((a) => a.current_stock > 0 && a.current_stock <= a.minimum_stock),
      lowStock: alerts.filter((a) => a.current_stock > a.minimum_stock && a.current_stock <= a.reorder_point),
    };

    return res.status(200).json({
      total: alerts.length,
      outOfStockCount: grouped.outOfStock.length,
      criticalCount: grouped.critical.length,
      lowStockCount: grouped.lowStock.length,
      alerts: grouped,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function filterByStatus(stocks, status) {
  if (!status) return stocks;
  switch (status) {
    case "OUT_OF_STOCK":
      return stocks.filter((bs) => bs.current_stock === 0);
    case "CRITICAL":
      return stocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock);
    case "LOW":
      return stocks.filter((bs) => bs.current_stock > bs.minimum_stock && bs.current_stock <= bs.reorder_point);
    case "IN_STOCK":
      return stocks.filter((bs) => bs.current_stock > bs.reorder_point);
    default:
      return stocks;
  }
}

function buildSummary(stocks) {
  return {
    totalProducts:  stocks.length,
    outOfStock:     stocks.filter((bs) => bs.current_stock === 0).length,
    critical:       stocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock).length,
    lowStock:       stocks.filter((bs) => bs.current_stock > bs.minimum_stock && bs.current_stock <= bs.reorder_point).length,
    inStock:        stocks.filter((bs) => bs.current_stock > bs.reorder_point).length,
  };
}
