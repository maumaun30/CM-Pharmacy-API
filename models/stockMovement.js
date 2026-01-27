"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StockMovement extends Model {
    static associate(models) {
      StockMovement.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
      StockMovement.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  StockMovement.init(
    {
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("IN", "OUT", "ADJUST"),
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "StockMovement",
      tableName: "stock_movements",
    }
  );

  return StockMovement;
};
