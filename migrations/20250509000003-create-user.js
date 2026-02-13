"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("users", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      username: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      password: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      role: {
        type: Sequelize.ENUM("admin", "cashier", "manager"),
        allowNull: false,
        defaultValue: "cashier",
      },
      firstName: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      lastName: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      contactNumber: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      branchId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "branches",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Branch where user is assigned",
      },
      currentBranchId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "branches",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Current active branch for this session (admins can switch)",
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

    // Add index
    await queryInterface.addIndex("users", ["branchId"]);
    await queryInterface.addIndex("users", ["currentBranchId"]);

    // Set currentBranchId to match branchId for all existing users
    await queryInterface.sequelize.query(`
      UPDATE users SET "currentBranchId" = "branchId" WHERE "branchId" IS NOT NULL;
    `);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("users");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_users_role";',
    );
  },
};
