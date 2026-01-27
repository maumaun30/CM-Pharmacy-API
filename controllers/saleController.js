const { Sale, SaleItem, Product, User } = require("../models");

exports.createSale = async (req, res) => {
  try {
    const { cart } = req.body; // [{ product: { id, price }, quantity }, ...]

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty or invalid" });
    }

    // Validate stock and calculate total
    let totalAmount = 0;

    for (const item of cart) {
      const product = await Product.findByPk(item.product.id);

      if (!product) {
        return res
          .status(404)
          .json({ message: `Product ID ${item.product.id} not found` });
      }

      if (item.quantity > product.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for product ${product.name}. Available: ${product.quantity}`,
        });
      }

      totalAmount += Number(product.price) * item.quantity;
    }

    // Create sale record
    const sale = await Sale.create({
      totalAmount,
      soldBy: req.user.id,
    });

    // Create sale items and update stock in a transaction
    const Sequelize = require("sequelize");
    await Product.sequelize.transaction(async (t) => {
      for (const item of cart) {
        await SaleItem.create(
          {
            saleId: sale.id,
            productId: item.product.id,
            quantity: item.quantity,
            price: item.product.price,
          },
          { transaction: t }
        );

        const product = await Product.findByPk(item.product.id, {
          transaction: t,
        });
        product.quantity -= item.quantity;
        await product.save({ transaction: t });
      }
    });

    return res
      .status(201)
      .json({ message: "Sale recorded successfully", saleId: sale.id });
  } catch (error) {
    console.error("Sale error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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
              attributes: ["name"],
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
        product: item.Product,
        quantity: item.quantity,
        price: item.price,
      })),
    }));

    res.json(response);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching sales", error: error.message });
  }
};
