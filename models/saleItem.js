"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SaleItem extends Model {
    static associate(models) {
      SaleItem.belongsTo(models.Sale, {
        foreignKey: "saleId",
        as: "Sale", // Optional: add alias
      });
      
      SaleItem.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "Product", // Make sure this matches the include
      });
      
      SaleItem.belongsTo(models.Discount, {
        foreignKey: "discountId",
        as: "Discount", // Make sure this matches the include
        required: false,
      });
    }
  }

  SaleItem.init(
    {
      saleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "sales",
          key: "id",
        },
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "products",
          key: "id",
        },
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Original price at time of sale",
      },
      discountedPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Price after discount applied",
      },
      discountId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "discounts",
          key: "id",
        },
        comment: "Discount applied to this item",
      },
      discountAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        comment: "Total discount amount for this line item",
      },
    },
    {
      sequelize,
      modelName: "SaleItem",
      tableName: "sale_items",
      timestamps: false,
    }
  );

  return SaleItem;
};