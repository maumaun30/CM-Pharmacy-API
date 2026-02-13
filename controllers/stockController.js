// controllers/stockController.js
const { Stock, Product, User, Branch } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");

// Helper function to get user's active branch
const getUserActiveBranch = async (userId) => {
  const user = await User.findByPk(userId, {
    include: [
      { model: Branch, as: "branch" },
      { model: Branch, as: "currentBranch" },
    ],
  });

  if (!user) {
    throw new Error("User not found");
  }

  const activeBranchId = user.currentBranchId || user.branchId;

  return {
    user,
    activeBranchId,
    canViewAllBranches: user.role === "admin" && !user.currentBranchId,
  };
};

// Get stock history for a product
exports.getProductStockHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(
      req.user.id,
    );

    const whereClause = { productId };

    // Filter by branch unless admin viewing all branches
    if (!canViewAllBranches) {
      whereClause.branchId = activeBranchId;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: stocks } = await Stock.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    return res.status(200).json({
      stocks,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get all stock transactions
exports.getAllStockTransactions = async (req, res) => {
  try {
    const {
      transactionType,
      search,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = req.query;

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(
      req.user.id,
    );

    const whereClause = {};

    // Filter by branch unless admin viewing all branches
    if (!canViewAllBranches) {
      whereClause.branchId = activeBranchId;
    }

    if (transactionType) {
      whereClause.transactionType = transactionType;
    }

    if (dateFrom) {
      whereClause.createdAt = {
        [Op.gte]: new Date(dateFrom),
      };
    }

    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: endOfDay,
      };
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: stocks } = await Stock.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
          where: search
            ? {
                [Op.or]: [
                  { name: { [Op.iLike]: `%${search}%` } },
                  { sku: { [Op.iLike]: `%${search}%` } },
                ],
              }
            : undefined,
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "username", "firstName", "lastName", "fullName"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    return res.status(200).json({
      stocks,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching stock transactions:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Add stock (purchase/initial/return)
exports.addStock = async (req, res) => {
  try {
    const {
      productId,
      quantity,
      unitCost,
      batchNumber,
      expiryDate,
      supplier,
      transactionType = "PURCHASE",
    } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({
        message: "Product ID and positive quantity are required",
      });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);

    if (!activeBranchId) {
      return res.status(400).json({
        message: "User is not assigned to any branch",
      });
    }

    const stock = await Stock.createTransaction({
      productId,
      transactionType,
      quantity: Math.abs(quantity),
      unitCost,
      batchNumber,
      expiryDate,
      supplier,
      performedBy: req.user.id,
      branchId: activeBranchId,
    });

    await createLog(
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Added ${quantity} units to product ${productId} at branch ${activeBranchId}`,
      { stock: stock.toJSON() },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    return res.status(201).json(stockWithProduct);
  } catch (error) {
    console.error("Error adding stock:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Adjust stock (manual adjustment)
exports.adjustStock = async (req, res) => {
  try {
    const { productId, quantity, reason } = req.body;

    if (!productId || !quantity || !reason) {
      return res.status(400).json({
        message: "Product ID, quantity, and reason are required",
      });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);

    if (!activeBranchId) {
      return res.status(400).json({
        message: "User is not assigned to any branch",
      });
    }

    const stock = await Stock.createTransaction({
      productId,
      transactionType: "ADJUSTMENT",
      quantity: parseInt(quantity),
      reason,
      performedBy: req.user.id,
      branchId: activeBranchId,
    });

    await createLog(
      req,
      "UPDATE",
      "stocks",
      stock.id,
      `Adjusted stock for product ${productId}: ${quantity > 0 ? "+" : ""}${quantity} at branch ${activeBranchId}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    return res.status(201).json(stockWithProduct);
  } catch (error) {
    console.error("Error adjusting stock:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Record damaged/expired stock
exports.recordStockLoss = async (req, res) => {
  try {
    const { productId, quantity, transactionType, reason, batchNumber } =
      req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({
        message: "Product ID and positive quantity are required",
      });
    }

    if (!["DAMAGE", "EXPIRED"].includes(transactionType)) {
      return res.status(400).json({
        message: "Transaction type must be DAMAGE or EXPIRED",
      });
    }

    const { activeBranchId } = await getUserActiveBranch(req.user.id);

    if (!activeBranchId) {
      return res.status(400).json({
        message: "User is not assigned to any branch",
      });
    }

    const stock = await Stock.createTransaction({
      productId,
      transactionType,
      quantity: -Math.abs(quantity),
      reason,
      batchNumber,
      performedBy: req.user.id,
      branchId: activeBranchId,
    });

    await createLog(
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Recorded ${transactionType.toLowerCase()} stock for product ${productId}: -${quantity} at branch ${activeBranchId}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    return res.status(201).json(stockWithProduct);
  } catch (error) {
    console.error("Error recording stock loss:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get low stock products
exports.getLowStockProducts = async (req, res) => {
  try {
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(
      req.user.id,
    );

    // Get all active products
    const products = await Product.findAll({
      where: {
        status: "ACTIVE",
      },
      attributes: [
        "id",
        "name",
        "sku",
        "currentStock",
        "minimumStock",
        "reorderPoint",
        "price",
      ],
      order: [["currentStock", "ASC"]],
    });

    // Filter in JavaScript for low stock
    const lowStockProducts = products.filter(
      (p) => p.currentStock <= (p.reorderPoint || 20),
    );

    // If not viewing all branches, filter by stock transactions in current branch
    if (!canViewAllBranches && activeBranchId) {
      // Get product IDs that have stock in this branch
      const branchStocks = await Stock.findAll({
        where: { branchId: activeBranchId },
        attributes: ["productId"],
        group: ["productId"],
      });

      const branchProductIds = branchStocks.map((s) => s.productId);

      // Filter products to only those in this branch
      return res
        .status(200)
        .json(lowStockProducts.filter((p) => branchProductIds.includes(p.id)));
    }

    return res.status(200).json(lowStockProducts);
  } catch (error) {
    console.error("Error fetching low stock products:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get stock summary/statistics
exports.getStockSummary = async (req, res) => {
  try {
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(
      req.user.id,
    );

    const products = await Product.findAll({
      where: { status: "ACTIVE" },
      attributes: ["id", "currentStock", "minimumStock", "reorderPoint"],
    });

    // If not viewing all branches, filter by branch
    let filteredProducts = products;
    if (!canViewAllBranches && activeBranchId) {
      const branchStocks = await Stock.findAll({
        where: { branchId: activeBranchId },
        attributes: ["productId"],
        group: ["productId"],
      });

      const branchProductIds = branchStocks.map((s) => s.productId);
      filteredProducts = products.filter((p) =>
        branchProductIds.includes(p.id),
      );
    }

    const totalProducts = filteredProducts.length;
    const outOfStock = filteredProducts.filter(
      (p) => p.currentStock === 0,
    ).length;
    const lowStock = filteredProducts.filter(
      (p) => p.currentStock > 0 && p.currentStock <= (p.reorderPoint || 20),
    ).length;
    const criticalStock = filteredProducts.filter(
      (p) => p.currentStock > 0 && p.currentStock <= (p.minimumStock || 10),
    ).length;

    const recentTransactionsWhere = {
      createdAt: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    };

    // Filter recent transactions by branch
    if (!canViewAllBranches && activeBranchId) {
      recentTransactionsWhere.branchId = activeBranchId;
    }

    const recentTransactions = await Stock.count({
      where: recentTransactionsWhere,
    });

    return res.status(200).json({
      totalProducts,
      outOfStock,
      lowStock,
      criticalStock,
      recentTransactions,
    });
  } catch (error) {
    console.error("Error fetching stock summary:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
