const dayjs = require("dayjs");
const { and, eq, gte, lt, lte, desc, asc, count, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { getCached } = require("../utils/cache");

const { sales, saleItems, categories, branchStocks, products, users, branches } = schema;

const TTL_SHORT  = 60_000;       // 1 min  — today's sales, stock alerts
const TTL_MEDIUM = 2 * 60_000;   // 2 min  — sales trend chart
const TTL_LONG   = 5 * 60_000;   // 5 min  — weekly trend, top products (30-day window)

// ─── Branch filter helper ─────────────────────────────────────────────────────

function getActiveBranchId(user) {
  // Admin with no current branch → all branches (null). Everyone else (manager
  // switching among allowed branches, or cashier) is scoped to their active
  // branch, falling back to their home branch.
  if (user.role === "admin") return user.currentBranchId || null;
  return user.currentBranchId || user.branchId;
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
    const { start, end } = req.query;

    if (mode === "custom" && !(dayjs(start).isValid() && dayjs(end).isValid())) {
      return res.status(400).json({ message: "mode=custom requires valid start and end dates" });
    }

    const cacheKey = `dashboard:trend:${activeBranchId ?? "all"}:${mode}:${offset}:${start ?? ""}:${end ?? ""}`;

    const result = await getCached(cacheKey, TTL_MEDIUM, async () => {
      const { rangeStart, rangeEnd } = resolveRange(mode, offset, start, end);
      const bucketMode = pickBucketMode(mode, rangeStart, rangeEnd);

      // The previous comparable window, used for the period-over-period deltas.
      // Calendar modes step back one whole unit (so February compares against
      // January, not against "the last 28 days"); a custom range shifts back by
      // its own span.
      const prev =
        mode === "custom"
          ? (() => {
              const spanMs = rangeEnd.valueOf() - rangeStart.valueOf();
              return { rangeStart: dayjs(rangeStart.valueOf() - spanMs - 1), rangeEnd: dayjs(rangeStart.valueOf() - 1) };
            })()
          : resolveRange(mode, offset - 1);

      const [rows, prevRows] = await Promise.all([
        selectSalesInRange(activeBranchId, rangeStart, rangeEnd),
        selectSalesInRange(activeBranchId, prev.rangeStart, prev.rangeEnd),
      ]);

      const points = buildSkeleton(mode, bucketMode, rangeStart, rangeEnd);
      let totalSales = 0, totalTransactions = 0;

      for (const sale of rows) {
        const key   = getDateKey(sale.sold_at, bucketMode);
        const point = points.find((p) => p.dateKey === key);
        if (point) {
          point.sales        += parseFloat(sale.total_amount);
          point.transactions += 1;
        }
        totalSales        += parseFloat(sale.total_amount);
        totalTransactions += 1;
      }

      const previousSales = prevRows.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

      return {
        points,
        totalSales,
        totalTransactions,
        // Added for the mobile admin's period summary; existing consumers ignore it.
        bucketMode,
        rangeStart: rangeStart.toISOString(),
        rangeEnd:   rangeEnd.toISOString(),
        previous: {
          totalSales: previousSales,
          totalTransactions: prevRows.length,
          rangeStart: prev.rangeStart.toISOString(),
          rangeEnd:   prev.rangeEnd.toISOString(),
        },
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("Sales trend error:", error);
    return res.status(500).json({ message: "Error fetching sales trend", error: error.message });
  }
};

// ─── Get Sales By Category (period-aware) ─────────────────────────────────────

exports.getSalesByCategory = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const mode   = req.query.mode   || "monthly";
    const offset = parseInt(req.query.offset ?? "0", 10);
    const { start, end } = req.query;

    if (mode === "custom" && !(dayjs(start).isValid() && dayjs(end).isValid())) {
      return res.status(400).json({ message: "mode=custom requires valid start and end dates" });
    }

    const cacheKey = `dashboard:by-category:${activeBranchId ?? "all"}:${mode}:${offset}:${start ?? ""}:${end ?? ""}`;

    const result = await getCached(cacheKey, TTL_MEDIUM, async () => {
      const { rangeStart, rangeEnd } = resolveRange(mode, offset, start, end);

      const conds = [
        gte(sales.soldAt, rangeStart.toISOString()),
        lte(sales.soldAt, rangeEnd.toISOString()),
      ];
      if (activeBranchId) conds.push(eq(sales.branchId, activeBranchId));

      // Revenue is net of line discounts (discounted_price is a UNIT price), so
      // these totals reconcile with the period's net sales. Note get_top_products
      // deliberately reports GROSS (quantity * price) — don't cross-compare them.
      const rows = await db
        .select({
          category_id:   categories.id,
          category_name: categories.name,
          revenue:       sql`sum(${saleItems.quantity} * coalesce(${saleItems.discountedPrice}, ${saleItems.price}))`,
          quantity:      sql`sum(${saleItems.quantity})`,
          sale_count:    sql`count(distinct ${saleItems.saleId})`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .leftJoin(products, eq(saleItems.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(...conds))
        .groupBy(categories.id, categories.name);

      return rows
        .map((r) => ({
          // A product with no category still sold something; bucket it rather
          // than dropping the revenue silently.
          id:            r.category_id == null ? null : Number(r.category_id),
          name:          r.category_name ?? "Uncategorized",
          totalRevenue:  parseFloat(r.revenue) || 0,
          totalQuantity: parseInt(r.quantity, 10) || 0,
          numberOfSales: parseInt(r.sale_count, 10) || 0,
        }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    });

    return res.json(result);
  } catch (error) {
    console.error("Sales by category error:", error);
    return res.status(500).json({ message: "Error fetching sales by category", error: error.message });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function selectSalesInRange(activeBranchId, rangeStart, rangeEnd) {
  const conds = [gte(sales.soldAt, rangeStart.toISOString()), lte(sales.soldAt, rangeEnd.toISOString())];
  if (activeBranchId) conds.push(eq(sales.branchId, activeBranchId));
  return db
    .select({ id: sales.id, total_amount: sales.totalAmount, sold_at: sales.soldAt })
    .from(sales)
    .where(and(...conds))
    .orderBy(asc(sales.soldAt));
}

function resolveRange(mode, offset, start, end) {
  if (mode === "custom") {
    return { rangeStart: dayjs(start).startOf("day"), rangeEnd: dayjs(end).endOf("day") };
  }
  const unit = mode === "daily" ? "day" : mode === "weekly" ? "week" : mode === "monthly" ? "month" : "year";
  const anchor = dayjs().add(offset, unit);
  return { rangeStart: anchor.startOf(unit), rangeEnd: anchor.endOf(unit) };
}

// A custom range has no fixed granularity, so pick one that keeps the bar count
// readable on a phone: a single day is hourly, up to ~2 months is daily, and
// anything longer collapses to months.
function pickBucketMode(mode, rangeStart, rangeEnd) {
  if (mode === "daily")  return "hour";
  if (mode === "annual") return "month";
  if (mode === "weekly" || mode === "monthly") return "day";
  const days = rangeEnd.diff(rangeStart, "day");
  if (days <= 1)  return "hour";
  if (days <= 62) return "day";
  return "month";
}

function getDateKey(soldAt, bucketMode) {
  const d = dayjs(soldAt);
  if (bucketMode === "hour")  return d.format("HH");
  if (bucketMode === "month") return d.format("YYYY-MM");
  return d.format("YYYY-MM-DD");
}

function buildSkeleton(mode, bucketMode, rangeStart, rangeEnd) {
  const points = [];

  if (bucketMode === "hour") {
    for (let h = 0; h < 24; h++) {
      const hour = String(h).padStart(2, "0");
      points.push({ label: dayjs(rangeStart).hour(h).format("h A"), dateKey: hour, sales: 0, transactions: 0 });
    }
    return points;
  }

  if (bucketMode === "month") {
    // Annual keeps its bare "MMM"; a multi-year custom range needs the year too.
    const fmt = mode === "annual" ? "MMM" : "MMM YY";
    let cur = dayjs(rangeStart).startOf("month");
    while (cur.isBefore(rangeEnd)) {
      points.push({ label: cur.format(fmt), dateKey: cur.format("YYYY-MM"), sales: 0, transactions: 0 });
      cur = cur.add(1, "month");
    }
    return points;
  }

  // Daily buckets. Labels stay mode-specific so existing consumers of
  // weekly ("Mon") and monthly ("1".."31") see exactly what they did before.
  const fmt = mode === "weekly" ? "ddd" : mode === "monthly" ? "D" : "MMM D";
  let cur = dayjs(rangeStart).startOf("day");
  while (cur.isBefore(rangeEnd)) {
    points.push({ label: cur.format(fmt), dateKey: cur.format("YYYY-MM-DD"), sales: 0, transactions: 0 });
    cur = cur.add(1, "day");
  }
  return points;
}
