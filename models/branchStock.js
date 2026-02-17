"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class BranchStock extends Model {
    static associate(models) {
      BranchStock.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });

      BranchStock.belongsTo(models.Branch, {
        foreignKey: "branchId",
        as: "branch",
      });
    }

    // Helper method to get stock status
    getStockStatus() {
      const current = this.currentStock || 0;
      const reorder = this.reorderPoint || 20;
      const minimum = this.minimumStock || 10;

      if (current === 0) return "OUT_OF_STOCK";
      if (current <= minimum) return "CRITICAL";
      if (current <= reorder) return "LOW";
      return "IN_STOCK";
    }

    // Helper method to check if stock is low
    isLowStock() {
      const current = this.currentStock || 0;
      const reorder = this.reorderPoint || 20;
      return current > 0 && current <= reorder;
    }

    // Helper method to check if out of stock
    isOutOfStock() {
      return (this.currentStock || 0) === 0;
    }
  }

  BranchStock.init(
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
      currentStock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Current stock quantity for this branch",
      },
      minimumStock: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 10,
        comment: "Minimum stock level for alerts",
      },
      maximumStock: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Maximum stock level",
      },
      reorderPoint: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 20,
        comment: "Reorder point for this branch",
      },
      // Virtual field for stock status
      stockStatus: {
        type: DataTypes.VIRTUAL,
        get() {
          const current = this.getDataValue("currentStock") || 0;
          const reorder = this.getDataValue("reorderPoint") || 20;
          const minimum = this.getDataValue("minimumStock") || 10;

          if (current === 0) return "OUT_OF_STOCK";
          if (current <= minimum) return "CRITICAL";
          if (current <= reorder) return "LOW";
          return "IN_STOCK";
        },
      },
    },
    {
      sequelize,
      modelName: "BranchStock",
      tableName: "branch_stocks",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["productId", "branchId"],
        },
      ],
    },
  );

  return BranchStock;
};