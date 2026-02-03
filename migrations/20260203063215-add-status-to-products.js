"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("products", "status", {
      type: Sequelize.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
      after: "requiresPrescription", // Optional: specify column position
    });

    // Add index for better query performance
    await queryInterface.addIndex("products", ["status"]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex("products", ["status"]);
    await queryInterface.removeColumn("products", "status");
    // Note: Sequelize doesn't auto-drop ENUM types, you may need to manually drop if needed
  },
};