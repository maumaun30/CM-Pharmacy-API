"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create junction table for category-discount relationships
    await queryInterface.createTable("CategoryDiscounts", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      categoryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "categories",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      discountId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "discounts",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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

    // Add composite unique index to prevent duplicate category-discount pairs
    await queryInterface.addIndex("CategoryDiscounts", ["categoryId", "discountId"], {
      unique: true,
      name: "category_discount_unique",
    });
    
    // Add indexes for foreign keys in junction table
    await queryInterface.addIndex("CategoryDiscounts", ["categoryId"]);
    await queryInterface.addIndex("CategoryDiscounts", ["discountId"]);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop the junction table
    await queryInterface.dropTable("CategoryDiscounts");
  },
};