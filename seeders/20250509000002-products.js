"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get category IDs
    const categories = await queryInterface.sequelize.query(
      `SELECT id, name FROM categories;`
    );

    const categoryRows = categories[0];
    const categoryMap = {};

    categoryRows.forEach((category) => {
      categoryMap[category.name] = category.id;
    });

    await queryInterface.bulkInsert(
      "products",
      [
        // Generic Medicines
        {
          name: "Paracetamol 500mg",
          sku: "GEN-PCM-500",
          description: "Pain reliever and fever reducer",
          price: 5.99,
          cost: 2.5,
          quantity: 100,
          expiryDate: new Date("2026-05-01"),
          genericName: "Paracetamol",
          dosage: "500mg",
          form: "Tablet",
          requiresPrescription: false,
          categoryId: categoryMap["Generic Medicines"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Amoxicillin 250mg",
          sku: "GEN-AMX-250",
          description: "Antibiotic for bacterial infections",
          price: 12.5,
          cost: 5.75,
          quantity: 50,
          expiryDate: new Date("2026-03-15"),
          genericName: "Amoxicillin",
          dosage: "250mg",
          form: "Capsule",
          requiresPrescription: true,
          categoryId: categoryMap["Generic Medicines"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },

        // Branded Medicines
        {
          name: "Tylenol Extra Strength",
          sku: "BRD-TYL-500",
          description: "Fast pain relief for headaches and fever",
          price: 12.99,
          cost: 6.25,
          quantity: 75,
          expiryDate: new Date("2026-06-20"),
          brandName: "Tylenol",
          genericName: "Acetaminophen",
          dosage: "500mg",
          form: "Tablet",
          requiresPrescription: false,
          categoryId: categoryMap["Branded Medicines"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Advil Liquid Gels",
          sku: "BRD-ADV-200",
          description: "Fast-acting pain reliever",
          price: 15.99,
          cost: 7.5,
          quantity: 60,
          expiryDate: new Date("2026-04-10"),
          brandName: "Advil",
          genericName: "Ibuprofen",
          dosage: "200mg",
          form: "Liquid Gel",
          requiresPrescription: false,
          categoryId: categoryMap["Branded Medicines"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },

        // Milk Products
        {
          name: "Enfamil Premium Infant Formula",
          sku: "MLK-ENF-400",
          description: "Milk-based infant formula for 0-12 months",
          price: 29.99,
          cost: 15.25,
          quantity: 30,
          expiryDate: new Date("2026-02-28"),
          brandName: "Enfamil",
          dosage: "400g",
          form: "Powder",
          requiresPrescription: false,
          categoryId: categoryMap["Milk Products"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Ensure Plus Vanilla",
          sku: "MLK-ENS-237",
          description: "Nutritional supplement for adults",
          price: 24.99,
          cost: 12.75,
          quantity: 45,
          expiryDate: new Date("2026-01-15"),
          brandName: "Ensure",
          dosage: "237ml",
          form: "Liquid",
          requiresPrescription: false,
          categoryId: categoryMap["Milk Products"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },

        // Others
        {
          name: "Digital Thermometer",
          sku: "OTH-THM-001",
          description: "Digital thermometer for body temperature measurement",
          price: 19.99,
          cost: 9.5,
          quantity: 25,
          brandName: "HealthPro",
          requiresPrescription: false,
          categoryId: categoryMap["Others"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "First Aid Kit",
          sku: "OTH-FAK-001",
          description: "Basic first aid supplies for home use",
          price: 32.99,
          cost: 18.0,
          quantity: 15,
          brandName: "SafetyFirst",
          requiresPrescription: false,
          categoryId: categoryMap["Others"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      {}
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("products", null, {});
  },
};
