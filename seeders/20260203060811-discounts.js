// seeders/XXXXXXXXXXXXXX-default-discounts.js
"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert("discounts", [
      {
        name: "PWD Discount",
        description: "20% discount for Persons with Disability",
        discountType: "PERCENTAGE",
        discountValue: 20.00,
        discountCategory: "PWD",
        isEnabled: true,
        requiresVerification: true,
        applicableTo: "ALL_PRODUCTS",
        priority: 10,
        stackable: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "Senior Citizen Discount",
        description: "20% discount for Senior Citizens (60+)",
        discountType: "PERCENTAGE",
        discountValue: 20.00,
        discountCategory: "SENIOR_CITIZEN",
        isEnabled: true,
        requiresVerification: true,
        applicableTo: "ALL_PRODUCTS",
        priority: 10,
        stackable: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("discounts", {
      name: ["PWD Discount", "Senior Citizen Discount"],
    });
  },
};