// routes/dashboardRoutes.js
const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { authenticateUser } = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.get("/stats", dashboardController.getDashboardStats);
router.get("/weekly-trend", dashboardController.getWeeklySalesTrend);
router.get("/top-products", dashboardController.getTopProducts);

module.exports = router;
