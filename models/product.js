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

      // New association with BranchStock
      Product.hasMany(models.BranchStock, {
        foreignKey: "productId",
        as: "branchStocks",
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

    // Helper method to get total stock across all branches
    async getTotalStock() {
      const BranchStock = sequelize.models.BranchStock;
      const result = await BranchStock.sum("currentStock", {
        where: { productId: this.id },
      });
      return result || 0;
    }

    // Helper method to get stock for a specific branch
    async getBranchStock(branchId) {
      const BranchStock = sequelize.models.BranchStock;
      return await BranchStock.findOne({
        where: { productId: this.id, branchId },
      });
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
      barcode: {
        type: DataTypes.STRING,
        allowNull: true,
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
      // Virtual field for total stock across all branches
      totalStock: {
        type: DataTypes.VIRTUAL,
        get() {
          // This will be populated when we include branchStocks
          const branchStocks = this.getDataValue("branchStocks");
          if (!branchStocks || branchStocks.length === 0) return 0;
          return branchStocks.reduce(
            (sum, bs) => sum + (bs.currentStock || 0),
            0,
          );
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