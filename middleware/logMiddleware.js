const supabase = require("../config/supabase");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getIpAddress = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0] ||
  req.headers["x-real-ip"] ||
  req.connection?.remoteAddress ||
  req.socket?.remoteAddress ||
  null;

const getUserAgent = (req) => req.headers["user-agent"] || null;

// ─── createLog ────────────────────────────────────────────────────────────────
// Drop-in replacement for the Sequelize version.
// Signature is identical — all controllers call this without changes.

const createLog = async (req, action, module, recordId, description, metadata = null) => {
  try {
    await supabase.from("logs").insert({
      user_id:     req.user?.id   || null,
      action,
      module,
      record_id:   recordId       || null,
      description: description    || null,
      metadata:    metadata       || null,
      ip_address:  getIpAddress(req),
      user_agent:  getUserAgent(req),
    });
  } catch (error) {
    // Logging should never crash the main request
    console.error("Logging error:", error);
  }
};

module.exports = { createLog, getIpAddress, getUserAgent };