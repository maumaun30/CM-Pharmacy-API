const { and, eq, or, ilike, inArray, desc } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { discountFull } = require("../db/projections");
const { createLog } = require("../middleware/logMiddleware");

const { discounts, products, categories, productDiscounts, categoryDiscounts } = schema;

// Attach flattened `products[]` / `categories[]` to discount rows,
// reproducing the supabase DISCOUNT_WITH_JOINS + flattenDiscount output.
async function attachAssociations(discountRows, withPrice = false) {
  if (discountRows.length === 0) return discountRows;
  const ids = discountRows.map((d) => d.id);

  const prodSel = withPrice
    ? { id: products.id, name: products.name, sku: products.sku, price: products.price }
    : { id: products.id, name: products.name, sku: products.sku };

  const prodRows = await db
    .select({ discount_id: productDiscounts.discountId, product: prodSel })
    .from(productDiscounts)
    .innerJoin(products, eq(productDiscounts.productId, products.id))
    .where(inArray(productDiscounts.discountId, ids));

  const catRows = await db
    .select({ discount_id: categoryDiscounts.discountId, category: { id: categories.id, name: categories.name } })
    .from(categoryDiscounts)
    .innerJoin(categories, eq(categoryDiscounts.categoryId, categories.id))
    .where(inArray(categoryDiscounts.discountId, ids));

  const prodByD = new Map();
  for (const r of prodRows) {
    if (!prodByD.has(r.discount_id)) prodByD.set(r.discount_id, []);
    prodByD.get(r.discount_id).push(r.product);
  }
  const catByD = new Map();
  for (const r of catRows) {
    if (!catByD.has(r.discount_id)) catByD.set(r.discount_id, []);
    catByD.get(r.discount_id).push(r.category);
  }

  return discountRows.map((d) => ({
    ...d,
    products: prodByD.get(d.id) || [],
    categories: catByD.get(d.id) || [],
  }));
}

// Active-date filter (JS: complex date/null logic).
function isDiscountActive(d) {
  const now = new Date();
  const started = !d.start_date || new Date(d.start_date) <= now;
  const notExpired = !d.end_date || new Date(d.end_date) >= now;
  return d.is_enabled && started && notExpired;
}

// Validate a list of ids exists in a table; returns true if all present.
async function allExist(table, ids) {
  const rows = await db.select({ id: table.id }).from(table).where(inArray(table.id, ids));
  return rows.length === ids.length;
}

// ─── Get All Discounts ────────────────────────────────────────────────────────

exports.getAllDiscounts = async (req, res) => {
  try {
    const { discountCategory, discountType, isEnabled, requiresVerification, activeOnly, search } = req.query;

    const conds = [];
    if (discountCategory) conds.push(eq(discounts.discountCategory, discountCategory));
    if (discountType) conds.push(eq(discounts.discountType, discountType));
    if (isEnabled !== undefined) conds.push(eq(discounts.isEnabled, isEnabled === "true"));
    if (requiresVerification !== undefined)
      conds.push(eq(discounts.requiresVerification, requiresVerification === "true"));
    if (search)
      conds.push(or(ilike(discounts.name, `%${search}%`), ilike(discounts.description, `%${search}%`)));

    const rows = await db
      .select(discountFull)
      .from(discounts)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(discounts.priority), desc(discounts.createdAt));

    let result = await attachAssociations(rows);

    if (activeOnly === "true") {
      result = result.filter(isDiscountActive);
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Discount By ID ───────────────────────────────────────────────────────

exports.getDiscountById = async (req, res) => {
  try {
    const [discount] = await db
      .select(discountFull)
      .from(discounts)
      .where(eq(discounts.id, req.params.id))
      .limit(1);

    if (!discount) return res.status(404).json({ message: "Discount not found" });

    const [full] = await attachAssociations([discount], true);
    return res.status(200).json(full);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Create Discount ──────────────────────────────────────────────────────────

exports.createDiscount = async (req, res) => {
  try {
    const {
      name, description, discountType, discountValue, discountCategory,
      startDate, endDate, isEnabled, requiresVerification, applicableTo,
      minimumPurchaseAmount, maximumDiscountAmount, priority, stackable,
      productIds, categoryIds,
    } = req.body;

    if (!name || !discountType || discountValue == null || !discountCategory) {
      return res.status(400).json({
        message: "Missing required fields: name, discountType, discountValue, and discountCategory are required",
      });
    }
    if (discountValue < 0) {
      return res.status(400).json({ message: "Discount value must be non-negative" });
    }
    if (discountType === "PERCENTAGE" && discountValue > 100) {
      return res.status(400).json({ message: "Percentage discount cannot exceed 100%" });
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ message: "Start date must be before end date" });
    }

    const [existing] = await db
      .select({ id: discounts.id }).from(discounts).where(eq(discounts.name, name)).limit(1);
    if (existing) {
      return res.status(400).json({ message: "Discount with this name already exists" });
    }

    const [newDiscount] = await db
      .insert(discounts)
      .values({
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
      })
      .returning({ id: discounts.id });

    if (applicableTo === "CATEGORIES" && categoryIds?.length > 0) {
      if (!(await allExist(categories, categoryIds))) {
        return res.status(400).json({ message: "One or more category IDs are invalid" });
      }
      await db.insert(categoryDiscounts).values(categoryIds.map((cid) => ({ categoryId: cid, discountId: newDiscount.id })));
    }

    if (applicableTo === "SPECIFIC_PRODUCTS" && productIds?.length > 0) {
      if (!(await allExist(products, productIds))) {
        return res.status(400).json({ message: "One or more product IDs are invalid" });
      }
      await db.insert(productDiscounts).values(productIds.map((pid) => ({ productId: pid, discountId: newDiscount.id })));
    }

    const [discount] = await db
      .select(discountFull).from(discounts).where(eq(discounts.id, newDiscount.id)).limit(1);
    const [full] = await attachAssociations([discount]);

    return res.status(201).json(full);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Discount ──────────────────────────────────────────────────────────

exports.updateDiscount = async (req, res) => {
  try {
    const {
      name, description, discountType, discountValue, discountCategory,
      startDate, endDate, isEnabled, requiresVerification, applicableTo,
      minimumPurchaseAmount, maximumDiscountAmount, priority, stackable,
      productIds, categoryIds,
    } = req.body;
    const discountId = req.params.id;

    const [discount] = await db
      .select(discountFull).from(discounts).where(eq(discounts.id, discountId)).limit(1);

    if (!discount) return res.status(404).json({ message: "Discount not found" });

    if (name && name !== discount.name) {
      const [taken] = await db
        .select({ id: discounts.id }).from(discounts).where(eq(discounts.name, name)).limit(1);
      if (taken) return res.status(400).json({ message: "Discount with this name already exists" });
    }

    const newDiscountType  = discountType  ?? discount.discount_type;
    const newDiscountValue = discountValue ?? discount.discount_value;

    if (discountValue !== undefined && discountValue < 0) {
      return res.status(400).json({ message: "Discount value must be non-negative" });
    }
    if (newDiscountType === "PERCENTAGE" && newDiscountValue > 100) {
      return res.status(400).json({ message: "Percentage discount cannot exceed 100%" });
    }

    const newStartDate = startDate !== undefined ? startDate : discount.start_date;
    const newEndDate   = endDate   !== undefined ? endDate   : discount.end_date;
    if (newStartDate && newEndDate && new Date(newStartDate) > new Date(newEndDate)) {
      return res.status(400).json({ message: "Start date must be before end date" });
    }

    // camelCase keys for Drizzle .set(); fall back to existing (snake) values.
    const updates = {
      name:                  name                  ?? discount.name,
      description:           description            !== undefined ? description            : discount.description,
      discountType:          discountType           ?? discount.discount_type,
      discountValue:         discountValue          !== undefined ? discountValue          : discount.discount_value,
      discountCategory:      discountCategory       ?? discount.discount_category,
      startDate:             startDate              !== undefined ? startDate              : discount.start_date,
      endDate:               endDate                !== undefined ? endDate                : discount.end_date,
      isEnabled:             isEnabled              !== undefined ? isEnabled              : discount.is_enabled,
      requiresVerification:  requiresVerification   !== undefined ? requiresVerification   : discount.requires_verification,
      applicableTo:          applicableTo           ?? discount.applicable_to,
      minimumPurchaseAmount: minimumPurchaseAmount  !== undefined ? minimumPurchaseAmount  : discount.minimum_purchase_amount,
      maximumDiscountAmount: maximumDiscountAmount  !== undefined ? maximumDiscountAmount  : discount.maximum_discount_amount,
      priority:              priority               !== undefined ? priority               : discount.priority,
      stackable:             stackable              !== undefined ? stackable              : discount.stackable,
    };

    await db.update(discounts).set(updates).where(eq(discounts.id, discountId));

    // Sync category associations.
    if (categoryIds !== undefined) {
      await db.delete(categoryDiscounts).where(eq(categoryDiscounts.discountId, discountId));
      if (categoryIds.length > 0) {
        if (!(await allExist(categories, categoryIds))) {
          return res.status(400).json({ message: "One or more category IDs are invalid" });
        }
        await db.insert(categoryDiscounts).values(categoryIds.map((cid) => ({ categoryId: cid, discountId })));
      }
    }

    // Sync product associations.
    if (productIds !== undefined) {
      await db.delete(productDiscounts).where(eq(productDiscounts.discountId, discountId));
      if (productIds.length > 0) {
        if (!(await allExist(products, productIds))) {
          return res.status(400).json({ message: "One or more product IDs are invalid" });
        }
        await db.insert(productDiscounts).values(productIds.map((pid) => ({ productId: pid, discountId })));
      }
    }

    const [updated] = await db
      .select(discountFull).from(discounts).where(eq(discounts.id, discountId)).limit(1);
    const [full] = await attachAssociations([updated]);

    return res.status(200).json(full);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete Discount ──────────────────────────────────────────────────────────

exports.deleteDiscount = async (req, res) => {
  try {
    const discountId = req.params.id;

    const [discount] = await db
      .select({ id: discounts.id }).from(discounts).where(eq(discounts.id, discountId)).limit(1);

    if (!discount) return res.status(404).json({ message: "Discount not found" });

    // Junction rows are deleted via ON DELETE CASCADE in the DB.
    await db.delete(discounts).where(eq(discounts.id, discountId));

    return res.status(200).json({ message: "Discount deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Toggle Discount Status ───────────────────────────────────────────────────

exports.toggleDiscountStatus = async (req, res) => {
  try {
    const [discount] = await db
      .select({ id: discounts.id, is_enabled: discounts.isEnabled })
      .from(discounts)
      .where(eq(discounts.id, req.params.id))
      .limit(1);

    if (!discount) return res.status(404).json({ message: "Discount not found" });

    const newStatus = !discount.is_enabled;

    await db.update(discounts).set({ isEnabled: newStatus }).where(eq(discounts.id, discount.id));

    return res.json({
      message: `Discount ${newStatus ? "enabled" : "disabled"}`,
      isEnabled: newStatus,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error toggling discount status", error: error.message });
  }
};

// ─── Get Applicable Discounts For Product ────────────────────────────────────

exports.getApplicableDiscounts = async (req, res) => {
  try {
    const { productId } = req.params;

    const [product] = await db
      .select({ id: products.id, category_id: products.categoryId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) return res.status(404).json({ message: "Product not found" });

    const rows = await db
      .select(discountFull)
      .from(discounts)
      .where(eq(discounts.isEnabled, true))
      .orderBy(desc(discounts.priority));

    const enriched = await attachAssociations(rows);

    const applicable = enriched.filter((d) => {
      if (!isDiscountActive(d)) return false;
      if (d.applicable_to === "ALL_PRODUCTS") return true;
      if (d.applicable_to === "SPECIFIC_PRODUCTS") {
        return d.products.some((p) => String(p.id) === String(productId));
      }
      if (d.applicable_to === "CATEGORIES") {
        return d.categories.some((c) => String(c.id) === String(product.category_id));
      }
      return false;
    });

    return res.status(200).json(applicable);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Calculate Product Discount ───────────────────────────────────────────────

exports.calculateProductDiscount = async (req, res) => {
  try {
    const { productId, discountId } = req.params;

    const [[product], [discountRaw]] = await Promise.all([
      db.select({ id: products.id, name: products.name, price: products.price, category_id: products.categoryId })
        .from(products).where(eq(products.id, productId)).limit(1),
      db.select(discountFull).from(discounts).where(eq(discounts.id, discountId)).limit(1),
    ]);

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!discountRaw) return res.status(404).json({ message: "Discount not found" });

    const [discount] = await attachAssociations([discountRaw]);

    if (!discount.is_enabled) {
      return res.status(400).json({ message: "Discount is not enabled" });
    }

    const now = new Date();
    if (discount.start_date && new Date(discount.start_date) > now) {
      return res.status(400).json({ message: "Discount has not started yet" });
    }
    if (discount.end_date && new Date(discount.end_date) < now) {
      return res.status(400).json({ message: "Discount has expired" });
    }

    if (discount.applicable_to === "SPECIFIC_PRODUCTS") {
      const ok = discount.products.some((p) => String(p.id) === String(productId));
      if (!ok) return res.status(400).json({ message: "Discount not applicable to this product" });
    } else if (discount.applicable_to === "CATEGORIES") {
      const ok = discount.categories.some((c) => String(c.id) === String(product.category_id));
      if (!ok) return res.status(400).json({ message: "Discount not applicable to this product" });
    }

    let discountAmount =
      discount.discount_type === "PERCENTAGE"
        ? (product.price * discount.discount_value) / 100
        : Math.min(discount.discount_value, product.price);

    if (discount.maximum_discount_amount) {
      discountAmount = Math.min(discountAmount, discount.maximum_discount_amount);
    }

    const finalPrice = Math.max(0, product.price - discountAmount);

    return res.status(200).json({
      productId:      product.id,
      productName:    product.name,
      originalPrice:  parseFloat(product.price),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalPrice:     parseFloat(finalPrice.toFixed(2)),
      discountName:   discount.name,
      discountType:   discount.discount_type,
      discountValue:  parseFloat(discount.discount_value),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
