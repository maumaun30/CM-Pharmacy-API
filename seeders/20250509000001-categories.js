"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert(
      "categories",
      [
        {
          name: "Generic Medicines",
          description: "Non-branded pharmaceutical products",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Branded Medicines",
          description: "Branded pharmaceutical products",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Milk Products",
          description: "Milk-based nutritional supplements and products",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Others",
          description:
            "Medical supplies, personal care products, and other items",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      {}
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("categories", null, {});
  },
};
