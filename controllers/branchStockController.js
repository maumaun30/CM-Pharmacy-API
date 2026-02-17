const { BranchStock, Product, Branch, Stock, sequelize } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");

// Get all branch stocks with filters
exports.getAllBranchStocks = async (req, res) => {
  try {
    const { branchId, productId, status } = req.query;

    const whereClause = {};

    if (branchId) {
      whereClause.branchId = branchId;
    }

    if (productId) {
      whereClause.productId = productId;
    }

    // Filter by stock status
    if (status) {
      switch (status) {
        case "OUT_OF_STOCK":
          whereClause.currentStock = 0;
          break;
        case "CRITICAL":
          whereClause[Op.and] = [
            { currentStock: { [Op.gt]: 0 } },
            sequelize.literal(
              '"BranchStock"."currentStock" <= "BranchStock"."minimumStock"',
            ),
          ];
          break;
        case "LOW":
          whereClause[Op.and] = [
            { currentStock: { [Op.gt]: 0 } },
            sequelize.literal(
              '"BranchStock"."currentStock" > "BranchStock"."minimumStock" AND "BranchStock"."currentStock" <= "BranchStock"."reorderPoint"',
            ),
          ];
          break;
        case "IN_STOCK":
          whereClause[Op.and] = [
            sequelize.literal(
              '"BranchStock"."currentStock" > "BranchStock"."reorderPoint"',
            ),
          ];
          break;
      }
    }

    const branchStocks = await BranchStock.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          attributes: [
            "id",
            "name",
            "sku",
            "brandName",
            "genericName",
            "price",
            "cost",
            "status",
          ],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code", "address"],
        },
      ],
      order: [
        ["branchId", "ASC"],
        ["currentStock", "ASC"],
      ],
    });

    return res.status(200).json(branchStocks);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get stock for specific product across all branches
exports.getProductStockAllBranches = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const branchStocks = await BranchStock.findAll({
      where: { productId },
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code", "address"],
        },
      ],
      order: [["branchId", "ASC"]],
    });

    const totalStock = branchStocks.reduce(
      (sum, bs) => sum + (bs.currentStock || 0),
      0,
    );

    return res.status(200).json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        brandName: product.brandName,
      },
      totalStock,
      branchStocks,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get stock for specific branch
exports.getBranchStock = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { status, search } = req.query;

    const branch = await Branch.findByPk(branchId);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const whereClause = { branchId };

    // Filter by stock status
    if (status) {
      switch (status) {
        case "OUT_OF_STOCK":
          whereClause.currentStock = 0;
          break;
        case "CRITICAL":
          whereClause[Op.and] = [
            { currentStock: { [Op.gt]: 0 } },
            sequelize.literal(
              '"BranchStock"."currentStock" <= "BranchStock"."minimumStock"',
            ),
          ];
          break;
        case "LOW":
          whereClause[Op.and] = [
            { currentStock: { [Op.gt]: 0 } },
            sequelize.literal(
              '"BranchStock"."currentStock" > "BranchStock"."minimumStock" AND "BranchStock"."currentStock" <= "BranchStock"."reorderPoint"',
            ),
          ];
          break;
        case "IN_STOCK":
          whereClause[Op.and] = [
            sequelize.literal(
              '"BranchStock"."currentStock" > "BranchStock"."reorderPoint"',
            ),
          ];
          break;
      }
    }

    const productInclude = {
      model: Product,
      as: "product",
      attributes: [
        "id",
        "name",
        "sku",
        "brandName",
        "genericName",
        "price",
        "cost",
        "status",
      ],
    };

    // Add search filter if provided
    if (search) {
      productInclude.where = {
        [Op.or]: [
          { name: { [Op.iLike]: `%${search}%` } },
          { sku: { [Op.iLike]: `%${search}%` } },
          { brandName: { [Op.iLike]: `%${search}%` } },
          { genericName: { [Op.iLike]: `%${search}%` } },
        ],
      };
    }

    const branchStocks = await BranchStock.findAll({
      where: whereClause,
      include: [productInclude],
      order: [["currentStock", "ASC"]],
    });

    const summary = {
      totalProducts: branchStocks.length,
      outOfStock: branchStocks.filter((bs) => bs.currentStock === 0).length,
      critical: branchStocks.filter(
        (bs) => bs.currentStock > 0 && bs.currentStock <= bs.minimumStock,
      ).length,
      lowStock: branchStocks.filter(
        (bs) =>
          bs.currentStock > bs.minimumStock &&
          bs.currentStock <= bs.reorderPoint,
      ).length,
      inStock: branchStocks.filter((bs) => bs.currentStock > bs.reorderPoint)
        .length,
    };

    return res.status(200).json({
      branch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
      },
      summary,
      stocks: branchStocks,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Transfer stock between branches
exports.transferStock = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { productId, fromBranchId, toBranchId, quantity, reason } = req.body;
    const performedBy = req.user.id;

    // Validation
    if (!productId || !fromBranchId || !toBranchId || !quantity) {
      await t.rollback();
      return res.status(400).json({
        message:
          "Product, source branch, destination branch, and quantity are required",
      });
    }

    if (quantity <= 0) {
      await t.rollback();
      return res.status(400).json({
        message: "Quantity must be positive",
      });
    }

    if (fromBranchId === toBranchId) {
      await t.rollback();
      return res.status(400).json({
        message: "Cannot transfer to the same branch",
      });
    }

    // Check if product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      await t.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if branches exist
    const fromBranch = await Branch.findByPk(fromBranchId);
    const toBranch = await Branch.findByPk(toBranchId);

    if (!fromBranch || !toBranch) {
      await t.rollback();
      return res.status(404).json({ message: "Branch not found" });
    }

    // Perform the transfer
    const transferResult = await Stock.transferBetweenBranches({
      productId,
      fromBranchId,
      toBranchId,
      quantity,
      performedBy,
      reason,
      transaction: t,
    });

    await createLog(
      req,
      "TRANSFER",
      "stock",
      null,
      `Transferred ${quantity} units of ${product.name} from ${fromBranch.name} to ${toBranch.name}`,
      {
        productId,
        fromBranchId,
        toBranchId,
        quantity,
        reason,
      },
      t,
    );

    await t.commit();

    // Fetch updated branch stocks
    const updatedFromStock = await BranchStock.findOne({
      where: { productId, branchId: fromBranchId },
      include: [{ model: Branch, as: "branch" }],
    });

    const updatedToStock = await BranchStock.findOne({
      where: { productId, branchId: toBranchId },
      include: [{ model: Branch, as: "branch" }],
    });

    return res.status(200).json({
      message: "Stock transferred successfully",
      transfer: {
        product: { id: product.id, name: product.name, sku: product.sku },
        from: updatedFromStock,
        to: updatedToStock,
        quantity,
      },
    });
  } catch (error) {
    await t.rollback();
    return res
      .status(500)
      .json({ message: "Error transferring stock", error: error.message });
  }
};

// Initialize stock for a product in a branch
exports.initializeBranchStock = async (req, res) => {
  try {
    const {
      productId,
      branchId,
      currentStock,
      minimumStock,
      maximumStock,
      reorderPoint,
    } = req.body;

    // Validation
    if (!productId || !branchId) {
      return res.status(400).json({
        message: "Product ID and Branch ID are required",
      });
    }

    // Check if product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if branch exists
    const branch = await Branch.findByPk(branchId);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // Check if branch stock already exists
    const existingBranchStock = await BranchStock.findOne({
      where: { productId, branchId },
    });

    if (existingBranchStock) {
      return res.status(400).json({
        message: "Branch stock already initialized for this product",
      });
    }

    // Create branch stock
    const branchStock = await BranchStock.create({
      productId,
      branchId,
      currentStock: currentStock || 0,
      minimumStock: minimumStock || 10,
      maximumStock: maximumStock || null,
      reorderPoint: reorderPoint || 20,
    });

    const createdStock = await BranchStock.findByPk(branchStock.id, {
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "brandName"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    await createLog(
      req,
      "CREATE",
      "branch_stocks",
      branchStock.id,
      `Initialized stock for ${product.name} at ${branch.name}`,
      { branchStock: branchStock.toJSON() },
    );

    return res.status(201).json(createdStock);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update branch stock settings (not quantity, just thresholds)
exports.updateBranchStockSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { minimumStock, maximumStock, reorderPoint } = req.body;

    const branchStock = await BranchStock.findByPk(id);
    if (!branchStock) {
      return res.status(404).json({ message: "Branch stock not found" });
    }

    await branchStock.update({
      minimumStock:
        minimumStock !== undefined ? minimumStock : branchStock.minimumStock,
      maximumStock:
        maximumStock !== undefined ? maximumStock : branchStock.maximumStock,
      reorderPoint:
        reorderPoint !== undefined ? reorderPoint : branchStock.reorderPoint,
    });

    const updated = await BranchStock.findByPk(id, {
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

    return res.status(200).json(updated);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get stock alerts (low stock, out of stock) across branches
exports.getStockAlerts = async (req, res) => {
  try {
    const { branchId } = req.query;

    const whereClause = {
      [Op.or]: [
        { currentStock: 0 },
        sequelize.literal(
          '"BranchStock"."currentStock" <= "BranchStock"."reorderPoint"',
        ),
      ],
    };

    if (branchId) {
      whereClause.branchId = branchId;
    }

    const alerts = await BranchStock.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "brandName", "status"],
          where: { status: "ACTIVE" }, // Only active products
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
    });

    const grouped = {
      outOfStock: alerts.filter((a) => a.currentStock === 0),
      critical: alerts.filter(
        (a) => a.currentStock > 0 && a.currentStock <= a.minimumStock,
      ),
      lowStock: alerts.filter(
        (a) =>
          a.currentStock > a.minimumStock && a.currentStock <= a.reorderPoint,
      ),
    };

    return res.status(200).json({
      total: alerts.length,
      outOfStockCount: grouped.outOfStock.length,
      criticalCount: grouped.critical.length,
      lowStockCount: grouped.lowStock.length,
      alerts: grouped,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
