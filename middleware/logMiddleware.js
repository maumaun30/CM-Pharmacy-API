// middleware/logMiddleware.js
const { Log } = require("../models");

// Extract IP address from request
const getIpAddress = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    null
  );
};

// Extract user agent
const getUserAgent = (req) => {
  return req.headers["user-agent"] || null;
};

// Create log helper function
const createLog = async (req, action, module, recordId, description, metadata = null) => {
  try {
    await Log.createLog({
      userId: req.user?.id || null,
      action,
      module,
      recordId,
      description,
      metadata,
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });
  } catch (error) {
    console.error("Logging error:", error);
  }
};

module.exports = { createLog, getIpAddress, getUserAgent };