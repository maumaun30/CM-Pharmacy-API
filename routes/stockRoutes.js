const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stockController");

router.post("/movements", stockController.addStockMovement);
router.get("/:productId", stockController.getProductStock);

module.exports = router;
