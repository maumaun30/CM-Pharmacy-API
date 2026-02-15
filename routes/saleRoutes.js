const express = require("express");
const router = express.Router();
const saleController = require("../controllers/saleController");
const { authenticateUser } = require("../middleware/authMiddleware");

router.use(authenticateUser);

router.post("/", saleController.createSale);
router.get("/", saleController.getSales);

module.exports = router;
