const { and, or, eq, ilike, gte, lte, desc, asc, inArray } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { productFull, branchStockFull } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { products, categories, branchStocks, branches } = schema;

const categoryMini = { id: categories.id, name: categories.name };
const branchMini = { id: branches.id, name: branches.name, code: branches.code };

// Attach `branch_stocks[]` (each with nested `branch`) to product rows,
// reproducing the supabase PRODUCT_WITH_STOCKS nested shape.
async function attachStocks(productRows) {
  if (productRows.length === 0) return productRows;
  const ids = productRows.map((p) => p.id);

  const stockRows = await db
    .select({ ...branchStockFull, branch: branchMini })
    .from(branchStocks)
    .leftJoin(branches, eq(branchStocks.branchId, branches.id))
    .where(inArray(branchStocks.productId, ids));

  const byProduct = new Map();
  for (const s of stockRows) {
    s.branch = s.branch?.id ? s.branch : null;
    if (!byProduct.has(s.product_id)) byProduct.set(s.product_id, []);
    byProduct.get(s.product_id).push(s);
  }

  return productRows.map((p) => ({ ...p, branch_stocks: byProduct.get(p.id) || [] }));
}

// Single product with category + branch_stocks(with branch). Returns null if missing.
async function fetchProductWithStocks(id) {
  const [product] = await db
    .select({ ...productFull, category: categoryMini })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .limit(1);
  if (!product) return null;
  const [withStocks] = await attachStocks([product]);
  return withStocks;
}

// ─── Get All Products ─────────────────────────────────────────────────────────

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
      branchId,
    } = req.query;

    const conds = [];
    if (categoryId) conds.push(eq(products.categoryId, categoryId));
    if (status) conds.push(eq(products.status, status));
    if (requiresPrescription !== undefined)
      conds.push(eq(products.requiresPrescription, requiresPrescription === "true"));
    if (minPrice !== undefined) conds.push(gte(products.price, parseFloat(minPrice)));
    if (maxPrice !== undefined) conds.push(lte(products.price, parseFloat(maxPrice)));
    if (search)
      conds.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.genericName, `%${search}%`),
          ilike(products.brandName, `%${search}%`)
        )
      );

    const productRows = await db
      .select({ ...productFull, category: categoryMini })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(products.createdAt));

    const withStocks = await attachStocks(productRows);

    // Post-process: branchId filter, totalStock, inStock (matches prior JS).
    let result = withStocks.map((p) => {
      const stocks = branchId
        ? p.branch_stocks.filter((bs) => String(bs.branch_id) === String(branchId))
        : p.branch_stocks;

      const totalStock = stocks.reduce((sum, bs) => sum + (bs.current_stock || 0), 0);

      return {
        ...p,
        branch_stocks: stocks,
        totalStock,
        ...(branchId && stocks[0] ? { currentStock: stocks[0].current_stock } : {}),
      };
    });

    if (inStock === "true") {
      result = result.filter((p) =>
        p.branch_stocks.some((bs) => bs.current_stock > 0)
      );
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Product By ID ────────────────────────────────────────────────────────

exports.getProductById = async (req, res) => {
  try {
    const { branchId } = req.query;

    const product = await fetchProductWithStocks(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const stocks = branchId
      ? product.branch_stocks.filter((bs) => String(bs.branch_id) === String(branchId))
      : product.branch_stocks;

    const totalStock = stocks.reduce((sum, bs) => sum + (bs.current_stock || 0), 0);

    return res.status(200).json({ ...product, branch_stocks: stocks, totalStock });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Create Product ───────────────────────────────────────────────────────────

exports.createProduct = async (req, res) => {
  try {
    const {
      name, sku, barcode, description, price, cost,
      expiryDate, brandName, genericName, dosage, form,
      requiresPrescription, status, categoryId,
      branchStocks: branchStockInput,
    } = req.body;

    if (!name || !sku || price == null || cost == null || !categoryId) {
      return res.status(400).json({
        message: "Missing required fields: name, sku, price, cost and categoryId are required",
      });
    }

    const [existingSku] = await db
      .select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1);
    if (existingSku) return res.status(400).json({ message: "Product with this SKU already exists" });

    if (barcode) {
      const [existingBarcode] = await db
        .select({ id: products.id }).from(products).where(eq(products.barcode, barcode)).limit(1);
      if (existingBarcode) return res.status(400).json({ message: "Product with this barcode already exists" });
    }

    const [category] = await db
      .select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!category) return res.status(400).json({ message: "Category not found" });

    const [newProduct] = await db
      .insert(products)
      .values({
        name, sku, barcode, description, price, cost,
        expiryDate: expiryDate || null,
        brandName,
        genericName,
        dosage, form,
        requiresPrescription: requiresPrescription || false,
        status: status || "ACTIVE",
        categoryId,
      })
      .returning({ id: products.id, name: products.name });

    // Initialize branch stocks (explicit input, or auto-init for all branches).
    let stockRows;
    if (branchStockInput?.length > 0) {
      stockRows = branchStockInput.map((bs) => ({
        productId: newProduct.id,
        branchId: bs.branchId,
        currentStock: bs.currentStock || 0,
        minimumStock: bs.minimumStock || 10,
        maximumStock: bs.maximumStock || null,
        reorderPoint: bs.reorderPoint || 20,
      }));
    } else {
      const allBranches = await db.select({ id: branches.id }).from(branches);
      stockRows = allBranches.map((b) => ({
        productId: newProduct.id,
        branchId: b.id,
        currentStock: 0,
        minimumStock: 10,
        maximumStock: null,
        reorderPoint: 20,
      }));
    }

    if (stockRows.length > 0) {
      await db.insert(branchStocks).values(stockRows);
    }

    const productWithDetails = await fetchProductWithStocks(newProduct.id);

    await createLog(
      req, "CREATE", "products", newProduct.id,
      `Created product: ${newProduct.name}`,
      { product: newProduct }
    );

    return res.status(201).json(productWithDetails);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Product ───────────────────────────────────────────────────────────

exports.updateProduct = async (req, res) => {
  try {
    const {
      name, sku, barcode, description, price, cost,
      expiryDate, brandName, genericName, dosage, form,
      requiresPrescription, status, categoryId,
    } = req.body;
    const productId = req.params.id;

    const [product] = await db
      .select(productFull).from(products).where(eq(products.id, productId)).limit(1);

    if (!product) return res.status(404).json({ message: "Product not found" });

    if (sku && sku !== product.sku) {
      const [taken] = await db
        .select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1);
      if (taken) return res.status(400).json({ message: "Product with this SKU already exists" });
    }

    if (barcode && barcode !== product.barcode) {
      const [taken] = await db
        .select({ id: products.id }).from(products).where(eq(products.barcode, barcode)).limit(1);
      if (taken) return res.status(400).json({ message: "Product with this barcode already exists" });
    }

    if (categoryId && categoryId !== product.category_id) {
      const [cat] = await db
        .select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
      if (!cat) return res.status(400).json({ message: "Category not found" });
    }

    // camelCase keys for Drizzle .set(); fall back to existing (snake) values.
    const updates = {
      name:                 name                 ?? product.name,
      sku:                  sku                  ?? product.sku,
      barcode:              barcode              !== undefined ? barcode              : product.barcode,
      description:          description          !== undefined ? description          : product.description,
      price:                price                !== undefined ? price                : product.price,
      cost:                 cost                 !== undefined ? cost                 : product.cost,
      expiryDate:           expiryDate           !== undefined ? expiryDate           : product.expiry_date,
      brandName:            brandName            !== undefined ? brandName            : product.brand_name,
      genericName:          genericName          !== undefined ? genericName          : product.generic_name,
      dosage:               dosage               !== undefined ? dosage               : product.dosage,
      form:                 form                 !== undefined ? form                 : product.form,
      requiresPrescription: requiresPrescription !== undefined ? requiresPrescription : product.requires_prescription,
      status:               status               ?? product.status,
      categoryId:           categoryId           ?? product.category_id,
    };

    await db.update(products).set(updates).where(eq(products.id, productId));

    const updatedProduct = await fetchProductWithStocks(productId);

    await createLog(
      req, "UPDATE", "products", productId,
      `Updated product: ${product.name}`,
      { before: product, after: updates }
    );

    return res.status(200).json(updatedProduct);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete Product ───────────────────────────────────────────────────────────

exports.deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const [product] = await db
      .select({ id: products.id, name: products.name }).from(products).where(eq(products.id, productId)).limit(1);

    if (!product) return res.status(404).json({ message: "Product not found" });

    await db.delete(products).where(eq(products.id, productId));

    await createLog(
      req, "DELETE", "products", productId,
      `Deleted product: ${product.name}`,
      { product }
    );

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Toggle Product Status ────────────────────────────────────────────────────

exports.toggleProductStatus = async (req, res) => {
  try {
    const [product] = await db
      .select({ id: products.id, status: products.status }).from(products).where(eq(products.id, req.params.id)).limit(1);

    if (!product) return res.status(404).json({ message: "Product not found" });

    const newStatus = product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    await db.update(products).set({ status: newStatus }).where(eq(products.id, product.id));

    return res.json({
      message: `Product ${newStatus === "ACTIVE" ? "activated" : "deactivated"}`,
      status: newStatus,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error toggling product status", error: error.message });
  }
};

// ─── Get Product Branch Stock ─────────────────────────────────────────────────

exports.getProductBranchStock = async (req, res) => {
  try {
    const { productId, branchId } = req.params;

    const [branchStock] = await db
      .select({
        ...branchStockFull,
        product: { id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName },
        branch: branchMini,
      })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)))
      .limit(1);

    if (!branchStock) return res.status(404).json({ message: "Branch stock not found" });

    return res.status(200).json(branchStock);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Branch Stock Settings ────────────────────────────────────────────

exports.updateBranchStock = async (req, res) => {
  try {
    const { productId, branchId } = req.params;
    const { minimumStock, maximumStock, reorderPoint } = req.body;

    const [existing] = await db
      .select(branchStockFull)
      .from(branchStocks)
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)))
      .limit(1);

    if (!existing) {
      await db.insert(branchStocks).values({
        productId,
        branchId,
        currentStock: 0,
        minimumStock: minimumStock || 10,
        maximumStock: maximumStock || null,
        reorderPoint: reorderPoint || 20,
      });
    } else {
      const updates = {
        minimumStock: minimumStock !== undefined ? minimumStock : existing.minimum_stock,
        maximumStock: maximumStock !== undefined ? maximumStock : existing.maximum_stock,
        reorderPoint: reorderPoint !== undefined ? reorderPoint : existing.reorder_point,
      };
      await db
        .update(branchStocks)
        .set(updates)
        .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)));
    }

    const [updated] = await db
      .select({
        ...branchStockFull,
        product: { id: products.id, name: products.name, sku: products.sku, brand_name: products.brandName },
        branch: branchMini,
      })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(and(eq(branchStocks.productId, productId), eq(branchStocks.branchId, branchId)))
      .limit(1);

    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Low Stock Products ───────────────────────────────────────────────────

exports.getLowStockProducts = async (req, res) => {
  try {
    const { branchId } = req.query;

    const conds = [];
    if (branchId) conds.push(eq(branchStocks.branchId, branchId));

    const rows = await db
      .select({
        ...branchStockFull,
        product: { ...productFull, category: categoryMini },
        branch: branchMini,
      })
      .from(branchStocks)
      .leftJoin(products, eq(branchStocks.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(branches, eq(branchStocks.branchId, branches.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(branchStocks.currentStock));

    // Column-to-column comparison done in JS (matches prior behavior).
    const lowStock = rows.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    return res.status(200).json(lowStock);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
