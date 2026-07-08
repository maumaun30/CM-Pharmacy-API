const dayjs = require("dayjs");
const { and, eq, gte, lt, lte, desc, asc, count, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { getCached } = require("../utils/cache");

const { sales, branchStocks, products, users, branches } = schema;

const TTL_SHORT  = 60_000;       // 1 min  — today's sales, stock alerts
const TTL_MEDIUM = 2 * 60_000;   // 2 min  — sales trend chart
const TTL_LONG   = 5 * 60_000;   // 5 min  — weekly trend, top products (30-day window)

// ─── Branch filter helper ─────────────────────────────────────────────────────

function getActiveBranchId(user) {
  if (user.role === "admin" && user.currentBranchId) return user.currentBranchId;
  if (user.role !== "admin") return user.branchId;
  return null; // admin with no currentBranchId → all branches
}

// ─── Get Dashboard Stats ──────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const cacheKey = `dashboard:stats:${activeBranchId ?? "all"}`;

    const result = await getCached(cacheKey, TTL_SHORT, async () => {
      const today    = dayjs().startOf("day").toISOString();
      const tomorrow = dayjs().add(1, "day").startOf("day").toISOString();

      // ── 1. Today's sales totals ────────────────────────────────────────────
      const salesConds = [gte(sales.soldAt, today), lt(sales.soldAt, tomorrow)];
      if (activeBranchId) salesConds.push(eq(sales.branchId, activeBranchId));

      const todaySalesRows = await db
        .select({ total_amount: sales.totalAmount })
        .from(sales)
        .where(and(...salesConds));

      const todaySales        = todaySalesRows.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
      const todayTransactions = todaySalesRows.length;

      // ── 2. Stock counts (active products only) ─────────────────────────────
      const stockConds = [eq(products.status, "ACTIVE")];
      if (activeBranchId) stockConds.push(eq(branchStocks.branchId, activeBranchId));

      const stockRows = await db
        .select({
          current_stock: branchStocks.currentStock,
          minimum_stock: branchStocks.minimumStock,
          reorder_point: branchStocks.reorderPoint,
          product_id: branchStocks.productId,
        })
        .from(branchStocks)
        .innerJoin(products, eq(branchStocks.productId, products.id))
        .where(and(...stockConds));

      let lowStockCount = 0, outOfStockCount = 0, criticalStockCount = 0;

      if (activeBranchId) {
        outOfStockCount    = stockRows.filter((r) => r.current_stock === 0).length;
        criticalStockCount = stockRows.filter((r) => r.current_stock > 0 && r.current_stock <= r.minimum_stock).length;
        lowStockCount      = stockRows.filter((r) => r.current_stock <= r.reorder_point).length;
      } else {
        const lowIds      = new Set(stockRows.filter((r) => r.current_stock <= r.reorder_point).map((r) => r.product_id));
        const outIds      = new Set(stockRows.filter((r) => r.current_stock === 0).map((r) => r.product_id));
        const criticalIds = new Set(stockRows.filter((r) => r.current_stock > 0 && r.current_stock <= r.minimum_stock).map((r) => r.product_id));
        lowStockCount      = lowIds.size;
        outOfStockCount    = outIds.size;
        criticalStockCount = criticalIds.size;
      }

      // ── 3. Total active products ───────────────────────────────────────────
      const [{ totalProducts }] = await db
        .select({ totalProducts: count() })
        .from(products)
        .where(eq(products.status, "ACTIVE"));

      // ── 4. Recent sales (last 10) ──────────────────────────────────────────
      const recentConds = [];
      if (activeBranchId) recentConds.push(eq(sales.branchId, activeBranchId));

      const recentSales = await db
        .select({
          id: sales.id,
          total_amount: sales.totalAmount,
          sold_at: sales.soldAt,
          seller: { id: users.id, username: users.username, first_name: users.firstName, last_name: users.lastName },
        })
        .from(sales)
        .leftJoin(users, eq(sales.soldBy, users.id))
        .where(recentConds.length ? and(...recentConds) : undefined)
        .orderBy(desc(sales.soldAt))
        .limit(10);

      return {
        todaySales,
        todayTransactions,
        lowStockCount,
        totalProducts,
        recentSales: recentSales.map((sale) => {
          const seller = sale.seller?.id ? sale.seller : null;
          return {
            id:          sale.id,
            createdAt:   sale.sold_at,
            totalAmount: parseFloat(sale.total_amount),
            user: {
              fullName: seller
                ? `${seller.first_name || ""} ${seller.last_name || ""}`.trim() || seller.username
                : "Unknown",
              username: seller?.username || "unknown",
            },
          };
        }),
        outOfStockCount,
        criticalStockCount,
        branchId: activeBranchId,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("❌ Dashboard stats error:", error);
    return res.status(500).json({ message: "Error fetching dashboard statistics", error: error.message });
  }
};

// ─── Get Weekly Sales Trend ───────────────────────────────────────────────────

exports.getWeeklySalesTrend = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const cacheKey = `dashboard:weekly:${activeBranchId ?? "all"}`;

    const result = await getCached(cacheKey, TTL_LONG, async () => {
      const sevenDaysAgo = dayjs().subtract(7, "day").startOf("day").toISOString();

      const conds = [gte(sales.soldAt, sevenDaysAgo)];
      if (activeBranchId) conds.push(eq(sales.branchId, activeBranchId));

      const rows = await db
        .select({ total_amount: sales.totalAmount, sold_at: sales.soldAt })
        .from(sales)
        .where(and(...conds))
        .orderBy(asc(sales.soldAt));

      const byDay = {};
      for (const sale of rows) {
        const date = dayjs(sale.sold_at).format("YYYY-MM-DD");
        if (!byDay[date]) byDay[date] = { date, sales: 0, transactions: 0 };
        byDay[date].sales        += parseFloat(sale.total_amount);
        byDay[date].transactions += 1;
      }
      return Object.values(byDay);
    });

    return res.json(result);
  } catch (error) {
    console.error("Weekly trend error:", error);
    return res.status(500).json({ message: "Error fetching weekly sales trend", error: error.message });
  }
};

// Run the get_top_products RPC. p_until has a DB default (now()), so callers may
// omit it (named-arg call). Definition: supabase/migrations/..._get_top_products.sql.
async function runTopProducts({ branchId, since, until, limit }) {
  const untilFrag = until ? sql`, p_until => ${until}::timestamptz` : sql``;
  const result = await db.execute(sql`
    select * from get_top_products(
      p_branch_id => ${branchId}::bigint,
      p_since => ${since}::timestamptz${untilFrag},
      p_limit => ${limit}::integer
    )
  `);
  return result.rows.map((p) => ({
    id:                Number(p.id),
    name:              p.name,
    sku:               p.sku,
    price:             parseFloat(p.price),
    totalQuantitySold: parseInt(p.total_quantity_sold),
    totalRevenue:      parseFloat(p.total_revenue),
    numberOfSales:     parseInt(p.number_of_sales),
  }));
}

// ─── Get Top Products ─────────────────────────────────────────────────────────

exports.getTopProducts = async (req, res) => {
  try {
    const limit          = parseInt(req.query.limit) || 10;
    const activeBranchId = getActiveBranchId(req.user);
    const cacheKey = `dashboard:top-products:${activeBranchId ?? "all"}:${limit}`;
    const thirtyDaysAgo  = dayjs().subtract(30, "day").startOf("day").toISOString();

    const result = await getCached(cacheKey, TTL_LONG, () =>
      runTopProducts({ branchId: activeBranchId, since: thirtyDaysAgo, limit })
    );

    return res.json(result);
  } catch (error) {
    console.error("Top products error:", error);
    return res.status(500).json({ message: "Error fetching top products", error: error.message });
  }
};

// ─── Get Analytics Top Products (period-aware) ────────────────────────────────

exports.getAnalyticsTopProducts = async (req, res) => {
  try {
    const limit          = parseInt(req.query.limit) || 10;
    const period         = req.query.period || "monthly";
    const offset         = parseInt(req.query.offset ?? "0", 10);
    const activeBranchId = getActiveBranchId(req.user);

    let rangeStart, rangeEnd;
    if (period === "daily") {
      rangeStart = dayjs().add(offset, "day").startOf("day");
      rangeEnd   = dayjs().add(offset, "day").endOf("day");
    } else if (period === "weekly") {
      rangeStart = dayjs().add(offset, "week").startOf("week");
      rangeEnd   = dayjs().add(offset, "week").endOf("week");
    } else if (period === "annual") {
      rangeStart = dayjs().add(offset, "year").startOf("year");
      rangeEnd   = dayjs().add(offset, "year").endOf("year");
    } else {
      rangeStart = dayjs().add(offset, "month").startOf("month");
      rangeEnd   = dayjs().add(offset, "month").endOf("month");
    }

    const cacheKey = `dashboard:analytics-top:${activeBranchId ?? "all"}:${period}:${offset}:${limit}`;

    const result = await getCached(cacheKey, TTL_MEDIUM, () =>
      runTopProducts({
        branchId: activeBranchId,
        since: rangeStart.toISOString(),
        until: rangeEnd.toISOString(),
        limit,
      })
    );

    return res.json(result);
  } catch (error) {
    console.error("Analytics top products error:", error);
    return res.status(500).json({ message: "Error fetching analytics top products", error: error.message });
  }
};

// ─── Get Stock Alerts ─────────────────────────────────────────────────────────

exports.getStockAlerts = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const cacheKey = `dashboard:stock-alerts:${activeBranchId ?? "all"}`;

    const result = await getCached(cacheKey, TTL_SHORT, async () => {
      const conds = [eq(products.status, "ACTIVE")];
      if (activeBranchId) conds.push(eq(branchStocks.branchId, activeBranchId));

      const allStocks = await db
        .select({
          id: branchStocks.id,
          product_id: branchStocks.productId,
          branch_id: branchStocks.branchId,
          current_stock: branchStocks.currentStock,
          minimum_stock: branchStocks.minimumStock,
          reorder_point: branchStocks.reorderPoint,
          product: { id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName, status: products.status },
          branch: { id: branches.id, name: branches.name, code: branches.code },
        })
        .from(branchStocks)
        .innerJoin(products, eq(branchStocks.productId, products.id))
        .leftJoin(branches, eq(branchStocks.branchId, branches.id))
        .where(and(...conds))
        .orderBy(asc(branchStocks.currentStock), asc(branchStocks.branchId))
        .limit(20);

      return allStocks
        .filter((bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point)
        .map((alert) => ({
          id:           alert.id,
          productId:    alert.product_id,
          branchId:     alert.branch_id,
          currentStock: alert.current_stock,
          minimumStock: alert.minimum_stock,
          reorderPoint: alert.reorder_point,
          status:
            alert.current_stock === 0 ? "OUT_OF_STOCK"
            : alert.current_stock <= alert.minimum_stock ? "CRITICAL"
            : "LOW",
          product: {
            id:        alert.product.id,
            name:      alert.product.name,
            sku:       alert.product.sku,
            brandName: alert.product.brand_name,
          },
          branch: alert.branch?.id ? alert.branch : null,
        }));
    });

    return res.json(result);
  } catch (error) {
    console.error("Stock alerts error:", error);
    return res.status(500).json({ message: "Error fetching stock alerts", error: error.message });
  }
};

// ─── Get Sales Trend (daily / weekly / monthly) ───────────────────────────────

exports.getSalesTrend = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const mode   = req.query.mode   || "daily";
    const offset = parseInt(req.query.offset ?? "0", 10);
    const cacheKey = `dashboard:trend:${activeBranchId ?? "all"}:${mode}:${offset}`;

    const result = await getCached(cacheKey, TTL_MEDIUM, async () => {
      let rangeStart, rangeEnd;
      if (mode === "daily") {
        rangeStart = dayjs().add(offset, "day").startOf("day");
        rangeEnd   = dayjs().add(offset, "day").endOf("day");
      } else if (mode === "weekly") {
        rangeStart = dayjs().add(offset, "week").startOf("week");
        rangeEnd   = dayjs().add(offset, "week").endOf("week");
      } else if (mode === "monthly") {
        rangeStart = dayjs().add(offset, "month").startOf("month");
        rangeEnd   = dayjs().add(offset, "month").endOf("month");
      } else {
        // annual
        rangeStart = dayjs().add(offset, "year").startOf("year");
        rangeEnd   = dayjs().add(offset, "year").endOf("year");
      }

      const conds = [gte(sales.soldAt, rangeStart.toISOString()), lte(sales.soldAt, rangeEnd.toISOString())];
      if (activeBranchId) conds.push(eq(sales.branchId, activeBranchId));

      const rows = await db
        .select({ id: sales.id, total_amount: sales.totalAmount, sold_at: sales.soldAt })
        .from(sales)
        .where(and(...conds))
        .orderBy(asc(sales.soldAt));

      const points = buildSkeleton(mode, rangeStart);
      let totalSales = 0, totalTransactions = 0;

      for (const sale of rows) {
        const key   = getDateKey(sale.sold_at, mode);
        const point = points.find((p) => p.dateKey === key);
        if (point) {
          point.sales        += parseFloat(sale.total_amount);
          point.transactions += 1;
        }
        totalSales        += parseFloat(sale.total_amount);
        totalTransactions += 1;
      }

      return { points, totalSales, totalTransactions };
    });

    return res.json(result);
  } catch (error) {
    console.error("Sales trend error:", error);
    return res.status(500).json({ message: "Error fetching sales trend", error: error.message });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateKey(soldAt, mode) {
  const d = dayjs(soldAt);
  if (mode === "daily")  return d.format("HH");
  if (mode === "annual") return d.format("YYYY-MM");
  return d.format("YYYY-MM-DD");
}

function buildSkeleton(mode, rangeStart) {
  const points = [];

  if (mode === "daily") {
    for (let h = 0; h < 24; h++) {
      const hour = String(h).padStart(2, "0");
      points.push({ label: dayjs(rangeStart).hour(h).format("h A"), dateKey: hour, sales: 0, transactions: 0 });
    }
  } else if (mode === "weekly") {
    for (let d = 0; d < 7; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({ label: day.format("ddd"), dateKey: day.format("YYYY-MM-DD"), sales: 0, transactions: 0 });
    }
  } else if (mode === "monthly") {
    const daysInMonth = dayjs(rangeStart).daysInMonth();
    for (let d = 0; d < daysInMonth; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({ label: day.format("D"), dateKey: day.format("YYYY-MM-DD"), sales: 0, transactions: 0 });
    }
  } else {
    // annual — 12 monthly buckets
    for (let m = 0; m < 12; m++) {
      const month = dayjs(rangeStart).add(m, "month");
      points.push({ label: month.format("MMM"), dateKey: month.format("YYYY-MM"), sales: 0, transactions: 0 });
    }
  }

  return points;
}
