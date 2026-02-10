const {
  Sale,
  SaleItem,
  Product,
  User,
  Discount,
  Category,
} = require("../models");
const { createLog } = require("../middleware/logMiddleware");

exports.createSale = async (req, res) => {
  try {
    const { cart, subtotal, totalDiscount, total, cashAmount } = req.body;

    // Validate user
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty or invalid" });
    }

    // Validate cart items structure
    for (const item of cart) {
      // Check for both old format (item.product.id) and new format (item.productId)
      const productId = item.productId || item.product?.id;
      const quantity = item.quantity;

      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({
          message: "Invalid cart item format",
          receivedItem: item,
        });
      }
    }

    // Extract product IDs (handle both formats)
    const productIds = cart.map((item) => item.productId || item.product.id);
    const products = await Product.findAll({
      where: { id: productIds },
    });

    // Create a map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate stock and calculate totals
    let calculatedSubtotal = 0;
    let calculatedTotalDiscount = 0;

    for (const item of cart) {
      const productId = item.productId || item.product.id;
      const product = productMap.get(productId);

      if (!product) {
        return res.status(404).json({
          message: `Product ID ${productId} not found`,
        });
      }

      if (item.quantity > product.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}`,
        });
      }

      // Calculate subtotal using database price
      const itemSubtotal = Number(product.price) * item.quantity;
      calculatedSubtotal += itemSubtotal;

      // Calculate discount if applied
      if (item.discountId && item.discountedPrice) {
        const itemDiscount =
          (Number(product.price) - Number(item.discountedPrice)) *
          item.quantity;
        calculatedTotalDiscount += itemDiscount;
      }
    }

    const calculatedTotal = calculatedSubtotal - calculatedTotalDiscount;

    // Validate totals (allow small floating point differences)
    if (subtotal && Math.abs(calculatedSubtotal - subtotal) > 0.01) {
      return res.status(400).json({
        message: "Subtotal mismatch",
        calculated: calculatedSubtotal,
        received: subtotal,
      });
    }

    if (
      totalDiscount &&
      Math.abs(calculatedTotalDiscount - totalDiscount) > 0.01
    ) {
      return res.status(400).json({
        message: "Total discount mismatch",
        calculated: calculatedTotalDiscount,
        received: totalDiscount,
      });
    }

    // Wrap everything in a transaction
    const result = await Product.sequelize.transaction(async (t) => {
      // Create sale record
      const sale = await Sale.create(
        {
          totalAmount: calculatedTotal,
          subtotal: calculatedSubtotal,
          totalDiscount: calculatedTotalDiscount,
          cashAmount: cashAmount || null,
          changeAmount: cashAmount ? cashAmount - calculatedTotal : null,
          soldBy: req.user.id,
        },
        { transaction: t },
      );

      // Create sale items and update stock
      for (const item of cart) {
        const productId = item.productId || item.product.id;
        const product = productMap.get(productId);

        // Determine final price (discounted or regular)
        const finalPrice = item.discountedPrice
          ? Number(item.discountedPrice)
          : Number(product.price);

        // Create sale item
        await SaleItem.create(
          {
            saleId: sale.id,
            productId: product.id,
            quantity: item.quantity,
            price: Number(product.price), // Original price
            discountedPrice: item.discountedPrice
              ? Number(item.discountedPrice)
              : null,
            discountId: item.discountId || null,
            discountAmount: item.discountedPrice
              ? (Number(product.price) - Number(item.discountedPrice)) *
                item.quantity
              : 0,
          },
          { transaction: t },
        );

        // Update stock
        await Stock.createTransaction({
          productId: product.id,
          transactionType: "SALE",
          quantity: -item.quantity,
          referenceId: sale.id,
          referenceType: "sale",
          performedBy: req.user.id,
          transaction: t,
        });
      }

      return sale;
    });

    await createLog(
      req,
      "SALE",
      "sales",
      result.id,
      `Completed sale #${result.id} - Total: ₱${result.totalAmount}`,
      {
        items: cart.length,
        total: result.totalAmount,
        discount: totalDiscount,
      },
    );

    return res.status(201).json({
      message: "Sale recorded successfully",
      saleId: result.id,
      subtotal: result.subtotal,
      totalDiscount: result.totalDiscount,
      totalAmount: result.totalAmount,
      cashAmount: result.cashAmount,
      changeAmount: result.changeAmount,
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
              as: "Product",
              attributes: ["id", "name"],
            },
            {
              model: Discount,
              as: "Discount",
              attributes: ["id", "name", "discountType", "discountValue"],
              required: false,
            },
          ],
        },
        {
          model: User,
          as: "seller",
          attributes: ["id", "username", "email"], // CHANGED: name -> username
          required: false,
        },
      ],
    });

    const response = sales.map((sale) => ({
      id: sale.id,
      subtotal: sale.subtotal ? parseFloat(sale.subtotal) : null,
      totalDiscount: sale.totalDiscount ? parseFloat(sale.totalDiscount) : 0,
      totalAmount: parseFloat(sale.totalAmount),
      cashAmount: sale.cashAmount ? parseFloat(sale.cashAmount) : null,
      changeAmount: sale.changeAmount ? parseFloat(sale.changeAmount) : null,
      soldAt: sale.soldAt,
      soldBy: sale.soldBy,
      seller: sale.seller
        ? {
            id: sale.seller.id,
            name: sale.seller.username, // CHANGED: Map username to name for frontend
            email: sale.seller.email,
          }
        : null,
      items: sale.items.map((item) => ({
        product: {
          id: item.Product.id,
          name: item.Product.name,
        },
        quantity: item.quantity,
        price: parseFloat(item.price),
        discountedPrice: item.discountedPrice
          ? parseFloat(item.discountedPrice)
          : null,
        discountAmount: item.discountAmount
          ? parseFloat(item.discountAmount)
          : 0,
        discount: item.Discount
          ? {
              id: item.Discount.id,
              name: item.Discount.name,
              type: item.Discount.discountType,
              value: parseFloat(item.Discount.discountValue),
            }
          : null,
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
