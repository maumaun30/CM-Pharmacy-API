"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Discount extends Model {
    static associate(models) {
      // Association with products (many-to-many)
      Discount.belongsToMany(models.Product, {
        through: 'ProductDiscounts',
        foreignKey: 'discountId',
        otherKey: 'productId',
        as: 'products'
      });
    }

    // Helper method to check if discount is currently active
    isActive() {
      const now = new Date();
      
      // Check if disabled
      if (!this.isEnabled) return false;
      
      // If indefinite (no end date), just check start date
      if (!this.endDate) {
        return !this.startDate || now >= this.startDate;
      }
      
      // Check date range
      const afterStart = !this.startDate || now >= this.startDate;
      const beforeEnd = now <= this.endDate;
      
      return afterStart && beforeEnd;
    }

    // Calculate discount amount
    calculateDiscount(originalPrice) {
      if (this.discountType === 'PERCENTAGE') {
        return (originalPrice * this.discountValue) / 100;
      } else {
        return Math.min(this.discountValue, originalPrice);
      }
    }
  }

  Discount.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'e.g., "PWD Discount", "Senior Citizen Discount"'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      discountType: {
        type: DataTypes.ENUM('PERCENTAGE', 'FIXED_AMOUNT'),
        allowNull: false,
        defaultValue: 'PERCENTAGE',
        comment: 'Type of discount calculation'
      },
      discountValue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0,
          max: function(value) {
            // If percentage, max is 100
            if (this.discountType === 'PERCENTAGE') {
              return value <= 100;
            }
            return true;
          }
        },
        comment: 'Percentage (0-100) or fixed amount'
      },
      discountCategory: {
        type: DataTypes.ENUM('PWD', 'SENIOR_CITIZEN', 'PROMOTIONAL', 'SEASONAL', 'OTHER'),
        allowNull: false,
        defaultValue: 'OTHER',
        comment: 'Category for organizing discounts'
      },
      startDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When discount becomes active (null = immediate)'
      },
      endDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When discount expires (null = indefinite)'
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Manual enable/disable toggle'
      },
      requiresVerification: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Whether ID verification is required (e.g., for PWD/Senior)'
      },
      applicableTo: {
        type: DataTypes.ENUM('ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'CATEGORIES'),
        allowNull: false,
        defaultValue: 'ALL_PRODUCTS',
        comment: 'Scope of discount application'
      },
      minimumPurchaseAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Minimum purchase required for discount (optional)'
      },
      maximumDiscountAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Cap on discount amount (optional)'
      },
      priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Priority when multiple discounts apply (higher = first)'
      },
      stackable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Can be combined with other discounts'
      }
    },
    {
      sequelize,
      modelName: "Discount",
      tableName: "discounts",
      timestamps: true,
      indexes: [
        {
          fields: ['discountCategory']
        },
        {
          fields: ['isEnabled']
        },
        {
          fields: ['startDate', 'endDate']
        }
      ],
      validate: {
        dateRangeValid() {
          if (this.startDate && this.endDate && this.startDate > this.endDate) {
            throw new Error('Start date must be before end date');
          }
        }
      }
    },
  );

  return Discount;
};