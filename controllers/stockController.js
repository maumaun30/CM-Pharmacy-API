// controllers/stockController.js
const { Stock, Product, User } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");

// Get stock history for a product
exports.getProductStockHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: stocks } = await Stock.findAndCountAll({
      where: { productId },
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

    const whereClause = {};

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
          attributes: ["id", "username"],
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

    const stock = await Stock.createTransaction({
      productId,
      transactionType,
      quantity: Math.abs(quantity),
      unitCost,
      batchNumber,
      expiryDate,
      supplier,
      performedBy: req.user.id,
    });

    await createLog(
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Added ${quantity} units to product ${productId}`,
      { stock: stock.toJSON() },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
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

    const stock = await Stock.createTransaction({
      productId,
      transactionType: "ADJUSTMENT",
      quantity: parseInt(quantity),
      reason,
      performedBy: req.user.id,
    });

    await createLog(
      req,
      "UPDATE",
      "stocks",
      stock.id,
      `Adjusted stock for product ${productId}: ${quantity > 0 ? "+" : ""}${quantity}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
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

    const stock = await Stock.createTransaction({
      productId,
      transactionType,
      quantity: -Math.abs(quantity),
      reason,
      batchNumber,
      performedBy: req.user.id,
    });

    await createLog(
      req,
      "CREATE",
      "stocks",
      stock.id,
      `Recorded ${transactionType.toLowerCase()} stock for product ${productId}: -${quantity}`,
      { stock: stock.toJSON(), reason },
    );

    const stockWithProduct = await Stock.findByPk(stock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "currentStock"],
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

    // Filter in JavaScript
    const lowStockProducts = products.filter(
      (p) => p.currentStock <= (p.reorderPoint || 20),
    );

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
    const products = await Product.findAll({
      where: { status: "ACTIVE" },
      attributes: ["currentStock", "minimumStock", "reorderPoint"],
    });

    const totalProducts = products.length;
    const outOfStock = products.filter((p) => p.currentStock === 0).length;
    const lowStock = products.filter(
      (p) => p.currentStock > 0 && p.currentStock <= (p.reorderPoint || 20),
    ).length;
    const criticalStock = products.filter(
      (p) => p.currentStock > 0 && p.currentStock <= (p.minimumStock || 10),
    ).length;

    const recentTransactions = await Stock.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
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
