// Load .env before any module that reads process.env at import time (e.g. config/cors).
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { corsOrigin } = require("./config/cors");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const discountRoutes = require("./routes/discountRoutes");
const authRoutes = require("./routes/authRoutes");
const saleRoutes = require("./routes/saleRoutes");
const stockRoutes = require("./routes/stockRoutes");
const userRoutes = require("./routes/userRoutes");
const logRoutes = require("./routes/logRoutes");
const branchRoutes = require("./routes/branchRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const refundRequestRoutes = require("./routes/refundRequestRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const { initializeSocket } = require("./utils/socket");

const app = express();
const server = http.createServer(app);

// Running behind Caddy (reverse proxy). Trust the first hop so req.ip and the
// rate limiter use the real client IP from X-Forwarded-For, not Caddy's address.
app.set("trust proxy", 1);

initializeSocket(server);

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(compression());
// Cap request body size to blunt oversized-payload abuse (default was 100kb).
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/refund-requests", refundRequestRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Welcome to Pharmacy POS API" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

app.set("server", server);

module.exports = app;