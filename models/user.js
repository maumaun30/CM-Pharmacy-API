"use strict";
const { Model } = require("sequelize");
const bcrypt = require("bcryptjs");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Branch, {
        foreignKey: "branchId",
        as: "branch",
      });

      User.belongsTo(models.Branch, {
        foreignKey: "currentBranchId",
        as: "currentBranch",
      });
    }

    // Method to check password
    async validatePassword(password) {
      return await bcrypt.compare(password, this.password);
    }

    // Add method alongside validatePassword:
    async validatePin(pin) {
      if (!this.pin) return false;
      return await bcrypt.compare(pin, this.pin);
    }

    getActiveBranch() {
      return this.currentBranchId || this.branchId;
    }
  }

  User.init(
    {
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          len: [3, 30],
        },
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          len: [6, 100],
        },
      },
      pin: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM("admin", "cashier", "manager"),
        allowNull: false,
        defaultValue: "cashier",
      },
      firstName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      lastName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fullName: {
        type: DataTypes.VIRTUAL,
        get() {
          return `${this.firstName} ${this.lastName}`;
        },
      },
      contactNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "branches",
          key: "id",
        },
        comment: "User's home branch",
      },
      currentBranchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "branches",
          key: "id",
        },
        comment: "Current active branch (for session)",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "User",
      getterMethods: {
        fullName() {
          if (this.firstName && this.lastName) {
            return `${this.firstName} ${this.lastName}`.trim();
          }
          return this.username;
        },
      },
      tableName: "users",
      timestamps: true,
      hooks: {
        beforeCreate: async (user) => {
          if (user.password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(user.password, salt);
          }
          if (user.pin) {
            const salt = await bcrypt.genSalt(10);
            user.pin = await bcrypt.hash(user.pin, salt);
          }
        },
        beforeUpdate: async (user) => {
          if (user.changed("password")) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(user.password, salt);
          }
          if (user.changed("pin")) {
            const salt = await bcrypt.genSalt(10);
            user.pin = await bcrypt.hash(user.pin, salt);
          }
        },
      },
    },
  );

  return User;
};
