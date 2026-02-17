"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get all products
    const products = await queryInterface.sequelize.query(
      `SELECT id, sku FROM products;`
    );

    // Get all branches
    const branches = await queryInterface.sequelize.query(
      `SELECT id, code FROM branches;`
    );

    const productRows = products[0];
    const branchRows = branches[0];

    if (productRows.length === 0 || branchRows.length === 0) {
      console.log("No products or branches found. Skipping branch stock seeding.");
      return;
    }

    const branchStocks = [];

    // Stock distribution strategies by product type
    // Main Branch (MAIN), Eastwood (EW01), SM North (SMN01), Makati (MKT01), BGC (BGC01), Alabang (ALB01)
    const stockStrategies = {
      // High volume products - distribute heavily across all branches
      "GEN-PCM-500": { main: 200, others: [150, 140, 120, 130, 110] }, // Paracetamol
      "GEN-IBU-400": { main: 150, others: [100, 95, 85, 90, 80] },     // Ibuprofen
      "GEN-CET-10": { main: 120, others: [80, 75, 70, 75, 65] },       // Cetirizine
      
      // Prescription items - moderate distribution, main branch has most
      "GEN-AMX-250": { main: 100, others: [60, 55, 50, 55, 45] },    // Amoxicillin
      "GEN-MET-500": { main: 80, others: [50, 45, 40, 45, 35] },     // Metformin
      "BRD-NEX-40": { main: 60, others: [40, 35, 30, 35, 28] },      // Nexium
      "BRD-LIP-20": { main: 50, others: [30, 28, 25, 28, 22] },      // Lipitor
      
      // Branded medicines - good distribution
      "BRD-TYL-500": { main: 100, others: [70, 65, 60, 65, 55] },    // Tylenol
      "BRD-ADV-200": { main: 80, others: [60, 55, 50, 55, 45] },     // Advil
      "BRD-ZYR-10": { main: 70, others: [50, 45, 40, 45, 38] },      // Zyrtec
      
      // Milk products - moderate distribution
      "MLK-ENF-400": { main: 50, others: [35, 32, 30, 32, 26] },     // Enfamil
      "MLK-ENS-237": { main: 60, others: [40, 38, 35, 38, 30] },     // Ensure
      "MLK-SIM-400": { main: 45, others: [30, 28, 25, 28, 22] },     // Similac
      "MLK-BST-237": { main: 40, others: [25, 23, 20, 23, 18] },     // Boost
      "MLK-PED-237": { main: 35, others: [25, 23, 20, 23, 18] },     // Pediasure
      
      // Vitamins - good distribution
      "VIT-VTC-1000": { main: 100, others: [70, 65, 60, 65, 55] },   // Vitamin C
      "VIT-MLT-001": { main: 80, others: [60, 55, 50, 55, 45] },     // Multivitamin
      "VIT-VTD-2000": { main: 70, others: [50, 45, 40, 45, 38] },    // Vitamin D
      
      // Medical devices - lower stock, main branch has most
      "OTH-THM-001": { main: 30, others: [20, 18, 15, 18, 14] },     // Thermometer
      "OTH-FAK-001": { main: 25, others: [15, 14, 12, 14, 11] },     // First Aid Kit
      "OTH-BPM-001": { main: 20, others: [12, 11, 10, 11, 9] },      // BP Monitor
      "OTH-GLU-001": { main: 18, others: [10, 9, 8, 9, 7] },         // Glucose Meter
      "OTH-MSK-N95": { main: 150, others: [100, 95, 85, 90, 75] },   // Face Masks
      "OTH-SAN-500": { main: 120, others: [80, 75, 70, 75, 65] },    // Hand Sanitizer
    };

    // Default strategy for products not in the map
    const defaultStrategy = { main: 50, others: [30, 28, 25, 28, 22] };

    // Create branch stock records
    productRows.forEach((product) => {
      const strategy = stockStrategies[product.sku] || defaultStrategy;
      
      branchRows.forEach((branch, index) => {
        const isMainBranch = index === 0; // Assuming first branch is main
        const currentStock = isMainBranch 
          ? strategy.main 
          : (strategy.others[index - 1] || strategy.others[strategy.others.length - 1]);

        // Calculate thresholds based on stock levels
        const minimumStock = Math.max(5, Math.floor(currentStock * 0.1));
        const reorderPoint = Math.max(10, Math.floor(currentStock * 0.2));
        const maximumStock = Math.floor(currentStock * 2);

        branchStocks.push({
          productId: product.id,
          branchId: branch.id,
          currentStock: currentStock,
          minimumStock: minimumStock,
          maximumStock: maximumStock,
          reorderPoint: reorderPoint,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    });

    // Insert all branch stocks
    await queryInterface.bulkInsert("branch_stocks", branchStocks, {});

    console.log(`✅ Seeded ${branchStocks.length} branch stock records`);
    console.log(`   - ${productRows.length} products`);
    console.log(`   - ${branchRows.length} branches`);
    console.log(`   - ${productRows.length * branchRows.length} total records`);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("branch_stocks", null, {});
  },
};