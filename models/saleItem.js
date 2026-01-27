"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class SaleItem extends Model {
    static associate(models) {
      SaleItem.belongsTo(models.Sale, { foreignKey: "saleId" });
      SaleItem.belongsTo(models.Product, { foreignKey: "productId" });
    }
  }
  SaleItem.init(
    {
      saleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "sales", key: "id" },
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "products", key: "id" },
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2), // price at time of sale
        allowNull: false,
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
