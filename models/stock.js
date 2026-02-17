"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Stock extends Model {
    static associate(models) {
      Stock.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });

      Stock.belongsTo(models.User, {
        foreignKey: "performedBy",
        as: "user",
      });

      Stock.belongsTo(models.Branch, {
        foreignKey: "branchId",
        as: "branch",
      });
    }

    // Helper method to create stock transaction with branch support
    static async createTransaction({
      productId,
      branchId,
      transactionType,
      quantity,
      unitCost = null,
      batchNumber = null,
      expiryDate = null,
      supplier = null,
      referenceId = null,
      referenceType = null,
      reason = null,
      performedBy,
      transaction = null,
    }) {
      const Product = sequelize.models.Product;
      const BranchStock = sequelize.models.BranchStock;

      if (!branchId) {
        throw new Error("Branch ID is required");
      }

      // Get or create branch stock record
      let branchStock = await BranchStock.findOne({
        where: { productId, branchId },
        transaction,
      });

      if (!branchStock) {
        // Create branch stock record if it doesn't exist
        branchStock = await BranchStock.create(
          {
            productId,
            branchId,
            currentStock: 0,
            minimumStock: 10,
            reorderPoint: 20,
          },
          { transaction },
        );
      }

      const quantityBefore = branchStock.currentStock || 0;
      const quantityAfter = quantityBefore + quantity;

      if (quantityAfter < 0) {
        throw new Error(
          `Insufficient stock. Available: ${quantityBefore}, Requested: ${Math.abs(quantity)}`,
        );
      }

      // Calculate total cost
      const totalCost = unitCost ? unitCost * Math.abs(quantity) : null;

      // Create stock record
      const stockRecord = await this.create(
        {
          productId,
          branchId,
          transactionType,
          quantity,
          quantityBefore,
          quantityAfter,
          unitCost,
          totalCost,
          batchNumber,
          expiryDate,
          supplier,
          referenceId,
          referenceType,
          reason,
          performedBy,
        },
        { transaction },
      );

      // Update branch stock
      await branchStock.update({ currentStock: quantityAfter }, { transaction });

      return stockRecord;
    }

    // Helper method to transfer stock between branches
    static async transferBetweenBranches({
      productId,
      fromBranchId,
      toBranchId,
      quantity,
      performedBy,
      reason = null,
      transaction = null,
    }) {
      if (quantity <= 0) {
        throw new Error("Transfer quantity must be positive");
      }

      // Deduct from source branch
      const deductRecord = await this.createTransaction({
        productId,
        branchId: fromBranchId,
        transactionType: "ADJUSTMENT",
        quantity: -quantity,
        reason: reason || `Transfer to branch ${toBranchId}`,
        performedBy,
        transaction,
      });

      // Add to destination branch
      const addRecord = await this.createTransaction({
        productId,
        branchId: toBranchId,
        transactionType: "ADJUSTMENT",
        quantity: quantity,
        reason: reason || `Transfer from branch ${fromBranchId}`,
        performedBy,
        transaction,
      });

      return { deductRecord, addRecord };
    }
  }

  Stock.init(
    {
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "products",
          key: "id",
        },
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "branches",
          key: "id",
        },
      },
      transactionType: {
        type: DataTypes.ENUM(
          "INITIAL_STOCK",
          "PURCHASE",
          "SALE",
          "RETURN",
          "ADJUSTMENT",
          "DAMAGE",
          "EXPIRED",
          "TRANSFER_IN",
          "TRANSFER_OUT",
        ),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "Positive for additions, negative for deductions",
      },
      quantityBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      quantityAfter: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      unitCost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      totalCost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      batchNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expiryDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      supplier: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      referenceId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Reference to related transaction (e.g., sale ID, purchase order ID)",
      },
      referenceType: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Type of reference (e.g., SALE, PURCHASE_ORDER)",
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      performedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Stock",
      tableName: "stocks",
      timestamps: true,
      updatedAt: false,
    },
  );

  return Stock;
};