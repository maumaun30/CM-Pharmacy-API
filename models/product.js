"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      Product.belongsTo(models.Category, {
        foreignKey: "categoryId",
        as: "category",
      });

      Product.hasMany(models.StockMovement, {
        foreignKey: "productId",
        as: "stockMovements",
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
      categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "categories",
          key: "id",
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
