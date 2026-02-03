const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const discountRoutes = require("./routes/discountRoutes");
const authRoutes = require("./routes/authRoutes");
const saleRoutes = require("./routes/saleRoutes");
const stockRoutes = require("./routes/stockRoutes");
const userRoutes = require("./routes/userRoutes");

const {
  authenticateUser,
  authorizeRoles,
} = require("./middleware/authMiddleware");

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/categories", authenticateUser, categoryRoutes);
app.use("/api/products", authenticateUser, productRoutes);
app.use("/api/discounts", authenticateUser, discountRoutes);

app.use("/api/stocks", authenticateUser, stockRoutes);
app.use("/api/sales", authenticateUser, saleRoutes);

app.use("/api/users", authenticateUser, userRoutes);

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to Pharmacy POS API" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

module.exports = app;
