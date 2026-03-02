"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Refund extends Model {
    static associate(models) {
      Refund.belongsTo(models.Sale, {
        foreignKey: "saleId",
        as: "sale",
      });

      Refund.belongsTo(models.User, {
        foreignKey: "refundedBy",
        as: "refunder",
      });

      Refund.belongsTo(models.Branch, {
        foreignKey: "branchId",
        as: "branch",
      });

      Refund.hasMany(models.RefundItem, {
        foreignKey: "refundId",
        as: "items",
      });
    }
  }

  Refund.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      saleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Sales", key: "id" },
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Branches", key: "id" },
      },
      refundedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      totalRefund: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Refund",
      tableName: "Refunds",
      timestamps: true,
      updatedAt: false, // Refunds are immutable once created
    },
  );

  return Refund;
};