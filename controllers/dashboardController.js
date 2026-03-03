const { Sale, Product, User, BranchStock, Branch, sequelize } = require("../models");
const { Op } = require("sequelize");
const dayjs = require("dayjs");

/**
 * Get dashboard statistics with branch-based stock
 * GET /api/dashboard/stats
 */
exports.getDashboardStats = async (req, res) => {
  try {
    console.log("📊 Dashboard accessed by:", {
      id: req.user.id,
      role: req.user.role,
      username: req.user.username,
      branchId: req.user.branchId,
      currentBranchId: req.user.currentBranchId,
    });

    const userId = req.user.id;
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    // Determine which branch to filter by
    let branchFilter = {};
    let activeBranchId = null;
    
    if (userRole === "admin" && currentBranchId) {
      // Admin viewing specific branch
      branchFilter = { branchId: currentBranchId };
      activeBranchId = currentBranchId;
    } else if (userRole !== "admin") {
      // Non-admin users see only their branch
      branchFilter = { branchId: userBranchId };
      activeBranchId = userBranchId;
    }
    // If admin without currentBranchId, show all branches (no filter)

    // Get today's date range (start and end of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Today's Sales Amount and Transaction Count
    const todaySalesData = await Sale.findOne({
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("Sale.id")), "transactionCount"],
        [sequelize.fn("SUM", sequelize.col("Sale.totalAmount")), "totalSales"],
      ],
      where: {
        soldAt: {
          [Op.gte]: today,
          [Op.lt]: tomorrow,
        },
        ...branchFilter,
      },
      raw: true,
    });

    const todaySales = parseFloat(todaySalesData?.totalSales || 0);
    const todayTransactions = parseInt(todaySalesData?.transactionCount || 0);

    // 2. Low Stock Count (branch-based)
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let criticalStockCount = 0;
    
    if (activeBranchId) {
      // Specific branch stock counts
      lowStockCount = await BranchStock.count({
        where: {
          branchId: activeBranchId,
          currentStock: {
            [Op.lte]: sequelize.col("BranchStock.reorderPoint"),
          },
        },
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
      });

      outOfStockCount = await BranchStock.count({
        where: {
          branchId: activeBranchId,
          currentStock: 0,
        },
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
      });

      criticalStockCount = await BranchStock.count({
        where: {
          branchId: activeBranchId,
          currentStock: {
            [Op.gt]: 0,
            [Op.lte]: sequelize.col("BranchStock.minimumStock"),
          },
        },
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
      });
    } else {
      // All branches - count unique products with low stock in any branch
      const lowStockProducts = await BranchStock.findAll({
        attributes: [
          "productId",
          [sequelize.fn("SUM", sequelize.col("currentStock")), "totalStock"],
          [sequelize.fn("AVG", sequelize.col("reorderPoint")), "avgReorderPoint"],
        ],
        where: sequelize.literal(
          '"BranchStock"."currentStock" <= "BranchStock"."reorderPoint"'
        ),
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
        group: ["productId"],
        raw: true,
      });
      lowStockCount = lowStockProducts.length;

      outOfStockCount = await BranchStock.count({
        where: { currentStock: 0 },
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
      });

      const criticalProducts = await BranchStock.findAll({
        attributes: ["productId"],
        where: {
          currentStock: {
            [Op.gt]: 0,
            [Op.lte]: sequelize.col("BranchStock.minimumStock"),
          },
        },
        include: [
          {
            model: Product,
            as: "product",
            where: { status: "ACTIVE" },
            attributes: [],
          },
        ],
        group: ["productId"],
        raw: true,
      });
      criticalStockCount = criticalProducts.length;
    }

    // 3. Total Products Count
    const totalProducts = await Product.count({
      where: {
        status: "ACTIVE",
      },
    });

    // 4. Recent Sales (last 10 transactions)
    const recentSales = await Sale.findAll({
      where: branchFilter,
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "username", "firstName", "lastName"],
          required: false,
        },
      ],
      order: [["soldAt", "DESC"]],
      limit: 10,
      attributes: ["id", "totalAmount", "soldAt"],
    });

    // Format recent sales for frontend
    const formattedRecentSales = recentSales.map((sale) => ({
      id: sale.id,
      createdAt: sale.soldAt,
      totalAmount: parseFloat(sale.totalAmount),
      user: {
        fullName: sale.seller
          ? `${sale.seller.firstName || ""} ${sale.seller.lastName || ""}`.trim() || sale.seller.username
          : "Unknown",
        username: sale.seller?.username || "unknown",
      },
    }));

    console.log("✅ Dashboard stats successfully fetched", {
      todaySales,
      todayTransactions,
      lowStockCount,
      totalProducts,
      activeBranchId,
    });

    // Return dashboard stats
    res.json({
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
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      message: "Error fetching dashboard statistics",
      error: error.message,
    });
  }
};

/**
 * Get weekly sales trend
 * GET /api/dashboard/weekly-trend
 */
exports.getWeeklySalesTrend = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    let branchFilter = {};
    if (userRole === "admin" && currentBranchId) {
      branchFilter = { branchId: currentBranchId };
    } else if (userRole !== "admin") {
      branchFilter = { branchId: userBranchId };
    }

    // Get last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const salesByDay = await Sale.findAll({
      attributes: [
        [sequelize.fn("DATE", sequelize.col("soldAt")), "date"],
        [sequelize.fn("COUNT", sequelize.col("id")), "transactionCount"],
        [sequelize.fn("SUM", sequelize.col("totalAmount")), "totalSales"],
      ],
      where: {
        soldAt: {
          [Op.gte]: sevenDaysAgo,
        },
        ...branchFilter,
      },
      group: [sequelize.fn("DATE", sequelize.col("soldAt"))],
      order: [[sequelize.fn("DATE", sequelize.col("soldAt")), "ASC"]],
      raw: true,
    });

    const formattedTrend = salesByDay.map((day) => ({
      date: day.date,
      sales: parseFloat(day.totalSales || 0),
      transactions: parseInt(day.transactionCount || 0),
    }));

    res.json(formattedTrend);
  } catch (error) {
    console.error("Weekly trend error:", error);
    res.status(500).json({
      message: "Error fetching weekly sales trend",
      error: error.message,
    });
  }
};

/**
 * Get top selling products
 * GET /api/dashboard/top-products
 */
exports.getTopProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    let branchCondition = "";
    const replacements = { limit };

    if (userRole === "admin" && currentBranchId) {
      branchCondition = 'AND s."branchId" = :branchId';
      replacements.branchId = currentBranchId;
    } else if (userRole !== "admin") {
      branchCondition = 'AND s."branchId" = :branchId';
      replacements.branchId = userBranchId;
    }

    // Get products with most sales in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    replacements.thirtyDaysAgo = thirtyDaysAgo;

    const topProducts = await sequelize.query(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        SUM(si.quantity) as "totalQuantitySold",
        SUM(si.quantity * si.price) as "totalRevenue",
        COUNT(DISTINCT si."saleId") as "numberOfSales"
      FROM products p
      INNER JOIN sale_items si ON p.id = si."productId"
      INNER JOIN sales s ON si."saleId" = s.id
      WHERE s."soldAt" >= :thirtyDaysAgo
        ${branchCondition}
      GROUP BY p.id, p.name, p.sku, p.price
      ORDER BY "totalQuantitySold" DESC
      LIMIT :limit
    `,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const formattedProducts = topProducts.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: parseFloat(product.price),
      totalQuantitySold: parseInt(product.totalQuantitySold),
      totalRevenue: parseFloat(product.totalRevenue),
      numberOfSales: parseInt(product.numberOfSales),
    }));

    res.json(formattedProducts);
  } catch (error) {
    console.error("Top products error:", error);
    res.status(500).json({
      message: "Error fetching top products",
      error: error.message,
    });
  }
};

/**
 * Get branch-specific stock alerts
 * GET /api/dashboard/stock-alerts
 */
exports.getStockAlerts = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    let branchFilter = {};
    if (userRole === "admin" && currentBranchId) {
      branchFilter = { branchId: currentBranchId };
    } else if (userRole !== "admin") {
      branchFilter = { branchId: userBranchId };
    }

    const alerts = await BranchStock.findAll({
      where: {
        ...branchFilter,
        [Op.or]: [
          { currentStock: 0 },
          sequelize.literal(
            '"BranchStock"."currentStock" <= "BranchStock"."reorderPoint"'
          ),
        ],
      },
      include: [
        {
          model: Product,
          as: "product",
          where: { status: "ACTIVE" },
          attributes: ["id", "name", "sku", "brandName"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
      order: [
        ["currentStock", "ASC"],
        ["branchId", "ASC"],
      ],
      limit: 20,
    });

    const formattedAlerts = alerts.map((alert) => ({
      id: alert.id,
      productId: alert.productId,
      branchId: alert.branchId,
      currentStock: alert.currentStock,
      minimumStock: alert.minimumStock,
      reorderPoint: alert.reorderPoint,
      status: alert.stockStatus,
      product: {
        id: alert.product.id,
        name: alert.product.name,
        sku: alert.product.sku,
        brandName: alert.product.brandName,
      },
      branch: alert.branch,
    }));

    res.json(formattedAlerts);
  } catch (error) {
    console.error("Stock alerts error:", error);
    res.status(500).json({
      message: "Error fetching stock alerts",
      error: error.message,
    });
  }
};

// ─── Helper: dateKey per mode ────────────────────────────────────────────────
function getDateKey(soldAt, mode) {
  const d = dayjs(soldAt);
  if (mode === "daily") return d.format("HH");      // "09"
  return d.format("YYYY-MM-DD");                    // "2026-03-03"
}

// ─── Helper: build empty skeleton ───────────────────────────────────────────
function buildSkeleton(mode, rangeStart) {
  const points = [];

  if (mode === "daily") {
    for (let h = 0; h < 24; h++) {
      const hour = String(h).padStart(2, "0");
      points.push({
        label: dayjs(rangeStart).hour(h).format("h A"), // "9 AM"
        dateKey: hour,
        sales: 0,
        transactions: 0,
      });
    }
  } else if (mode === "weekly") {
    for (let d = 0; d < 7; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({
        label: day.format("ddd"),           // "Mon"
        dateKey: day.format("YYYY-MM-DD"),
        sales: 0,
        transactions: 0,
      });
    }
  } else {
    // monthly — one point per day in the month
    const daysInMonth = dayjs(rangeStart).daysInMonth();
    for (let d = 0; d < daysInMonth; d++) {
      const day = dayjs(rangeStart).add(d, "day");
      points.push({
        label: day.format("D"),             // "1", "15", "31"
        dateKey: day.format("YYYY-MM-DD"),
        sales: 0,
        transactions: 0,
      });
    }
  }

  return points;
}

// ─── Controller ──────────────────────────────────────────────────────────────
exports.getSalesTrend = async (req, res) => {
  try {
    const { Sale } = require("../models");
    const { Op } = require("sequelize");

    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    // Mirror the branch filtering used in getDashboardStats
    let branchFilter = {};
    if (userRole === "admin" && currentBranchId) {
      branchFilter = { branchId: currentBranchId };
    } else if (userRole !== "admin") {
      branchFilter = { branchId: userBranchId };
    }

    const mode   = req.query.mode   || "daily";
    const offset = parseInt(req.query.offset ?? "0", 10);

    // Build the date window
    let rangeStart, rangeEnd;
    if (mode === "daily") {
      rangeStart = dayjs().add(offset, "day").startOf("day").toDate();
      rangeEnd   = dayjs().add(offset, "day").endOf("day").toDate();
    } else if (mode === "weekly") {
      rangeStart = dayjs().add(offset, "week").startOf("week").toDate();
      rangeEnd   = dayjs().add(offset, "week").endOf("week").toDate();
    } else {
      rangeStart = dayjs().add(offset, "month").startOf("month").toDate();
      rangeEnd   = dayjs().add(offset, "month").endOf("month").toDate();
    }

    // Fetch all sales in window (lightweight query — just id, amount, soldAt)
    const sales = await Sale.findAll({
      where: {
        soldAt: { [Op.between]: [rangeStart, rangeEnd] },
        ...branchFilter,
      },
      attributes: ["id", "totalAmount", "soldAt"],
      order: [["soldAt", "ASC"]],
      raw: true,
    });

    // Fill skeleton with actual data
    const points = buildSkeleton(mode, rangeStart);
    let totalSales = 0;
    let totalTransactions = 0;

    for (const sale of sales) {
      const key   = getDateKey(sale.soldAt, mode);
      const point = points.find((p) => p.dateKey === key);
      if (point) {
        point.sales        += parseFloat(sale.totalAmount);
        point.transactions += 1;
      }
      totalSales        += parseFloat(sale.totalAmount);
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
