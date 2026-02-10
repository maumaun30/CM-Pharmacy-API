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
    }

    // Helper method to create stock transaction
    static async createTransaction({
      productId,
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

      const product = await Product.findByPk(productId, { transaction });

      if (!product) {
        throw new Error("Product not found");
      }

      const quantityBefore = product.currentStock || 0;
      const quantityAfter = quantityBefore + quantity;

      if (quantityAfter < 0) {
        throw new Error("Insufficient stock");
      }

      // Calculate total cost
      const totalCost = unitCost ? unitCost * Math.abs(quantity) : null;

      // Create stock record
      const stockRecord = await this.create(
        {
          productId,
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
        { transaction }
      );

      // Update product current stock
      await product.update(
        { currentStock: quantityAfter },
        { transaction }
      );

      return stockRecord;
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
      transactionType: {
        type: DataTypes.ENUM(
          "INITIAL_STOCK",
          "PURCHASE",
          "SALE",
          "RETURN",
          "ADJUSTMENT",
          "DAMAGE",
          "EXPIRED"
        ),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
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
      },
      referenceType: {
        type: DataTypes.STRING,
        allowNull: true,
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
    }
  );

  return Stock;
};