// controllers/stockController.js
const { Stock, Product, User, Branch, BranchStock, sequelize } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");
const { emitStockUpdate, emitLowStockAlert, emitDashboardRefresh } = require("../utils/socket");

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

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

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
          attributes: ["id", "username", "firstName", "lastName"],
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

    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

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
          attributes: ["id", "username", "firstName", "lastName"],
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

    // ✅ GET BRANCH STOCK (not product stock)
    const branchStock = await BranchStock.findOne({
      where: { productId, branchId: activeBranchId },
    });

    if (!branchStock) {
      return res.status(404).json({
        message: "Product not found in this branch inventory",
      });
    }

    const quantityBefore = branchStock.currentStock;
    const quantityAfter = quantityBefore + Math.abs(quantity);

    // ✅ UPDATE BRANCH STOCK
    await branchStock.update({ currentStock: quantityAfter });

    // ✅ CREATE STOCK TRANSACTION with before/after
    const stock = await Stock.create({
      productId,
      branchId: activeBranchId,
      transactionType,
      quantity: Math.abs(quantity),
      quantityBefore,
      quantityAfter,
      unitCost: unitCost ? parseFloat(unitCost) : null,
      totalCost: unitCost ? parseFloat(unitCost) * Math.abs(quantity) : null,
      batchNumber: batchNumber || null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      supplier: supplier || null,
      performedBy: req.user.id,
    });

    await createLog(
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Added ${quantity} units to product ${productId} at branch ${activeBranchId}`,
      { stock: stock.toJSON() },
    );

    const stockWithDetails = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    // ✅ EMIT SOCKET EVENTS with branch context
    emitStockUpdate(activeBranchId, {
      productId,
      newStock: quantityAfter,
    });

    // Check if low stock
    if (quantityAfter <= branchStock.reorderPoint) {
      emitLowStockAlert(activeBranchId, {
        id: productId,
        name: stockWithDetails.product.name,
        sku: stockWithDetails.product.sku,
        currentStock: quantityAfter,
        reorderPoint: branchStock.reorderPoint,
        minimumStock: branchStock.minimumStock,
        branchId: activeBranchId,
      });
    }

    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stockWithDetails);
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

    // Get branch stock
    const branchStock = await BranchStock.findOne({
      where: { productId, branchId: activeBranchId },
    });

    if (!branchStock) {
      return res.status(404).json({
        message: "Product not found in this branch inventory",
      });
    }

    const quantityBefore = branchStock.currentStock;
    const quantityAfter = Math.max(0, quantityBefore + parseInt(quantity));

    // Update branch stock
    await branchStock.update({ currentStock: quantityAfter });

    // Create transaction
    const stock = await Stock.create({
      productId,
      branchId: activeBranchId,
      transactionType: "ADJUSTMENT",
      quantity: parseInt(quantity),
      quantityBefore,
      quantityAfter,
      reason: reason || null,
      performedBy: req.user.id,
    });

    await createLog(
      req,
      "UPDATE",
      "stocks",
      stock.id,
      `Adjusted stock for product ${productId}: ${quantity > 0 ? "+" : ""}${quantity} at branch ${activeBranchId}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithDetails = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    // Socket emissions
    emitStockUpdate(activeBranchId, {
      productId,
      newStock: quantityAfter,
    });

    if (quantityAfter <= branchStock.reorderPoint) {
      emitLowStockAlert(activeBranchId, {
        id: productId,
        name: stockWithDetails.product.name,
        sku: stockWithDetails.product.sku,
        currentStock: quantityAfter,
        reorderPoint: branchStock.reorderPoint,
        minimumStock: branchStock.minimumStock,
        branchId: activeBranchId,
      });
    }

    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stockWithDetails);
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
    const { productId, quantity, transactionType, reason, batchNumber } = req.body;

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

    // Get branch stock
    const branchStock = await BranchStock.findOne({
      where: { productId, branchId: activeBranchId },
    });

    if (!branchStock) {
      return res.status(404).json({
        message: "Product not found in this branch inventory",
      });
    }

    const quantityBefore = branchStock.currentStock;
    const quantityAfter = Math.max(0, quantityBefore - Math.abs(quantity));

    // Update branch stock
    await branchStock.update({ currentStock: quantityAfter });

    // Create transaction (negative quantity)
    const stock = await Stock.create({
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
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Recorded ${transactionType.toLowerCase()} stock for product ${productId}: -${quantity} at branch ${activeBranchId}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithDetails = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    // Socket emissions
    emitStockUpdate(activeBranchId, {
      productId,
      newStock: quantityAfter,
    });

    if (quantityAfter <= branchStock.reorderPoint) {
      emitLowStockAlert(activeBranchId, {
        id: productId,
        name: stockWithDetails.product.name,
        sku: stockWithDetails.product.sku,
        currentStock: quantityAfter,
        reorderPoint: branchStock.reorderPoint,
        minimumStock: branchStock.minimumStock,
        branchId: activeBranchId,
      });
    }

    emitDashboardRefresh(activeBranchId);

    return res.status(201).json(stockWithDetails);
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
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    const whereClause = {
      [Op.or]: [
        { currentStock: 0 },
        sequelize.literal('"BranchStock"."currentStock" <= "BranchStock"."reorderPoint"'),
      ],
    };

    // Filter by branch if not viewing all
    if (!canViewAllBranches && activeBranchId) {
      whereClause.branchId = activeBranchId;
    }

    // ✅ QUERY BRANCH_STOCKS TABLE
    const lowStockItems = await BranchStock.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          where: { status: "ACTIVE" },
          attributes: ["id", "name", "sku", "price"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
      order: [["currentStock", "ASC"]],
    });

    // Format response
    const formatted = lowStockItems.map((item) => ({
      id: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      currentStock: item.currentStock,
      minimumStock: item.minimumStock,
      reorderPoint: item.reorderPoint,
      price: parseFloat(item.product.price),
      branchId: item.branchId,
      branchName: item.branch?.name,
      branchCode: item.branch?.code,
    }));

    return res.status(200).json(formatted);
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
    const { activeBranchId, canViewAllBranches } = await getUserActiveBranch(req.user.id);

    const whereClause = {};

    // Filter by branch if not viewing all
    if (!canViewAllBranches && activeBranchId) {
      whereClause.branchId = activeBranchId;
    }

    // ✅ QUERY BRANCH_STOCKS TABLE
    const branchStocks = await BranchStock.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          where: { status: "ACTIVE" },
          attributes: [],
        },
      ],
    });

    // Calculate summary
    const totalProducts = new Set(branchStocks.map((bs) => bs.productId)).size;
    const outOfStock = branchStocks.filter((bs) => bs.currentStock === 0).length;
    const lowStock = branchStocks.filter(
      (bs) => bs.currentStock > 0 && bs.currentStock <= bs.reorderPoint,
    ).length;
    const criticalStock = branchStocks.filter(
      (bs) => bs.currentStock > 0 && bs.currentStock <= bs.minimumStock,
    ).length;

    // Recent transactions
    const transactionsWhere = {
      createdAt: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    };

    if (!canViewAllBranches && activeBranchId) {
      transactionsWhere.branchId = activeBranchId;
    }

    const recentTransactions = await Stock.count({
      where: transactionsWhere,
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