"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      Product.belongsTo(models.Category, {
        foreignKey: "categoryId",
        as: "category",
      });

      Product.belongsToMany(models.Discount, {
        through: "ProductDiscounts",
        foreignKey: "productId",
        otherKey: "discountId",
        as: "discounts",
      });

      Product.hasMany(models.Stock, {
        foreignKey: "productId",
        as: "stockHistory",
      });
    }

    // Helper method to calculate margin percentage
    getMarginPercentage() {
      if (this.cost === 0) return 0;
      return ((this.price - this.cost) / this.cost) * 100;
    }

    // Helper method to get margin amount
    getMarginAmount() {
      return this.price - this.cost;
    }
  }

  Product.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      sku: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      expiryDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      brandName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      genericName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      dosage: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      form: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      requiresPrescription: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "categories",
          key: "id",
        },
      },
      // Virtual field for margin percentage
      marginPercentage: {
        type: DataTypes.VIRTUAL,
        get() {
          const cost = parseFloat(this.getDataValue("cost")) || 0;
          const price = parseFloat(this.getDataValue("price")) || 0;
          if (cost === 0) return 0;
          return ((price - cost) / cost) * 100;
        },
      },
      // Virtual field for margin amount
      marginAmount: {
        type: DataTypes.VIRTUAL,
        get() {
          const cost = parseFloat(this.getDataValue("cost")) || 0;
          const price = parseFloat(this.getDataValue("price")) || 0;
          return price - cost;
        },
      },
      currentStock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Current stock quantity",
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
        comment: "Reorder point",
      },

      // Add virtual field for stock status
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
      modelName: "Product",
      tableName: "products",
      timestamps: true,
    },
  );

  return Product;
};
