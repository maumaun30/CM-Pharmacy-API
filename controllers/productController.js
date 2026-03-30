const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Shared select strings ────────────────────────────────────────────────────

const PRODUCT_WITH_STOCKS = `
  *,
  category:categories (id, name),
  branch_stocks (
    *,
    branch:branches (id, name, code)
  )
`;

const BRANCH_STOCK_WITH_RELATIONS = `
  *,
  product:products (id, name, sku, brand_name),
  branch:branches  (id, name, code)
`;

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

    let query = supabase
      .from("products")
      .select(PRODUCT_WITH_STOCKS)
      .order("created_at", { ascending: false });

    if (categoryId)              query = query.eq("category_id", categoryId);
    if (status)                  query = query.eq("status", status);
    if (requiresPrescription !== undefined)
      query = query.eq("requires_prescription", requiresPrescription === "true");
    if (minPrice !== undefined)  query = query.gte("price", parseFloat(minPrice));
    if (maxPrice !== undefined)  query = query.lte("price", parseFloat(maxPrice));
    if (search)
      query = query.or(
        `name.ilike.%${search}%,description.ilike.%${search}%,generic_name.ilike.%${search}%,brand_name.ilike.%${search}%`
      );

    const { data: products, error } = await query;
    if (error) throw error;

    // Post-process: filter by branchId and inStock in JS
    let result = products.map((p) => {
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

    const { data: product, error } = await supabase
      .from("products")
      .select(PRODUCT_WITH_STOCKS)
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
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

    // SKU uniqueness
    const { data: existingSku } = await supabase
      .from("products").select("id").eq("sku", sku).maybeSingle();
    if (existingSku) return res.status(400).json({ message: "Product with this SKU already exists" });

    // Barcode uniqueness
    if (barcode) {
      const { data: existingBarcode } = await supabase
        .from("products").select("id").eq("barcode", barcode).maybeSingle();
      if (existingBarcode) return res.status(400).json({ message: "Product with this barcode already exists" });
    }

    // Category existence
    const { data: category } = await supabase
      .from("categories").select("id").eq("id", categoryId).maybeSingle();
    if (!category) return res.status(400).json({ message: "Category not found" });

    // Insert product
    const { data: newProduct, error: insertError } = await supabase
      .from("products")
      .insert({
        name, sku, barcode, description, price, cost,
        expiry_date:           expiryDate || null,
        brand_name:            brandName,
        generic_name:          genericName,
        dosage, form,
        requires_prescription: requiresPrescription || false,
        status:                status || "ACTIVE",
        category_id:           categoryId,
      })
      .select("id, name")
      .single();

    if (insertError) throw insertError;

    // Initialize branch stocks
    let stockRows;
    if (branchStockInput?.length > 0) {
      stockRows = branchStockInput.map((bs) => ({
        product_id:    newProduct.id,
        branch_id:     bs.branchId,
        current_stock: bs.currentStock  || 0,
        minimum_stock: bs.minimumStock  || 10,
        maximum_stock: bs.maximumStock  || null,
        reorder_point: bs.reorderPoint  || 20,
      }));
    } else {
      // Auto-init stock for all branches
      const { data: allBranches, error: branchError } = await supabase
        .from("branches").select("id");
      if (branchError) throw branchError;

      stockRows = allBranches.map((b) => ({
        product_id:    newProduct.id,
        branch_id:     b.id,
        current_stock: 0,
        minimum_stock: 10,
        maximum_stock: null,
        reorder_point: 20,
      }));
    }

    if (stockRows.length > 0) {
      const { error: stockError } = await supabase.from("branch_stocks").insert(stockRows);
      if (stockError) throw stockError;
    }

    // Fetch full product with details
    const { data: productWithDetails, error: fetchError } = await supabase
      .from("products")
      .select(PRODUCT_WITH_STOCKS)
      .eq("id", newProduct.id)
      .single();

    if (fetchError) throw fetchError;

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

    const { data: product, error: fetchError } = await supabase
      .from("products").select("*").eq("id", productId).maybeSingle();

    if (fetchError) throw fetchError;
    if (!product) return res.status(404).json({ message: "Product not found" });

    // SKU uniqueness
    if (sku && sku !== product.sku) {
      const { data: taken } = await supabase
        .from("products").select("id").eq("sku", sku).maybeSingle();
      if (taken) return res.status(400).json({ message: "Product with this SKU already exists" });
    }

    // Barcode uniqueness
    if (barcode && barcode !== product.barcode) {
      const { data: taken } = await supabase
        .from("products").select("id").eq("barcode", barcode).maybeSingle();
      if (taken) return res.status(400).json({ message: "Product with this barcode already exists" });
    }

    // Category existence
    if (categoryId && categoryId !== product.category_id) {
      const { data: cat } = await supabase
        .from("categories").select("id").eq("id", categoryId).maybeSingle();
      if (!cat) return res.status(400).json({ message: "Category not found" });
    }

    const updates = {
      name:                  name                  ?? product.name,
      sku:                   sku                   ?? product.sku,
      barcode:               barcode               !== undefined ? barcode               : product.barcode,
      description:           description           !== undefined ? description           : product.description,
      price:                 price                 !== undefined ? price                 : product.price,
      cost:                  cost                  !== undefined ? cost                  : product.cost,
      expiry_date:           expiryDate            !== undefined ? expiryDate            : product.expiry_date,
      brand_name:            brandName             !== undefined ? brandName             : product.brand_name,
      generic_name:          genericName           !== undefined ? genericName           : product.generic_name,
      dosage:                dosage                !== undefined ? dosage                : product.dosage,
      form:                  form                  !== undefined ? form                  : product.form,
      requires_prescription: requiresPrescription  !== undefined ? requiresPrescription  : product.requires_prescription,
      status:                status                ?? product.status,
      category_id:           categoryId            ?? product.category_id,
    };

    const { error: updateError } = await supabase
      .from("products").update(updates).eq("id", productId);
    if (updateError) throw updateError;

    const { data: updatedProduct, error: fullFetchError } = await supabase
      .from("products").select(PRODUCT_WITH_STOCKS).eq("id", productId).single();
    if (fullFetchError) throw fullFetchError;

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

    const { data: product, error: fetchError } = await supabase
      .from("products").select("id, name").eq("id", productId).maybeSingle();

    if (fetchError) throw fetchError;
    if (!product) return res.status(404).json({ message: "Product not found" });

    const { error } = await supabase.from("products").delete().eq("id", productId);
    if (error) throw error;

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
    const { data: product, error: fetchError } = await supabase
      .from("products").select("id, status").eq("id", req.params.id).maybeSingle();

    if (fetchError) throw fetchError;
    if (!product) return res.status(404).json({ message: "Product not found" });

    const newStatus = product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    const { error } = await supabase
      .from("products").update({ status: newStatus }).eq("id", product.id);
    if (error) throw error;

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

    const { data: branchStock, error } = await supabase
      .from("branch_stocks")
      .select(BRANCH_STOCK_WITH_RELATIONS)
      .eq("product_id", productId)
      .eq("branch_id", branchId)
      .maybeSingle();

    if (error) throw error;
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

    const { data: existing } = await supabase
      .from("branch_stocks")
      .select("*")
      .eq("product_id", productId)
      .eq("branch_id", branchId)
      .maybeSingle();

    if (!existing) {
      // Upsert if not found
      const { error: upsertError } = await supabase
        .from("branch_stocks")
        .insert({
          product_id:    productId,
          branch_id:     branchId,
          current_stock: 0,
          minimum_stock: minimumStock  || 10,
          maximum_stock: maximumStock  || null,
          reorder_point: reorderPoint  || 20,
        });
      if (upsertError) throw upsertError;
    } else {
      const updates = {
        minimum_stock: minimumStock  !== undefined ? minimumStock  : existing.minimum_stock,
        maximum_stock: maximumStock  !== undefined ? maximumStock  : existing.maximum_stock,
        reorder_point: reorderPoint  !== undefined ? reorderPoint  : existing.reorder_point,
      };
      const { error: updateError } = await supabase
        .from("branch_stocks")
        .update(updates)
        .eq("product_id", productId)
        .eq("branch_id", branchId);
      if (updateError) throw updateError;
    }

    const { data: updated, error: fetchError } = await supabase
      .from("branch_stocks")
      .select(BRANCH_STOCK_WITH_RELATIONS)
      .eq("product_id", productId)
      .eq("branch_id", branchId)
      .single();

    if (fetchError) throw fetchError;

    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Low Stock Products ───────────────────────────────────────────────────

exports.getLowStockProducts = async (req, res) => {
  try {
    const { branchId } = req.query;

    let query = supabase
      .from("branch_stocks")
      .select(`
        *,
        product:products (
          *, category:categories (id, name)
        ),
        branch:branches (id, name, code)
      `)
      .order("current_stock", { ascending: true });

    if (branchId) query = query.eq("branch_id", branchId);

    const { data: allStocks, error } = await query;
    if (error) throw error;

    // Column-to-column comparison done in JS
    const lowStock = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    return res.status(200).json(lowStock);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};