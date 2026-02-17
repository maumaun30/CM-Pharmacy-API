"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("branch_stocks", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
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
      branchId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "branches",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      currentStock: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      minimumStock: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 10,
      },
      maximumStock: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      reorderPoint: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 20,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    // Add unique constraint on productId + branchId
    await queryInterface.addIndex("branch_stocks", ["productId", "branchId"], {
      unique: true,
      name: "unique_product_branch",
    });

    // Add indexes for queries
    await queryInterface.addIndex("branch_stocks", ["branchId"]);
    await queryInterface.addIndex("branch_stocks", ["productId"]);
    await queryInterface.addIndex("branch_stocks", ["currentStock"]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("branch_stocks");
  },
};