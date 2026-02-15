const { Sale, Product, Stock, User, sequelize } = require("../models");
const { Op } = require("sequelize");

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    // Determine which branch to filter by
    // Admin viewing all branches: no filter
    // Admin viewing specific branch: filter by currentBranchId
    // Regular users: filter by their branchId
    let branchFilter = {};
    if (userRole === "admin" && currentBranchId) {
      branchFilter = { branchId: currentBranchId };
    } else if (userRole !== "admin") {
      branchFilter = { branchId: userBranchId };
    }
    // If admin and no currentBranchId, branchFilter remains empty (all branches)

    // Get today's date range (start and end of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Today's Sales Amount and Transaction Count
    const todaySalesData = await Sale.findOne({
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("id")), "transactionCount"],
        [sequelize.fn("SUM", sequelize.col("totalAmount")), "totalSales"],
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

    // 2. Low Stock Count
    // Products where currentStock <= reorderPoint
    const lowStockCount = await Product.count({
      where: {
        currentStock: {
          [Op.lte]: sequelize.col("reorderPoint"),
        },
        status: "ACTIVE",
      },
    });

    // 3. Total Products Count
    const totalProducts = await Product.count({
      where: {
        status: "ACTIVE",
      },
    });

    // 4. Recent Sales (last 5-10 transactions)
    const recentSales = await Sale.findAll({
      where: branchFilter,
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "username", "firstName", "lastName"],
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
          ? `${sale.seller.firstName || ""} ${sale.seller.lastName || ""}`.trim()
          : "Unknown",
        username: sale.seller?.username || "unknown",
      },
    }));

    // 5. Additional useful stats (optional but recommended)
    // Out of stock count
    const outOfStockCount = await Product.count({
      where: {
        currentStock: 0,
        status: "ACTIVE",
      },
    });

    // Critical stock count (below minimum stock)
    const criticalStockCount = await Product.count({
      where: {
        currentStock: {
          [Op.gt]: 0,
          [Op.lte]: sequelize.col("minimumStock"),
        },
        status: "ACTIVE",
      },
    });

    // Return dashboard stats
    res.json({
      todaySales,
      todayTransactions,
      lowStockCount,
      totalProducts,
      recentSales: formattedRecentSales,
      // Additional stats
      outOfStockCount,
      criticalStockCount,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({
      message: "Error fetching dashboard statistics",
      error: error.message,
    });
  }
};

/**
 * Get weekly sales trend (optional - for charts)
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
 * Get top selling products (optional)
 * GET /api/dashboard/top-products
 */
exports.getTopProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;
    const userRole = req.user.role;
    const userBranchId = req.user.branchId;
    const currentBranchId = req.user.currentBranchId;

    let branchFilter = {};
    if (userRole === "admin" && currentBranchId) {
      branchFilter = { "$Sale.branchId$": currentBranchId };
    } else if (userRole !== "admin") {
      branchFilter = { "$Sale.branchId$": userBranchId };
    }

    // Get products with most sales in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const topProducts = await sequelize.query(
      `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.price,
        SUM(si.quantity) as totalQuantitySold,
        SUM(si.quantity * si.price) as totalRevenue,
        COUNT(DISTINCT si.saleId) as numberOfSales
      FROM products p
      INNER JOIN sale_items si ON p.id = si.productId
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.soldAt >= :thirtyDaysAgo
        ${currentBranchId ? "AND s.branchId = :branchId" : ""}
        ${userRole !== "admin" ? "AND s.branchId = :branchId" : ""}
      GROUP BY p.id, p.name, p.sku, p.price
      ORDER BY totalQuantitySold DESC
      LIMIT :limit
    `,
      {
        replacements: {
          thirtyDaysAgo,
          branchId: currentBranchId || userBranchId,
          limit,
        },
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