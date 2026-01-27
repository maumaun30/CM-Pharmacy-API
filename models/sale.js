"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Sale extends Model {
    static associate(models) {
      Sale.hasMany(models.SaleItem, { foreignKey: "saleId", as: "items" });
    }
  }
  Sale.init(
    {
      totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      soldBy: {
        type: DataTypes.INTEGER, // user id who sold it
        allowNull: false,
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
    }
  );
  return Sale;
};
