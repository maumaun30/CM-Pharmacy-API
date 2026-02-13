"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("branches", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: "Branch name (e.g., 'Main Branch', 'Quezon City Branch')",
      },
      code: {
        type: Sequelize.STRING(10),
        allowNull: false,
        unique: true,
        comment: "Short branch code (e.g., 'MAIN', 'QC01')",
      },
      address: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      city: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      province: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      postalCode: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      managerName: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Branch manager name",
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      isMainBranch: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Indicates if this is the main/head branch",
      },
      operatingHours: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "Store operating hours in JSON format",
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

    // Add indexes
    await queryInterface.addIndex("branches", ["code"]);
    await queryInterface.addIndex("branches", ["isActive"]);
    await queryInterface.addIndex("branches", ["city"]);

    // FIXED: Use unique partial index instead of check constraint
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX branches_only_one_main 
      ON branches ("isMainBranch") 
      WHERE "isMainBranch" = true;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("branches");
  },
};