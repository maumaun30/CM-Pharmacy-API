const { db, schema } = require("../config/db");

const { logs } = schema;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getIpAddress = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0] ||
  req.headers["x-real-ip"] ||
  req.connection?.remoteAddress ||
  req.socket?.remoteAddress ||
  null;

const getUserAgent = (req) => req.headers["user-agent"] || null;

// ─── createLog ────────────────────────────────────────────────────────────────
// Signature is unchanged — all controllers call this without modification.

const createLog = async (req, action, module, recordId, description, metadata = null) => {
  try {
    await db.insert(logs).values({
      userId:      req.user?.id   || null,
      action,
      module,
      recordId:    recordId       || null,
      description: description    || null,
      metadata:    metadata       || null,
      ipAddress:   getIpAddress(req),
      userAgent:   getUserAgent(req),
    });
  } catch (error) {
    // Logging should never crash the main request
    console.error("Logging error:", error);
  }
};

module.exports = { createLog, getIpAddress, getUserAgent };
