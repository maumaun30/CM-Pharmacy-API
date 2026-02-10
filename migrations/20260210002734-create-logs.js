"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("logs", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "User who performed the action",
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Action type (e.g., CREATE, UPDATE, DELETE, LOGIN, SALE)",
      },
      module: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Module/table affected (e.g., products, sales, users)",
      },
      recordId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "ID of the affected record",
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Human-readable description of the action",
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "Additional data (before/after values, etc.)",
      },
      ipAddress: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "IP address of the user",
      },
      userAgent: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Browser/client information",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Add indexes for better query performance
    await queryInterface.addIndex("logs", ["userId"]);
    await queryInterface.addIndex("logs", ["action"]);
    await queryInterface.addIndex("logs", ["module"]);
    await queryInterface.addIndex("logs", ["createdAt"]);
    await queryInterface.addIndex("logs", ["module", "recordId"]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("logs");
  },
};