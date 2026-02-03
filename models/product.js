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
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
    },
    {
      sequelize,
      modelName: "Product",
      tableName: "products",
      timestamps: true,
    }
  );

  return Product;
};