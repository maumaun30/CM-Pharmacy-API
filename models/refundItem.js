"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class RefundItem extends Model {
    static associate(models) {
      RefundItem.belongsTo(models.Refund, {
        foreignKey: "refundId",
        as: "refund",
      });

      RefundItem.belongsTo(models.SaleItem, {
        foreignKey: "saleItemId",
        as: "saleItem",
      });

      RefundItem.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
    }
  }

  RefundItem.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      refundId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Refunds", key: "id" },
      },
      saleItemId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "SaleItems", key: "id" },
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Products", key: "id" },
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      refundAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Unit price used for this refund × quantity",
      },
    },
    {
      sequelize,
      modelName: "RefundItem",
      tableName: "RefundItems",
      timestamps: true,
      updatedAt: false,
    },
  );

  return RefundItem;
};