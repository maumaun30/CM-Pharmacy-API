"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("products", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      sku: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      cost: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
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
        comment: "Minimum stock level for reorder alerts",
      },
      maximumStock: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "Maximum stock level",
      },
      reorderPoint: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 20,
        comment: "Stock level at which to reorder",
      },
      expiryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      brandName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      genericName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      dosage: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      form: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      requiresPrescription: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      categoryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "categories",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      status: {
        type: Sequelize.ENUM("ACTIVE", "INACTIVE"),
        allowNull: false,
        defaultValue: "ACTIVE",
        after: "requiresPrescription",
      },
    });

    await queryInterface.addIndex("products", ["currentStock"]);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("products");
  },
};
