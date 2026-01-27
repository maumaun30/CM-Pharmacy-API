"use strict";
const bcrypt = require("bcryptjs");

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const salt = await bcrypt.genSalt(10);
    const hashedAdminPassword = await bcrypt.hash("admin123", salt);
    const hashedStaffPassword = await bcrypt.hash("staff123", salt);

    await queryInterface.bulkInsert(
      "users",
      [
        {
          username: "admin",
          email: "admin@pharmacy.com",
          password: hashedAdminPassword,
          role: "admin",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          username: "staff",
          email: "staff@pharmacy.com",
          password: hashedStaffPassword,
          role: "staff",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      {}
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("users", null, {});
  },
};
