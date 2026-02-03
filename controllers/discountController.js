const { Discount, Product } = require("../models");
const { Op } = require("sequelize");

// Get all discounts with optional filters
exports.getAllDiscounts = async (req, res) => {
  try {
    const {
      discountCategory,
      discountType,
      isEnabled,
      requiresVerification,
      activeOnly,
      search,
    } = req.query;

    const whereClause = {};

    if (discountCategory) {
      whereClause.discountCategory = discountCategory;
    }

    if (discountType) {
      whereClause.discountType = discountType;
    }

    if (isEnabled !== undefined) {
      whereClause.isEnabled = isEnabled === "true";
    }

    if (requiresVerification !== undefined) {
      whereClause.requiresVerification = requiresVerification === "true";
    }

    // Filter for currently active discounts
    if (activeOnly === "true") {
      const now = new Date();
      whereClause.isEnabled = true;
      whereClause[Op.or] = [
        // Indefinite discounts (no end date)
        {
          [Op.and]: [
            { endDate: null },
            {
              [Op.or]: [
                { startDate: null },
                { startDate: { [Op.lte]: now } }
              ]
            }
          ]
        },
        // Time-bound discounts within range
        {
          [Op.and]: [
            {
              [Op.or]: [
                { startDate: null },
                { startDate: { [Op.lte]: now } }
              ]
            },
            { endDate: { [Op.gte]: now } }
          ]
        }
      ];
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const discounts = await Discount.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id", "name", "sku"],
          through: { attributes: [] }, // Exclude junction table data
        },
      ],
      order: [
        ["priority", "DESC"],
        ["createdAt", "DESC"]
      ],
    });

    return res.status(200).json(discounts);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get discount by ID
exports.getDiscountById = async (req, res) => {
  try {
    const discount = await Discount.findByPk(req.params.id, {
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id", "name", "sku", "price"],
          through: { attributes: [] },
        },
      ],
    });

    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }

    return res.status(200).json(discount);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Create new discount
exports.createDiscount = async (req, res) => {
  try {
    const {
      name,
      description,
      discountType,
      discountValue,
      discountCategory,
      startDate,
      endDate,
      isEnabled,
      requiresVerification,
      applicableTo,
      minimumPurchaseAmount,
      maximumDiscountAmount,
      priority,
      stackable,
      productIds, // Array of product IDs if applicableTo is 'SPECIFIC_PRODUCTS'
    } = req.body;

    // Validate required fields
    if (!name || !discountType || discountValue == null || !discountCategory) {
      return res.status(400).json({
        message:
          "Missing required fields: name, discountType, discountValue, and discountCategory are required",
      });
    }

    // Validate discount value
    if (discountValue < 0) {
      return res.status(400).json({
        message: "Discount value must be non-negative",
      });
    }

    if (discountType === "PERCENTAGE" && discountValue > 100) {
      return res.status(400).json({
        message: "Percentage discount cannot exceed 100%",
      });
    }

    // Validate date range
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        message: "Start date must be before end date",
      });
    }

    // Check if name already exists
    const existingDiscount = await Discount.findOne({ where: { name } });
    if (existingDiscount) {
      return res
        .status(400)
        .json({ message: "Discount with this name already exists" });
    }

    // Create the discount
    const newDiscount = await Discount.create({
      name,
      description,
      discountType,
      discountValue,
      discountCategory,
      startDate: startDate || null,
      endDate: endDate || null,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      requiresVerification: requiresVerification || false,
      applicableTo: applicableTo || "ALL_PRODUCTS",
      minimumPurchaseAmount: minimumPurchaseAmount || null,
      maximumDiscountAmount: maximumDiscountAmount || null,
      priority: priority || 0,
      stackable: stackable || false,
    });

    // If specific products are specified, associate them
    if (applicableTo === "SPECIFIC_PRODUCTS" && productIds && productIds.length > 0) {
      const products = await Product.findAll({
        where: { id: productIds }
      });

      if (products.length !== productIds.length) {
        return res.status(400).json({
          message: "One or more product IDs are invalid"
        });
      }

      await newDiscount.setProducts(products);
    }

    // Fetch the created discount with associations
    const discountWithProducts = await Discount.findByPk(newDiscount.id, {
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id", "name", "sku"],
          through: { attributes: [] },
        },
      ],
    });

    return res.status(201).json(discountWithProducts);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update discount
exports.updateDiscount = async (req, res) => {
  try {
    const {
      name,
      description,
      discountType,
      discountValue,
      discountCategory,
      startDate,
      endDate,
      isEnabled,
      requiresVerification,
      applicableTo,
      minimumPurchaseAmount,
      maximumDiscountAmount,
      priority,
      stackable,
      productIds,
    } = req.body;

    const discountId = req.params.id;

    // Find the discount
    const discount = await Discount.findByPk(discountId);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }

    // Check if updated name already exists (and isn't the current discount)
    if (name && name !== discount.name) {
      const existingDiscount = await Discount.findOne({ where: { name } });
      if (existingDiscount) {
        return res
          .status(400)
          .json({ message: "Discount with this name already exists" });
      }
    }

    // Validate discount value if provided
    const newDiscountType = discountType || discount.discountType;
    const newDiscountValue = discountValue !== undefined ? discountValue : discount.discountValue;

    if (discountValue !== undefined && discountValue < 0) {
      return res.status(400).json({
        message: "Discount value must be non-negative",
      });
    }

    if (newDiscountType === "PERCENTAGE" && newDiscountValue > 100) {
      return res.status(400).json({
        message: "Percentage discount cannot exceed 100%",
      });
    }

    // Validate date range
    const newStartDate = startDate !== undefined ? startDate : discount.startDate;
    const newEndDate = endDate !== undefined ? endDate : discount.endDate;

    if (newStartDate && newEndDate && new Date(newStartDate) > new Date(newEndDate)) {
      return res.status(400).json({
        message: "Start date must be before end date",
      });
    }

    // Update the discount
    await discount.update({
      name: name || discount.name,
      description: description !== undefined ? description : discount.description,
      discountType: discountType || discount.discountType,
      discountValue: discountValue !== undefined ? discountValue : discount.discountValue,
      discountCategory: discountCategory || discount.discountCategory,
      startDate: startDate !== undefined ? startDate : discount.startDate,
      endDate: endDate !== undefined ? endDate : discount.endDate,
      isEnabled: isEnabled !== undefined ? isEnabled : discount.isEnabled,
      requiresVerification: requiresVerification !== undefined ? requiresVerification : discount.requiresVerification,
      applicableTo: applicableTo || discount.applicableTo,
      minimumPurchaseAmount: minimumPurchaseAmount !== undefined ? minimumPurchaseAmount : discount.minimumPurchaseAmount,
      maximumDiscountAmount: maximumDiscountAmount !== undefined ? maximumDiscountAmount : discount.maximumDiscountAmount,
      priority: priority !== undefined ? priority : discount.priority,
      stackable: stackable !== undefined ? stackable : discount.stackable,
    });

    // Update product associations if provided
    if (productIds !== undefined) {
      if (productIds.length === 0) {
        await discount.setProducts([]);
      } else {
        const products = await Product.findAll({
          where: { id: productIds }
        });

        if (products.length !== productIds.length) {
          return res.status(400).json({
            message: "One or more product IDs are invalid"
          });
        }

        await discount.setProducts(products);
      }
    }

    const updatedDiscount = await Discount.findByPk(discountId, {
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id", "name", "sku"],
          through: { attributes: [] },
        },
      ],
    });

    return res.status(200).json(updatedDiscount);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Delete discount
exports.deleteDiscount = async (req, res) => {
  try {
    const discountId = req.params.id;

    const discount = await Discount.findByPk(discountId);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }

    await discount.destroy();
    return res.status(200).json({ message: "Discount deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Toggle discount enabled status
exports.toggleDiscountStatus = async (req, res) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }

    discount.isEnabled = !discount.isEnabled;
    await discount.save();

    res.json({
      message: `Discount ${discount.isEnabled ? "enabled" : "disabled"}`,
      isEnabled: discount.isEnabled,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error toggling discount status", error: error.message });
  }
};

// Get applicable discounts for a specific product
exports.getApplicableDiscounts = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const now = new Date();

    // Find all active discounts
    const discounts = await Discount.findAll({
      where: {
        isEnabled: true,
        [Op.or]: [
          // Indefinite discounts
          {
            [Op.and]: [
              { endDate: null },
              {
                [Op.or]: [
                  { startDate: null },
                  { startDate: { [Op.lte]: now } }
                ]
              }
            ]
          },
          // Time-bound discounts
          {
            [Op.and]: [
              {
                [Op.or]: [
                  { startDate: null },
                  { startDate: { [Op.lte]: now } }
                ]
              },
              { endDate: { [Op.gte]: now } }
            ]
          }
        ]
      },
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id"],
          through: { attributes: [] },
        },
      ],
      order: [["priority", "DESC"]],
    });

    // Filter discounts applicable to this product
    const applicableDiscounts = discounts.filter(discount => {
      if (discount.applicableTo === "ALL_PRODUCTS") {
        return true;
      } else if (discount.applicableTo === "SPECIFIC_PRODUCTS") {
        return discount.products.some(p => p.id === parseInt(productId));
      }
      return false;
    });

    return res.status(200).json(applicableDiscounts);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Calculate discount for a product
exports.calculateProductDiscount = async (req, res) => {
  try {
    const { productId, discountId } = req.params;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const discount = await Discount.findByPk(discountId, {
      include: [
        {
          model: Product,
          as: "products",
          attributes: ["id"],
          through: { attributes: [] },
        },
      ],
    });

    if (!discount) {
      return res.status(404).json({ message: "Discount not found" });
    }

    // Check if discount is active
    if (!discount.isEnabled) {
      return res.status(400).json({ message: "Discount is not enabled" });
    }

    const now = new Date();
    if (discount.startDate && new Date(discount.startDate) > now) {
      return res.status(400).json({ message: "Discount has not started yet" });
    }

    if (discount.endDate && new Date(discount.endDate) < now) {
      return res.status(400).json({ message: "Discount has expired" });
    }

    // Check if applicable to this product
    if (discount.applicableTo === "SPECIFIC_PRODUCTS") {
      const isApplicable = discount.products.some(p => p.id === parseInt(productId));
      if (!isApplicable) {
        return res.status(400).json({ message: "Discount not applicable to this product" });
      }
    }

    // Calculate discount
    let discountAmount = 0;
    if (discount.discountType === "PERCENTAGE") {
      discountAmount = (product.price * discount.discountValue) / 100;
    } else {
      discountAmount = Math.min(discount.discountValue, product.price);
    }

    // Apply maximum discount cap if exists
    if (discount.maximumDiscountAmount) {
      discountAmount = Math.min(discountAmount, discount.maximumDiscountAmount);
    }

    const finalPrice = Math.max(0, product.price - discountAmount);

    return res.status(200).json({
      productId: product.id,
      productName: product.name,
      originalPrice: parseFloat(product.price),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalPrice: parseFloat(finalPrice.toFixed(2)),
      discountName: discount.name,
      discountType: discount.discountType,
      discountValue: parseFloat(discount.discountValue),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};