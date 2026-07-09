// Shared CORS allow-list for both the HTTP API (app.js) and Socket.IO (socket.js).
//
// CLIENT_URL may be a single origin or a comma-separated list, e.g.
//   CLIENT_URL=https://cm-admin.devmau.site,http://localhost:3000
//
// Requests with NO Origin header (native mobile apps, curl, server-to-server)
// are allowed — CORS is a browser-only mechanism, so those clients are governed
// by JWT auth, not by this list.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
};

module.exports = { allowedOrigins, corsOrigin };
