"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get branch stocks with proper column quoting
    const branchStocksResult = await queryInterface.sequelize.query(
      `SELECT 
        bs.id,
        bs."productId",
        bs."branchId",
        bs."currentStock",
        p.sku,
        p.name,
        p.cost
       FROM branch_stocks bs 
       JOIN products p ON bs."productId" = p.id
       ORDER BY bs."productId", bs."branchId";`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    // Get first user (admin) for performedBy
    const usersResult = await queryInterface.sequelize.query(
      `SELECT id FROM users LIMIT 1;`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    if (branchStocksResult.length === 0) {
      console.log("No branch stocks found. Skipping stock transaction seeding.");
      return;
    }

    if (usersResult.length === 0) {
      console.log("No users found. Skipping stock transaction seeding.");
      return;
    }

    const userId = usersResult[0].id;
    const stockTransactions = [];

    console.log(`Found ${branchStocksResult.length} branch stock records to process`);

    // Create initial stock transactions for each branch stock
    branchStocksResult.forEach((branchStock) => {
      // INITIAL_STOCK transaction
      stockTransactions.push({
        productId: branchStock.productId,
        branchId: branchStock.branchId,
        transactionType: "INITIAL_STOCK",
        quantity: branchStock.currentStock,
        quantityBefore: 0,
        quantityAfter: branchStock.currentStock,
        unitCost: parseFloat(branchStock.cost),
        totalCost: parseFloat(branchStock.cost) * branchStock.currentStock,
        batchNumber: `BATCH-INIT-${branchStock.productId}-${branchStock.branchId}`,
        supplier: "Initial Inventory Setup",
        reason: "Initial stock setup for branch",
        performedBy: userId,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      });
    });

    // Add some sample transactions (purchases, sales, adjustments) for variety
    // Find specific products for sample transactions
    const mainBranchStocks = branchStocksResult.filter(bs => {
      // Assuming first branch is main (you can adjust this logic)
      const branchIds = [...new Set(branchStocksResult.map(b => b.branchId))];
      return bs.branchId === branchIds[0];
    });

    const getStockBySku = (sku, branchIndex = 0) => {
      const branchIds = [...new Set(branchStocksResult.map(b => b.branchId))].sort();
      const targetBranchId = branchIds[branchIndex] || branchIds[0];
      return branchStocksResult.find(bs => 
        bs.sku === sku && bs.branchId === targetBranchId
      );
    };

    // Sample transactions with branch variation
    const sampleTransactions = [
      // Recent purchases
      { sku: "GEN-PCM-500", branchIndex: 0, type: "PURCHASE", quantity: 100, daysAgo: 7, supplier: "ABC Pharma" },
      { sku: "GEN-IBU-400", branchIndex: 1, type: "PURCHASE", quantity: 50, daysAgo: 5, supplier: "MedSupply Inc" },
      { sku: "MLK-ENF-400", branchIndex: 0, type: "PURCHASE", quantity: 30, daysAgo: 10, supplier: "NutriHealth Co" },
      
      // Recent sales
      { sku: "GEN-PCM-500", branchIndex: 0, type: "SALE", quantity: -25, daysAgo: 2 },
      { sku: "BRD-TYL-500", branchIndex: 1, type: "SALE", quantity: -15, daysAgo: 1 },
      { sku: "OTH-MSK-N95", branchIndex: 2, type: "SALE", quantity: -20, daysAgo: 3 },
      
      // Stock adjustments
      { sku: "GEN-CET-10", branchIndex: 1, type: "ADJUSTMENT", quantity: 10, daysAgo: 4, reason: "Stock count correction" },
      { sku: "VIT-VTC-1000", branchIndex: 0, type: "ADJUSTMENT", quantity: -5, daysAgo: 6, reason: "Damaged during handling" },
      
      // More variety
      { sku: "BRD-ADV-200", branchIndex: 2, type: "SALE", quantity: -12, daysAgo: 2 },
      { sku: "MLK-ENS-237", branchIndex: 3, type: "PURCHASE", quantity: 25, daysAgo: 8, supplier: "NutriHealth Co" },
    ];

    // Process sample transactions
    for (const sample of sampleTransactions) {
      const branchStock = getStockBySku(sample.sku, sample.branchIndex);

      if (branchStock) {
        const currentStock = branchStock.currentStock;
        const quantity = sample.quantity;
        const newStock = currentStock + quantity;

        // Only add if the transaction wouldn't result in negative stock
        if (newStock >= 0) {
          stockTransactions.push({
            productId: branchStock.productId,
            branchId: branchStock.branchId,
            transactionType: sample.type,
            quantity: quantity,
            quantityBefore: currentStock,
            quantityAfter: newStock,
            unitCost: sample.type === "PURCHASE" ? parseFloat(branchStock.cost) : null,
            totalCost: sample.type === "PURCHASE" ? parseFloat(branchStock.cost) * Math.abs(quantity) : null,
            batchNumber: sample.type === "PURCHASE" ? `BATCH-${Date.now()}-${branchStock.productId}` : null,
            supplier: sample.supplier || null,
            reason: sample.reason || null,
            performedBy: userId,
            createdAt: new Date(Date.now() - sample.daysAgo * 24 * 60 * 60 * 1000),
          });
        }
      }
    }

    // Insert all stock transactions
    if (stockTransactions.length > 0) {
      await queryInterface.bulkInsert("stocks", stockTransactions, {});
      console.log(`✅ Seeded ${stockTransactions.length} stock transactions`);
      console.log(`   - ${branchStocksResult.length} initial stock records`);
      console.log(`   - ${stockTransactions.length - branchStocksResult.length} sample transactions`);
    } else {
      console.log("No transactions to insert");
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("stocks", null, {});
  },
};