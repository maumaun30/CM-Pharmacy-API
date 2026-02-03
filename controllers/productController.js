const { Product, Category } = require("../models");
const { Op } = require("sequelize");

// Get all products with optional filters
exports.getAllProducts = async (req, res) => {
  try {
    const {
      categoryId,
      minPrice,
      maxPrice,
      requiresPrescription,
      search,
      inStock,
      status, // NEW: filter by status
    } = req.query;

    const whereClause = {};

    if (categoryId) {
      whereClause.categoryId = categoryId;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      whereClause.price = {};
      if (minPrice !== undefined) {
        whereClause.price[Op.gte] = parseFloat(minPrice);
      }
      if (maxPrice !== undefined) {
        whereClause.price[Op.lte] = parseFloat(maxPrice);
      }
    }

    if (requiresPrescription !== undefined) {
      whereClause.requiresPrescription = requiresPrescription === "true";
    }

    if (inStock === "true") {
      whereClause.quantity = { [Op.gt]: 0 };
    }

    // NEW: Filter by status
    if (status) {
      whereClause.status = status;
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { genericName: { [Op.iLike]: `%${search}%` } },
        { brandName: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const products = await Product.findAll({
      where: whereClause,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json(products);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json(product);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Create new product
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      description,
      price,
      cost,
      quantity,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription,
      status, // NEW
      categoryId,
    } = req.body;

    // Validate required fields
    if (!name || !sku || !price || !cost || !categoryId) {
      return res.status(400).json({
        message:
          "Missing required fields: name, sku, price, cost and categoryId are required",
      });
    }

    // Check if SKU already exists
    const existingSku = await Product.findOne({ where: { sku } });
    if (existingSku) {
      return res
        .status(400)
        .json({ message: "Product with this SKU already exists" });
    }

    // Check if category exists
    const category = await Category.findByPk(categoryId);
    if (!category) {
      return res.status(400).json({ message: "Category not found" });
    }

    const newProduct = await Product.create({
      name,
      sku,
      description,
      price,
      cost,
      quantity: quantity || 0,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription: requiresPrescription || false,
      status: status || "ACTIVE", // NEW
      categoryId,
    });

    const productWithCategory = await Product.findByPk(newProduct.id, {
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
      ],
    });

    return res.status(201).json(productWithCategory);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update product
exports.updateProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      description,
      price,
      cost,
      quantity,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription,
      status, // NEW
      categoryId,
    } = req.body;

    const productId = req.params.id;

    // Find the product
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if updated SKU already exists (and isn't the current product)
    if (sku && sku !== product.sku) {
      const existingSku = await Product.findOne({ where: { sku } });
      if (existingSku) {
        return res
          .status(400)
          .json({ message: "Product with this SKU already exists" });
      }
    }

    // Check if category exists if updated
    if (categoryId && categoryId !== product.categoryId) {
      const category = await Category.findByPk(categoryId);
      if (!category) {
        return res.status(400).json({ message: "Category not found" });
      }
    }

    await product.update({
      name: name || product.name,
      sku: sku || product.sku,
      description:
        description !== undefined ? description : product.description,
      price: price !== undefined ? price : product.price,
      cost: cost !== undefined ? cost : product.cost,
      quantity: quantity !== undefined ? quantity : product.quantity,
      expiryDate: expiryDate !== undefined ? expiryDate : product.expiryDate,
      brandName: brandName !== undefined ? brandName : product.brandName,
      genericName:
        genericName !== undefined ? genericName : product.genericName,
      dosage: dosage !== undefined ? dosage : product.dosage,
      form: form !== undefined ? form : product.form,
      requiresPrescription:
        requiresPrescription !== undefined
          ? requiresPrescription
          : product.requiresPrescription,
      status: status || product.status, // NEW
      categoryId: categoryId || product.categoryId,
    });

    const updatedProduct = await Product.findByPk(productId, {
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
      ],
    });

    return res.status(200).json(updatedProduct);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await product.destroy();
    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

exports.updateStock = async (req, res) => {
  try {
    const { quantity } = req.body;

    if (quantity == null || quantity < 0) {
      return res.status(400).json({ message: "Invalid quantity" });
    }

    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.quantity = quantity;
    await product.save();

    res.json({ message: "Stock updated", quantity: product.quantity });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating stock", error: error.message });
  }
};

// NEW: Toggle product status
exports.toggleProductStatus = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.status = product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await product.save();

    res.json({
      message: `Product ${product.status === "ACTIVE" ? "activated" : "deactivated"}`,
      status: product.status,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error toggling product status", error: error.message });
  }
};