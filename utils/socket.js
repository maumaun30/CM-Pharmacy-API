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
    console.log(`Client connected: ${socket.id}`);

    // Join room based on branch (for branch-specific updates)
    socket.on("join-branch", (branchId) => {
      if (branchId) {
        socket.join(`branch-${branchId}`);
        console.log(`Socket ${socket.id} joined branch-${branchId}`);
      }
      // Admin room for all-branches view
      socket.join("admin-all");
    });

    // Leave branch room
    socket.on("leave-branch", (branchId) => {
      if (branchId) {
        socket.leave(`branch-${branchId}`);
        console.log(`Socket ${socket.id} left branch-${branchId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
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
    
    // Emit to specific branch
    if (saleData.branchId) {
      io.to(`branch-${saleData.branchId}`).emit("sale:new", saleData);
    }
    
    // Emit to admin viewing all branches
    io.to("admin-all").emit("sale:new", saleData);
    
    console.log(`Emitted sale:new event for sale #${saleData.id}`);
  } catch (error) {
    console.error("Error emitting sale event:", error);
  }
};

/**
 * Emit stock update event
 */
const emitStockUpdate = (stockData) => {
  try {
    const io = getIO();
    
    // Emit to specific branch
    if (stockData.branchId) {
      io.to(`branch-${stockData.branchId}`).emit("stock:update", stockData);
    }
    
    // Emit to admin viewing all branches
    io.to("admin-all").emit("stock:update", stockData);
    
    console.log(`Emitted stock:update event for product #${stockData.productId}`);
  } catch (error) {
    console.error("Error emitting stock event:", error);
  }
};

/**
 * Emit low stock alert
 */
const emitLowStockAlert = (productData) => {
  try {
    const io = getIO();
    
    // Emit to all connected clients (low stock is critical)
    io.emit("stock:low-alert", productData);
    
    console.log(`Emitted low stock alert for product #${productData.id}`);
  } catch (error) {
    console.error("Error emitting low stock alert:", error);
  }
};

/**
 * Emit dashboard refresh request
 */
const emitDashboardRefresh = (branchId = null) => {
  try {
    const io = getIO();
    
    if (branchId) {
      io.to(`branch-${branchId}`).emit("dashboard:refresh");
    } else {
      io.emit("dashboard:refresh");
    }
    
    console.log(`Emitted dashboard refresh${branchId ? ` for branch ${branchId}` : ""}`);
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