const socketIO = require("socket.io");

let io;

/**
 * Initialize Socket.IO server
 */
const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
  });

  io.on("connection", (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // Join room based on branch (for branch-specific updates)
    socket.on("join-branch", (branchId) => {
      if (branchId) {
        socket.join(`branch-${branchId}`);
        console.log(`🏢 Socket ${socket.id} joined branch-${branchId}`);
      }
      // Admin room for all-branches view
      socket.join("admin-all");
    });

    // Leave branch room
    socket.on("leave-branch", (branchId) => {
      if (branchId) {
        socket.leave(`branch-${branchId}`);
        console.log(`👋 Socket ${socket.id} left branch-${branchId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized!");
  }
  return io;
};

/**
 * Emit new sale event
 */
const emitNewSale = (saleData) => {
  try {
    const io = getIO();
    
    // ✅ FIXED: Use "new-sale" to match frontend listener
    if (saleData.branchId) {
      io.to(`branch-${saleData.branchId}`).emit("new-sale", saleData);
      console.log(`🛒 Emitted new-sale to branch-${saleData.branchId}:`, saleData.id);
    }
    
    // Emit to admin viewing all branches
    io.to("admin-all").emit("new-sale", saleData);
    
  } catch (error) {
    console.error("Error emitting sale event:", error);
  }
};

/**
 * Emit stock update event
 * @param {number} branchId - Branch ID where stock changed
 * @param {object} data - Stock data {productId, newStock}
 */
const emitStockUpdate = (branchId, data) => {
  try {
    const io = getIO();
    
    // ✅ FIXED: Use "stock-updated" to match frontend listener
    const payload = {
      productId: data.productId,
      newStock: data.newStock,
      branchId: branchId,
    };
    
    // Emit to specific branch
    io.to(`branch-${branchId}`).emit("stock-updated", payload);
    console.log(`📦 Emitted stock-updated to branch-${branchId}:`, payload);
    
    // Emit to admin viewing all branches
    io.to("admin-all").emit("stock-updated", payload);
    
  } catch (error) {
    console.error("Error emitting stock event:", error);
  }
};

/**
 * Emit low stock alert
 * @param {number} branchId - Branch ID where low stock detected
 * @param {object} productData - Product data
 */
const emitLowStockAlert = (branchId, productData) => {
  try {
    const io = getIO();
    
    // Emit to specific branch
    if (branchId) {
      io.to(`branch-${branchId}`).emit("low-stock-alert", productData);
      console.log(`⚠️ Emitted low-stock-alert to branch-${branchId}:`, productData.id);
    }
    
    // Emit to admin viewing all branches
    io.to("admin-all").emit("low-stock-alert", productData);
    
  } catch (error) {
    console.error("Error emitting low stock alert:", error);
  }
};

/**
 * Emit dashboard refresh request
 * @param {number} branchId - Branch ID to refresh (optional)
 */
const emitDashboardRefresh = (branchId = null) => {
  try {
    const io = getIO();
    
    if (branchId) {
      io.to(`branch-${branchId}`).emit("dashboard-refresh");
      console.log(`📊 Emitted dashboard-refresh to branch-${branchId}`);
    } else {
      io.emit("dashboard-refresh");
      console.log(`📊 Emitted dashboard-refresh to all`);
    }
    
  } catch (error) {
    console.error("Error emitting dashboard refresh:", error);
  }
};

module.exports = {
  initializeSocket,
  getIO,
  emitNewSale,
  emitStockUpdate,
  emitLowStockAlert,
  emitDashboardRefresh,
};