"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Branch extends Model {
    static associate(models) {
      Branch.hasMany(models.User, {
        foreignKey: "branchId",
        as: "users",
      });

      Branch.hasMany(models.Sale, {
        foreignKey: "branchId",
        as: "sales",
      });

      Branch.hasMany(models.Stock, {
        foreignKey: "branchId",
        as: "stockTransactions",
      });
    }

    // Get full address
    getFullAddress() {
      const parts = [
        this.address,
        this.city,
        this.province,
        this.postalCode,
      ].filter(Boolean);
      return parts.join(", ");
    }

    // Format operating hours
    getOperatingHoursDisplay() {
      if (!this.operatingHours) return "Not set";
      
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const formatted = days.map(day => {
        const hours = this.operatingHours[day.toLowerCase()];
        if (!hours || !hours.open) return `${day}: Closed`;
        return `${day}: ${hours.open} - ${hours.close}`;
      });
      
      return formatted.join("\n");
    }
  }

  Branch.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      province: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      managerName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      isMainBranch: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      operatingHours: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {
          monday: { open: "09:00", close: "18:00" },
          tuesday: { open: "09:00", close: "18:00" },
          wednesday: { open: "09:00", close: "18:00" },
          thursday: { open: "09:00", close: "18:00" },
          friday: { open: "09:00", close: "18:00" },
          saturday: { open: "09:00", close: "17:00" },
          sunday: { open: null, close: null },
        },
      },
    },
    {
      sequelize,
      modelName: "Branch",
      tableName: "branches",
      timestamps: true,
    }
  );

  return Branch;
};