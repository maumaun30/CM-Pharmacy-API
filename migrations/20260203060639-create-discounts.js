"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create discounts table
    await queryInterface.createTable("discounts", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      discountType: {
        type: Sequelize.ENUM("PERCENTAGE", "FIXED_AMOUNT"),
        allowNull: false,
        defaultValue: "PERCENTAGE",
      },
      discountValue: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      discountCategory: {
        type: Sequelize.ENUM(
          "PWD",
          "SENIOR_CITIZEN",
          "PROMOTIONAL",
          "SEASONAL",
          "OTHER"
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },
      startDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      endDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      isEnabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      requiresVerification: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      applicableTo: {
        type: Sequelize.ENUM(
          "ALL_PRODUCTS",
          "SPECIFIC_PRODUCTS",
          "CATEGORIES"
        ),
        allowNull: false,
        defaultValue: "ALL_PRODUCTS",
      },
      minimumPurchaseAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      maximumDiscountAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      stackable: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    // Create junction table for product-discount relationships
    await queryInterface.createTable("ProductDiscounts", {
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

    // Add indexes for better query performance
    await queryInterface.addIndex("discounts", ["discountCategory"]);
    await queryInterface.addIndex("discounts", ["isEnabled"]);
    await queryInterface.addIndex("discounts", ["startDate", "endDate"]);
    await queryInterface.addIndex("discounts", ["priority"]);
    
    // Add composite unique index to prevent duplicate product-discount pairs
    await queryInterface.addIndex("ProductDiscounts", ["productId", "discountId"], {
      unique: true,
      name: "product_discount_unique",
    });
    
    // Add indexes for foreign keys in junction table
    await queryInterface.addIndex("ProductDiscounts", ["productId"]);
    await queryInterface.addIndex("ProductDiscounts", ["discountId"]);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop junction table first (due to foreign key constraints)
    await queryInterface.dropTable("ProductDiscounts");
    
    // Drop discounts table
    await queryInterface.dropTable("discounts");
  },
};