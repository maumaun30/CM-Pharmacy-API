"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("sale_items", {
      id: { 
        type: Sequelize.INTEGER, 
        autoIncrement: true, 
        primaryKey: true 
      },
      saleId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { 
          model: "sales", 
          key: "id" 
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      productId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { 
          model: "products", 
          key: "id" 
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      quantity: { 
        type: Sequelize.INTEGER, 
        allowNull: false 
      },
      price: { 
        type: Sequelize.DECIMAL(10, 2), 
        allowNull: false,
        comment: "Original price at time of sale",
      },
      discountedPrice: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: "Price after discount applied",
      },
      discountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "discounts",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Discount applied to this item",
      },
      discountAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        comment: "Total discount amount for this line item",
      },
    });

    // Add indexes for foreign keys
    await queryInterface.addIndex("sale_items", ["saleId"]);
    await queryInterface.addIndex("sale_items", ["productId"]);
    await queryInterface.addIndex("sale_items", ["discountId"]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("sale_items");
  },
};