"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("stocks", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      branchId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "branches",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        comment: "Branch for this stock transaction",
      },
      productId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "products",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      transactionType: {
        type: Sequelize.ENUM(
          "INITIAL_STOCK",
          "PURCHASE",
          "SALE",
          "RETURN",
          "ADJUSTMENT",
          "DAMAGE",
          "EXPIRED",
        ),
        allowNull: false,
        comment: "Type of stock transaction",
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment:
          "Quantity change (positive for addition, negative for reduction)",
      },
      quantityBefore: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: "Stock quantity before this transaction",
      },
      quantityAfter: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: "Stock quantity after this transaction",
      },
      unitCost: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Cost per unit for this transaction",
      },
      totalCost: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Total cost for this transaction",
      },
      batchNumber: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Batch/lot number",
      },
      expiryDate: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Expiry date for this batch",
      },
      supplier: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Supplier name for purchases",
      },
      referenceId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment:
          "Reference to related record (e.g., sale_id, purchase_order_id)",
      },
      referenceType: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Type of reference (e.g., 'sale', 'purchase_order')",
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Reason for adjustment, damage, or other transactions",
      },
      performedBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Add indexes
    await queryInterface.addIndex("stocks", ["branchId"]);
    await queryInterface.addIndex("stocks", ["productId"]);
    await queryInterface.addIndex("stocks", ["transactionType"]);
    await queryInterface.addIndex("stocks", ["createdAt"]);
    await queryInterface.addIndex("stocks", ["performedBy"]);
    await queryInterface.addIndex("stocks", ["batchNumber"]);
    await queryInterface.addIndex("stocks", ["referenceType", "referenceId"]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("stocks");
  },
};
