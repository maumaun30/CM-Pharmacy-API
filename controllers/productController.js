const { Product, Category, BranchStock, Branch } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");

// Get all products with optional filters and branch stock info
exports.getAllProducts = async (req, res) => {
  try {
    const {
      categoryId,
      minPrice,
      maxPrice,
      requiresPrescription,
      search,
      inStock,
      status,
      branchId, // NEW: filter by branch
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

    // Build include for branch stocks
    const branchStockInclude = {
      model: BranchStock,
      as: "branchStocks",
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    };

    // Filter by specific branch if provided
    if (branchId) {
      branchStockInclude.where = { branchId };
    }

    const products = await Product.findAll({
      where: whereClause,
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
        branchStockInclude,
      ],
      order: [["createdAt", "DESC"]],
    });

    // Filter by inStock if requested
    let filteredProducts = products;
    if (inStock === "true") {
      filteredProducts = products.filter((p) => {
        if (branchId) {
          // Check stock for specific branch
          return p.branchStocks.some((bs) => bs.currentStock > 0);
        } else {
          // Check total stock across all branches
          return p.branchStocks.some((bs) => bs.currentStock > 0);
        }
      });
    }

    // Transform response to include stock info
    const response = filteredProducts.map((product) => {
      const productData = product.toJSON();

      // Calculate total stock across all branches
      const totalStock = productData.branchStocks.reduce(
        (sum, bs) => sum + (bs.currentStock || 0),
        0,
      );

      return {
        ...productData,
        totalStock,
        // If filtering by branch, add convenience field
        ...(branchId && productData.branchStocks[0]
          ? { currentStock: productData.branchStocks[0].currentStock }
          : {}),
      };
    });

    return res.status(200).json(response);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get product by ID with branch stock information
exports.getProductById = async (req, res) => {
  try {
    const { branchId } = req.query;

    const includeOptions = [
      {
        model: Category,
        as: "category",
        attributes: ["id", "name"],
      },
      {
        model: BranchStock,
        as: "branchStocks",
        include: [
          {
            model: Branch,
            as: "branch",
            attributes: ["id", "name", "code"],
          },
        ],
      },
    ];

    // Filter by specific branch if provided
    if (branchId) {
      includeOptions[1].where = { branchId };
    }

    const product = await Product.findByPk(req.params.id, {
      include: includeOptions,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const productData = product.toJSON();

    // Calculate total stock
    const totalStock = productData.branchStocks.reduce(
      (sum, bs) => sum + (bs.currentStock || 0),
      0,
    );

    return res.status(200).json({
      ...productData,
      totalStock,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Create new product (and optionally initialize stock for branches)
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      barcode,
      description,
      price,
      cost,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription,
      status,
      categoryId,
      // New: initial stock configuration per branch
      branchStocks, // Array of { branchId, currentStock, minimumStock, reorderPoint }
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

    // Check if barcode already exists
    const existingBarcode = await Product.findOne({ where: { barcode } });
    if (existingBarcode) {
      return res
        .status(400)
        .json({ message: "Product with this barcode already exists" });
    }

    // Check if category exists
    const category = await Category.findByPk(categoryId);
    if (!category) {
      return res.status(400).json({ message: "Category not found" });
    }

    const newProduct = await Product.create({
      name,
      sku,
      barcode,
      description,
      price,
      cost,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription: requiresPrescription || false,
      status: status || "ACTIVE",
      categoryId,
    });

    // Initialize branch stocks if provided
    if (branchStocks && Array.isArray(branchStocks)) {
      for (const branchStock of branchStocks) {
        await BranchStock.create({
          productId: newProduct.id,
          branchId: branchStock.branchId,
          currentStock: branchStock.currentStock || 0,
          minimumStock: branchStock.minimumStock || 10,
          maximumStock: branchStock.maximumStock || null,
          reorderPoint: branchStock.reorderPoint || 20,
        });
      }
    }

    const productWithDetails = await Product.findByPk(newProduct.id, {
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
        {
          model: BranchStock,
          as: "branchStocks",
          include: [
            {
              model: Branch,
              as: "branch",
              attributes: ["id", "name", "code"],
            },
          ],
        },
      ],
    });

    await createLog(
      req,
      "CREATE",
      "products",
      newProduct.id,
      `Created product: ${newProduct.name}`,
      { product: newProduct.toJSON() },
    );

    return res.status(201).json(productWithDetails);
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
      barcode,
      description,
      price,
      cost,
      expiryDate,
      brandName,
      genericName,
      dosage,
      form,
      requiresPrescription,
      status,
      categoryId,
    } = req.body;

    const productId = req.params.id;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if updated SKU already exists
    if (sku && sku !== product.sku) {
      const existingSku = await Product.findOne({ where: { sku } });
      if (existingSku) {
        return res
          .status(400)
          .json({ message: "Product with this SKU already exists" });
      }
    }

    // Check if barcode already exists
    if (barcode && barcode !== product.barcode) {
      const existingBarcode = await Product.findOne({ where: { barcode } });
      if (existingBarcode) {
        return res
          .status(400)
          .json({ message: "Product with this barcode already exists" });
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
      barcode: barcode || product.barcode,
      description:
        description !== undefined ? description : product.description,
      price: price !== undefined ? price : product.price,
      cost: cost !== undefined ? cost : product.cost,
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
      status: status || product.status,
      categoryId: categoryId || product.categoryId,
    });

    const updatedProduct = await Product.findByPk(productId, {
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
        {
          model: BranchStock,
          as: "branchStocks",
          include: [
            {
              model: Branch,
              as: "branch",
              attributes: ["id", "name", "code"],
            },
          ],
        },
      ],
    });

    await createLog(
      req,
      "UPDATE",
      "products",
      productId,
      `Updated product: ${product.name}`,
      {
        before: { ...product._previousDataValues },
        after: { ...product.toJSON() },
      },
    );

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

    await createLog(
      req,
      "DELETE",
      "products",
      productId,
      `Deleted product: ${product.name}`,
      { product: product.toJSON() },
    );

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Toggle product status
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

// NEW: Get product stock for a specific branch
exports.getProductBranchStock = async (req, res) => {
  try {
    const { productId, branchId } = req.params;

    const branchStock = await BranchStock.findOne({
      where: { productId, branchId },
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "barcode", "brandName"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    if (!branchStock) {
      return res.status(404).json({ message: "Branch stock not found" });
    }

    return res.status(200).json(branchStock);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// NEW: Update stock levels for a specific branch
exports.updateBranchStock = async (req, res) => {
  try {
    const { productId, branchId } = req.params;
    const { minimumStock, maximumStock, reorderPoint } = req.body;

    let branchStock = await BranchStock.findOne({
      where: { productId, branchId },
    });

    if (!branchStock) {
      // Create if doesn't exist
      branchStock = await BranchStock.create({
        productId,
        branchId,
        currentStock: 0,
        minimumStock: minimumStock || 10,
        maximumStock: maximumStock || null,
        reorderPoint: reorderPoint || 20,
      });
    } else {
      // Update existing
      await branchStock.update({
        minimumStock:
          minimumStock !== undefined ? minimumStock : branchStock.minimumStock,
        maximumStock:
          maximumStock !== undefined ? maximumStock : branchStock.maximumStock,
        reorderPoint:
          reorderPoint !== undefined ? reorderPoint : branchStock.reorderPoint,
      });
    }

    const updated = await BranchStock.findOne({
      where: { productId, branchId },
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
    });

    return res.status(200).json(updated);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// NEW: Get low stock products per branch
exports.getLowStockProducts = async (req, res) => {
  try {
    const { branchId } = req.query;

    const whereClause = {
      [Op.or]: [
        { currentStock: { [Op.eq]: 0 } },
        sequelize.literal(
          '"BranchStock"."currentStock" <= "BranchStock"."reorderPoint"',
        ),
      ],
    };

    if (branchId) {
      whereClause.branchId = branchId;
    }

    const lowStockItems = await BranchStock.findAll({
      where: whereClause,
      include: [
        {
          model: Product,
          as: "product",
          include: [
            {
              model: Category,
              as: "category",
              attributes: ["id", "name"],
            },
          ],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "code"],
        },
      ],
      order: [["currentStock", "ASC"]],
    });

    return res.status(200).json(lowStockItems);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
