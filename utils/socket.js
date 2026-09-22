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
    // Personal room for targeted delivery (notifications). Identity-derived
    // from the authenticated socket — never from client input.
    socket.join(`user-${id}`);

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
 * Fan one event out to a branch room and the all-branches admin feed.
 *
 * The rooms are chained into a SINGLE emit on purpose. Socket.IO unions the
 * rooms and delivers one copy per socket, so an admin who sits in both
 * `branch-N` and `admin-all` receives the event once. Two separate
 * `.emit()` calls would deliver it twice — and because every client turns an
 * event into an HTTP refetch, a duplicate frame costs a duplicate round trip,
 * not just a few bytes.
 *
 * @param {string} event    - Event name
 * @param {number|null} branchId - Branch room to include (null = admins only)
 * @param {object} [payload]
 */
const emitToBranchAndAdmins = (event, branchId, payload) => {
  const io = getIO();
  const target = branchId
    ? io.to(`branch-${branchId}`).to("admin-all")
    : io.to("admin-all");
  if (payload === undefined) target.emit(event);
  else target.emit(event, payload);
};

/**
 * Emit new sale event
 */
const emitNewSale = (saleData) => {
  try {
    emitToBranchAndAdmins("new-sale", saleData.branchId ?? null, saleData);
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
    // The payload carries the new value, so a listener never needs to refetch
    // to learn the current stock — it can patch its copy in place.
    emitToBranchAndAdmins("stock-updated", branchId, {
      productId: data.productId,
      newStock: data.newStock,
      branchId: branchId,
    });
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
    emitToBranchAndAdmins("low-stock-alert", branchId ?? null, productData);
  } catch (error) {
    console.error("Error emitting low stock alert:", error);
  }
};

/**
 * Emit dashboard refresh request — a bare "go refetch" with no payload.
 *
 * LAST RESORT. Every listener answers it with an HTTP round trip, so the cost
 * is (connected clients x heavy endpoint), and it says nothing about WHAT
 * changed. Prefer an event that carries its own data ("new-sale",
 * "stock-updated", "refund-request:resolved") — those let a client patch in
 * place. Sale, stock and refund paths deliberately no longer emit this.
 *
 * Passing no branchId broadcasts to EVERY connected socket across ALL
 * branches. Only do that for something genuinely global.
 *
 * @param {number} [branchId] - Branch room to refresh; omit to broadcast to all
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

/**
 * Emit new refund request (to the branch's supervisors + admins)
 * @param {number} branchId - Branch the sale/request belongs to
 * @param {object} payload - snake_case refund_request row
 */
const emitRefundRequestNew = (branchId, payload) => {
  try {
    emitToBranchAndAdmins("refund-request:new", branchId ?? null, payload);
  } catch (error) {
    console.error("Error emitting refund-request:new:", error);
  }
};

/**
 * Emit refund request resolution (approved/declined)
 * @param {number} branchId - Branch the request belongs to
 * @param {object} payload - snake_case refund_request row (includes status, requested_by)
 */
const emitRefundRequestResolved = (branchId, payload) => {
  try {
    emitToBranchAndAdmins("refund-request:resolved", branchId ?? null, payload);
  } catch (error) {
    console.error("Error emitting refund-request:resolved:", error);
  }
};

/**
 * Emit a notification to a single user's personal room
 * @param {number} userId - Recipient user id
 * @param {object} notification - snake_case notifications row
 */
const emitNotificationNew = (userId, notification) => {
  try {
    const io = getIO();
    io.to(`user-${userId}`).emit("notification:new", notification);
  } catch (error) {
    console.error("Error emitting notification:new:", error);
  }
};

/**
 * Emit a clock in/out/break event to the branch room (and admins).
 * Drives the console's live "On shift now" list without polling.
 * @param {number} branchId - Branch the shift belongs to
 * @param {object} payload - { action, entry } with a snake_case entry row
 */
const emitTimeClock = (branchId, payload) => {
  try {
    emitToBranchAndAdmins("time:clock", branchId ?? null, payload);
  } catch (error) {
    console.error("Error emitting time:clock:", error);
  }
};

/**
 * Emit an approval or edit so other reviewers' tables update in place.
 * @param {number} branchId - Branch the entry belongs to
 * @param {object} payload - { action, entries } with snake_case entry rows
 */
const emitTimeEntryUpdated = (branchId, payload) => {
  try {
    emitToBranchAndAdmins("time:entry-updated", branchId ?? null, payload);
  } catch (error) {
    console.error("Error emitting time:entry-updated:", error);
  }
};

module.exports = {
  initializeSocket,
  getIO,
  emitNewSale,
  emitStockUpdate,
  emitLowStockAlert,
  emitDashboardRefresh,
  emitRefundRequestNew,
  emitRefundRequestResolved,
  emitNotificationNew,
  emitTimeClock,
  emitTimeEntryUpdated,
};