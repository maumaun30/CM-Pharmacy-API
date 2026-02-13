"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("sales", {
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
        comment: "Branch where sale was made",
      },
      subtotal: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Total before discounts",
      },
      totalDiscount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        comment: "Total discount amount",
      },
      totalAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        comment: "Final amount after discounts",
      },
      cashAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Cash received from customer",
      },
      changeAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Change given to customer",
      },
      soldBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      soldAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
    
    await queryInterface.addIndex("sales", ["branchId"]);

    // Add index for soldBy foreign key
    await queryInterface.addIndex("sales", ["soldBy"]);

    // Add index for soldAt for faster date queries
    await queryInterface.addIndex("sales", ["soldAt"]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("sales");
  },
};
