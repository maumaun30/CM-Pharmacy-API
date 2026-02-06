"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Sale extends Model {
    static associate(models) {
      Sale.hasMany(models.SaleItem, {
        foreignKey: "saleId",
        as: "items",
      });
      Sale.belongsTo(models.User, {
        foreignKey: "soldBy",
        as: "seller",
      });
    }
  }

  Sale.init(
    {
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Total before discounts",
      },
      totalDiscount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        comment: "Total discount amount",
      },
      totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Final amount after discounts",
      },
      cashAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Cash received from customer",
      },
      changeAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Change given to customer",
      },
      soldBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      soldAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "Sale",
      tableName: "sales",
      timestamps: true,
      createdAt: "soldAt",
      updatedAt: true,
    }
  );

  return Sale;
};