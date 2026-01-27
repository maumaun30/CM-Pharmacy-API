const { StockMovement, Product } = require("../models");

exports.addStockMovement = async (req, res) => {
  try {
    const { productId, quantity, type, reason } = req.body;

    if (!["IN", "OUT", "ADJUST"].includes(type)) {
      return res.status(400).json({ message: "Invalid movement type" });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res
        .status(400)
        .json({ message: "Quantity must be a positive integer" });
    }

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const movement = await StockMovement.create({
      productId,
      userId: req.user?.id || null,
      quantity,
      type,
      reason,
    });

    res.status(201).json({ message: "Stock movement recorded", movement });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.getProductStock = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [totalIn, totalOut, totalAdjust] = await Promise.all([
      StockMovement.sum("quantity", {
        where: { productId, type: "IN" },
      }),
      StockMovement.sum("quantity", {
        where: { productId, type: "OUT" },
      }),
      StockMovement.sum("quantity", {
        where: { productId, type: "ADJUST" },
      }),
    ]);

    const stock = (totalIn || 0) - (totalOut || 0) + (totalAdjust || 0);

    res.json({ productId, stock });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
