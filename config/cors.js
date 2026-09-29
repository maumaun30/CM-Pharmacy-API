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

// ─── Socket.IO origin policy ──────────────────────────────────────────────────
//
// Socket.IO gets a DIFFERENT policy from the HTTP API, and deliberately so.
//
// React Native's Android WebSocket sets `Origin` to the target's own origin
// (wss://api.example.com -> https://api.example.com), which is never in
// CLIENT_URL. Its polling requests, which go through RN's XMLHttpRequest, send
// no Origin at all. The result was silent and expensive: polling was allowed,
// every upgrade to WebSocket was refused with 400 {"code":3}, and the mobile
// apps long-polled forever (measured in prod: 194 refused upgrades, zero
// successful, ~573 polling requests/hour).
//
// Allow-listing origins here bought nothing anyway:
//   - browsers do not apply CORS to WebSocket, so it never restricted them;
//   - the handshake already requires a valid JWT (see utils/socket.js io.use),
//     and that token lives in localStorage / SecureStore, never a cookie, so a
//     third-party page cannot borrow it the way it could with cookie auth.
// The JWT is the real gate. Keep the strict allow-list on the HTTP API, where
// it does do work, and let any origin attempt a socket handshake.
const socketCorsOrigin = (origin, callback) => callback(null, true);

module.exports = { allowedOrigins, corsOrigin, socketCorsOrigin };
