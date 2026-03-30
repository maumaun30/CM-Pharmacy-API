const supabase = require("../config/supabase");
const dayjs = require("dayjs");

// ─── Branch filter helper ─────────────────────────────────────────────────────

function getActiveBranchId(user) {
  if (user.role === "admin" && user.currentBranchId) return user.currentBranchId;
  if (user.role !== "admin") return user.branchId;
  return null; // admin with no currentBranchId → all branches
}

// ─── Get Dashboard Stats ──────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res) => {
  try {
    console.log("📊 Dashboard accessed by:", {
      id: req.user.id,
      role: req.user.role,
      username: req.user.username,
      branchId: req.user.branchId,
      currentBranchId: req.user.currentBranchId,
    });

    const activeBranchId = getActiveBranchId(req.user);

    const today     = dayjs().startOf("day").toISOString();
    const tomorrow  = dayjs().add(1, "day").startOf("day").toISOString();

    // ── 1. Today's sales totals ──────────────────────────────────────────────
    let salesQuery = supabase
      .from("sales")
      .select("total_amount")
      .gte("sold_at", today)
      .lt("sold_at", tomorrow);

    if (activeBranchId) salesQuery = salesQuery.eq("branch_id", activeBranchId);

    const { data: todaySalesRows, error: salesError } = await salesQuery;
    if (salesError) throw salesError;

    const todaySales        = todaySalesRows.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
    const todayTransactions = todaySalesRows.length;

    // ── 2. Stock counts ──────────────────────────────────────────────────────
    // Supabase JS can't compare two columns (currentStock <= reorderPoint) in
    // a filter, so we fetch relevant rows and compute counts in JS.
    let stockQuery = supabase
      .from("branch_stocks")
      .select(`
        current_stock, minimum_stock, reorder_point, product_id,
        product:products!inner (status)
      `)
      .eq("product.status", "ACTIVE");

    if (activeBranchId) stockQuery = stockQuery.eq("branch_id", activeBranchId);

    const { data: stockRows, error: stockError } = await stockQuery;
    if (stockError) throw stockError;

    let lowStockCount      = 0;
    let outOfStockCount    = 0;
    let criticalStockCount = 0;

    if (activeBranchId) {
      // Per-branch: count rows directly
      outOfStockCount    = stockRows.filter((r) => r.current_stock === 0).length;
      criticalStockCount = stockRows.filter((r) => r.current_stock > 0 && r.current_stock <= r.minimum_stock).length;
      lowStockCount      = stockRows.filter((r) => r.current_stock <= r.reorder_point).length;
    } else {
      // All branches: count unique products
      const lowIds      = new Set(stockRows.filter((r) => r.current_stock <= r.reorder_point).map((r) => r.product_id));
      const outIds      = new Set(stockRows.filter((r) => r.current_stock === 0).map((r) => r.product_id));
      const criticalIds = new Set(stockRows.filter((r) => r.current_stock > 0 && r.current_stock <= r.minimum_stock).map((r) => r.product_id));
      lowStockCount      = lowIds.size;
      outOfStockCount    = outIds.size;
      criticalStockCount = criticalIds.size;
    }

    // ── 3. Total active products ─────────────────────────────────────────────
    const { count: totalProducts, error: productError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE");

    if (productError) throw productError;

    // ── 4. Recent sales (last 10) ────────────────────────────────────────────
    let recentQuery = supabase
      .from("sales")
      .select(`
        id, total_amount, sold_at,
        seller:users (id, username, first_name, last_name)
      `)
      .order("sold_at", { ascending: false })
      .limit(10);

    if (activeBranchId) recentQuery = recentQuery.eq("branch_id", activeBranchId);

    const { data: recentSales, error: recentError } = await recentQuery;
    if (recentError) throw recentError;

    const formattedRecentSales = recentSales.map((sale) => ({
      id: sale.id,
      createdAt: sale.sold_at,
      totalAmount: parseFloat(sale.total_amount),
      user: {
        fullName: sale.seller
          ? `${sale.seller.first_name || ""} ${sale.seller.last_name || ""}`.trim() || sale.seller.username
          : "Unknown",
        username: sale.seller?.username || "unknown",
      },
    }));

    console.log("✅ Dashboard stats successfully fetched", {
      todaySales, todayTransactions, lowStockCount, totalProducts, activeBranchId,
    });

    return res.json({
      todaySales,
      todayTransactions,
      lowStockCount,
      totalProducts,
      recentSales: formattedRecentSales,
      outOfStockCount,
      criticalStockCount,
      branchId: activeBranchId,
    });
  } catch (error) {
    console.error("❌ Dashboard stats error:", error);
    return res.status(500).json({
      message: "Error fetching dashboard statistics",
      error: error.message,
    });
  }
};

// ─── Get Weekly Sales Trend ───────────────────────────────────────────────────

exports.getWeeklySalesTrend = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const sevenDaysAgo   = dayjs().subtract(7, "day").startOf("day").toISOString();

    let query = supabase
      .from("sales")
      .select("total_amount, sold_at")
      .gte("sold_at", sevenDaysAgo)
      .order("sold_at", { ascending: true });

    if (activeBranchId) query = query.eq("branch_id", activeBranchId);

    const { data: sales, error } = await query;
    if (error) throw error;

    // Group by date in JS
    const byDay = {};
    for (const sale of sales) {
      const date = dayjs(sale.sold_at).format("YYYY-MM-DD");
      if (!byDay[date]) byDay[date] = { date, sales: 0, transactions: 0 };
      byDay[date].sales        += parseFloat(sale.total_amount);
      byDay[date].transactions += 1;
    }

    const formattedTrend = Object.values(byDay);

    return res.json(formattedTrend);
  } catch (error) {
    console.error("Weekly trend error:", error);
    return res.status(500).json({
      message: "Error fetching weekly sales trend",
      error: error.message,
    });
  }
};

// ─── Get Top Products ─────────────────────────────────────────────────────────

exports.getTopProducts = async (req, res) => {
  try {
    const limit          = parseInt(req.query.limit) || 10;
    const activeBranchId = getActiveBranchId(req.user);
    const thirtyDaysAgo  = dayjs().subtract(30, "day").startOf("day").toISOString();

    /*
      Supabase JS can't do multi-table aggregates, so this uses an RPC.
      Create it once in Supabase SQL Editor:

      create or replace function get_top_products(
        p_branch_id     bigint  default null,
        p_since         timestamptz,
        p_limit         integer default 10
      )
      returns table (
        id                  bigint,
        name                text,
        sku                 text,
        price               numeric,
        total_quantity_sold bigint,
        total_revenue       numeric,
        number_of_sales     bigint
      ) as $$
      begin
        return query
        select
          p.id,
          p.name,
          p.sku,
          p.price,
          sum(si.quantity)::bigint                as total_quantity_sold,
          sum(si.quantity * si.price)             as total_revenue,
          count(distinct si.sale_id)::bigint      as number_of_sales
        from products p
        inner join sale_items si on p.id = si.product_id
        inner join sales s       on si.sale_id = s.id
        where s.sold_at >= p_since
          and (p_branch_id is null or s.branch_id = p_branch_id)
        group by p.id, p.name, p.sku, p.price
        order by total_quantity_sold desc
        limit p_limit;
      end;
      $$ language plpgsql;
    */

    const { data: topProducts, error } = await supabase.rpc("get_top_products", {
      p_branch_id: activeBranchId,
      p_since:     thirtyDaysAgo,
      p_limit:     limit,
    });

    if (error) throw error;

    const formatted = topProducts.map((p) => ({
      id:                p.id,
      name:              p.name,
      sku:               p.sku,
      price:             parseFloat(p.price),
      totalQuantitySold: parseInt(p.total_quantity_sold),
      totalRevenue:      parseFloat(p.total_revenue),
      numberOfSales:     parseInt(p.number_of_sales),
    }));

    return res.json(formatted);
  } catch (error) {
    console.error("Top products error:", error);
    return res.status(500).json({
      message: "Error fetching top products",
      error: error.message,
    });
  }
};

// ─── Get Stock Alerts ─────────────────────────────────────────────────────────

exports.getStockAlerts = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);

    let query = supabase
      .from("branch_stocks")
      .select(`
        id, product_id, branch_id,
        current_stock, minimum_stock, reorder_point,
        product:products!inner (id, name, sku, brand_name, status),
        branch:branches (id, name, code)
      `)
      .eq("product.status", "ACTIVE")
      .order("current_stock", { ascending: true })
      .order("branch_id", { ascending: true })
      .limit(20);

    if (activeBranchId) query = query.eq("branch_id", activeBranchId);

    const { data: allStocks, error } = await query;
    if (error) throw error;

    // Column-to-column comparison done in JS
    const alerts = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    const formattedAlerts = alerts.map((alert) => ({
      id:           alert.id,
      productId:    alert.product_id,
      branchId:     alert.branch_id,
      currentStock: alert.current_stock,
      minimumStock: alert.minimum_stock,
      reorderPoint: alert.reorder_point,
      status:
        alert.current_stock === 0
          ? "OUT_OF_STOCK"
          : alert.current_stock <= alert.minimum_stock
          ? "CRITICAL"
          : "LOW",
      product: {
        id:        alert.product.id,
        name:      alert.product.name,
        sku:       alert.product.sku,
        brandName: alert.product.brand_name,
      },
      branch: alert.branch,
    }));

    return res.json(formattedAlerts);
  } catch (error) {
    console.error("Stock alerts error:", error);
    return res.status(500).json({
      message: "Error fetching stock alerts",
      error: error.message,
    });
  }
};

// ─── Get Sales Trend (daily / weekly / monthly) ───────────────────────────────

exports.getSalesTrend = async (req, res) => {
  try {
    const activeBranchId = getActiveBranchId(req.user);
    const mode   = req.query.mode   || "daily";
    const offset = parseInt(req.query.offset ?? "0", 10);

    let rangeStart, rangeEnd;
    if (mode === "daily") {
      rangeStart = dayjs().add(offset, "day").startOf("day");
      rangeEnd   = dayjs().add(offset, "day").endOf("day");
    } else if (mode === "weekly") {
      rangeStart = dayjs().add(offset, "week").startOf("week");
      rangeEnd   = dayjs().add(offset, "week").endOf("week");
    } else {
      rangeStart = dayjs().add(offset, "month").startOf("month");
      rangeEnd   = dayjs().add(offset, "month").endOf("month");
    }

    let query = supabase
      .from("sales")
      .select("id, total_amount, sold_at")
      .gte("sold_at", rangeStart.toISOString())
      .lte("sold_at", rangeEnd.toISOString())
      .order("sold_at", { ascending: true });

    if (activeBranchId) query = query.eq("branch_id", activeBranchId);

    const { data: sales, error } = await query;
    if (error) throw error;

    const points = buildSkeleton(mode, rangeStart);
    let totalSales = 0;
    let totalTransactions = 0;

    for (const sale of sales) {
      const key   = getDateKey(sale.sold_at, mode);
      const point = points.find((p) => p.dateKey === key);
      if (point) {
        point.sales        += parseFloat(sale.total_amount);
        point.transactions += 1;
      }
      totalSales        += parseFloat(sale.total_amount);
      totalTransactions += 1;
    }

    return res.json({ points, totalSales, totalTransactions });
  } catch (error) {
    console.error("Sales trend error:", error);
    return res.status(500).json({
      message: "Error fetching sales trend",
      error: error.message,
    });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateKey(soldAt, mode) {
  const d = dayjs(soldAt);
  return mode === "daily" ? d.format("HH") : d.format("YYYY-MM-DD");
}

function buildSkeleton(mode, rangeStart) {
  const points = [];

  if (mode === "daily") {
    for (let h = 0; h < 24; h++) {
      const hour = String(h).padStart(2, "0");
      points.push({
        label:        dayjs(rangeStart).hour(h).format("h A"),
        dateKey:      hour,
        sales:        0,
        transactions: 0,
      });
    }
  } else if (mode === "weekly") {
    for (let d = 0; d < 7; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({
        label:        day.format("ddd"),
        dateKey:      day.format("YYYY-MM-DD"),
        sales:        0,
        transactions: 0,
      });
    }
  } else {
    const daysInMonth = dayjs(rangeStart).daysInMonth();
    for (let d = 0; d < daysInMonth; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({
        label:        day.format("D"),
        dateKey:      day.format("YYYY-MM-DD"),
        sales:        0,
        transactions: 0,
      });
    }
  }

  return points;
}