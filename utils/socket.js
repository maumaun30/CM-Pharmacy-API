const socketIO = require("socket.io");
const jwt = require("jsonwebtoken");
const { eq } = require("drizzle-orm");
const { corsOrigin } = require("../config/cors");
const { db, schema } = require("../config/db");

const { users } = schema;

let io;

/**
 * Initialize Socket.IO server
 */
const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
  });

  // ─── Handshake authentication ────────────────────────────────────────────────
  // Every socket connection must present a valid JWT (same token as the REST API).
  // We verify it and load the user so room membership is derived from a trusted
  // identity — never from a client-supplied branch id. Rejected connections never
  // reach the connection handler, so anonymous clients can't subscribe to events.
  io.use(async (socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");
      if (!raw) return next(new Error("Unauthorized: no token"));

      const decoded = jwt.verify(raw, process.env.JWT_SECRET);

      const [user] = await db
        .select({
          id: users.id,
          role: users.role,
          isActive: users.isActive,
          branchId: users.branchId,
          currentBranchId: users.currentBranchId,
          allowedBranchIds: users.allowedBranchIds,
        })
        .from(users)
        .where(eq(users.id, decoded.id))
        .limit(1);

      if (!user || !user.isActive) {
        return next(new Error("Unauthorized: invalid user"));
      }

      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { id, role, branchId, currentBranchId, allowedBranchIds } = socket.user;
    console.log(`✅ Client connected: ${socket.id} (user ${id}, ${role})`);

    // Room membership is authoritative and identity-derived:
    //  • admins receive the all-branches feed;
    //  • everyone is scoped to their active branch.
    if (role === "admin") {
      socket.join("admin-all");
    }
    const effectiveBranch = currentBranchId ?? branchId;
    if (effectiveBranch) {
      socket.join(`branch-${effectiveBranch}`);
    }

    // Branch switching stays available but is now guarded: a non-admin can only
    // (re)join their own branch; admins may follow any branch.
    socket.on("join-branch", (requestedBranchId) => {
      if (!requestedBranchId) return; // null = "all branches" (admins already in admin-all)
      const req = Number(requestedBranchId);
      const managerBranches = (allowedBranchIds ?? []).map(Number);
      const allowed =
        role === "admin" ||
        req === (currentBranchId ?? branchId) ||
        (role === "manager" && managerBranches.includes(req));
      if (allowed) {
        socket.join(`branch-${requestedBranchId}`);
      }
    });

    socket.on("leave-branch", (requestedBranchId) => {
      if (requestedBranchId) socket.leave(`branch-${requestedBranchId}`);
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