"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Log extends Model {
    static associate(models) {
      Log.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }

    // Helper method to create log entries
    static async createLog({
      userId,
      action,
      module,
      recordId = null,
      description = null,
      metadata = null,
      ipAddress = null,
      userAgent = null,
    }) {
      try {
        await this.create({
          userId,
          action,
          module,
          recordId,
          description,
          metadata,
          ipAddress,
          userAgent,
        });
      } catch (error) {
        console.error("Error creating log:", error);
        // Don't throw error - logging should not break the main operation
      }
    }
  }

  Log.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      module: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      recordId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Log",
      tableName: "logs",
      timestamps: true,
      updatedAt: false, // Only need createdAt for logs
    }
  );

  return Log;
};