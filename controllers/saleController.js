const { Sale, SaleItem, Product, User } = require("../models");

exports.createSale = async (req, res) => {
  try {
    const { cart } = req.body; // [{ product: { id }, quantity }, ...]

    // Validate user
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty or invalid" });
    }

    // Validate cart items structure
    for (const item of cart) {
      if (!item.product?.id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: "Invalid cart item format" });
      }
    }

    // Fetch all products at once for validation
    const productIds = cart.map((item) => item.product.id);
    const products = await Product.findAll({
      where: { id: productIds },
    });

    // Create a map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate stock and calculate total
    let totalAmount = 0;

    for (const item of cart) {
      const product = productMap.get(item.product.id);

      if (!product) {
        return res.status(404).json({
          message: `Product ID ${item.product.id} not found`,
        });
      }

      if (item.quantity > product.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}`,
        });
      }

      // Use database price, not client price
      totalAmount += Number(product.price) * item.quantity;
    }

    // Wrap everything in a transaction
    const result = await Product.sequelize.transaction(async (t) => {
      // Create sale record
      const sale = await Sale.create(
        {
          totalAmount,
          soldBy: req.user.id,
        },
        { transaction: t }
      );

      // Create sale items and update stock
      for (const item of cart) {
        const product = productMap.get(item.product.id);

        // Create sale item with database price
        await SaleItem.create(
          {
            saleId: sale.id,
            productId: product.id,
            quantity: item.quantity,
            price: product.price, // Use DB price
          },
          { transaction: t }
        );

        // Update stock
        await Product.decrement(
          "quantity",
          {
            by: item.quantity,
            where: { id: product.id },
            transaction: t,
          }
        );
      }

      return sale;
    });

    return res.status(201).json({
      message: "Sale recorded successfully",
      saleId: result.id,
      totalAmount: result.totalAmount,
    });
  } catch (error) {
    console.error("Sale error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getSales = async (req, res) => {
  try {
    const sales = await Sale.findAll({
      order: [["soldAt", "DESC"]],
      include: [
        {
          model: SaleItem,
          as: "items",
          include: [
            {
              model: Product,
              attributes: ["id", "name"],
            },
          ],
        },
      ],
    });

    const response = sales.map((sale) => ({
      id: sale.id,
      totalAmount: sale.totalAmount,
      soldAt: sale.soldAt,
      soldBy: sale.soldBy,
      items: sale.items.map((item) => ({
        product: {
          id: item.Product.id,
          name: item.Product.name,
        },
        quantity: item.quantity,
        price: Number(item.price),
      })),
    }));

    res.json(response);
  } catch (error) {
    console.error("Error fetching sales:", error);
    res.status(500).json({
      message: "Error fetching sales",
      error: error.message,
    });
  }
};