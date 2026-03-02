"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Create Refunds table ───────────────────────────────────────────────
    await queryInterface.createTable("refunds", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      saleId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "sales", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      branchId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      refundedBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      totalRefund: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      reason: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // ── Create RefundItems table ───────────────────────────────────────────
    await queryInterface.createTable("refund_items", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      refundId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "refunds", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      saleItemId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "sale_items", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      productId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      refundAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        comment: "Unit price used for this refund × quantity",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("refund_items");
    await queryInterface.dropTable("refunds");
  },
};
