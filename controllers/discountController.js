const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Shared select for discounts with junction table joins ────────────────────

const DISCOUNT_WITH_JOINS = `
  *,
  products:product_discounts (
    product:products (id, name, sku)
  ),
  categories:category_discounts (
    category:categories (id, name)
  )
`;

const DISCOUNT_WITH_JOINS_PRICE = `
  *,
  products:product_discounts (
    product:products (id, name, sku, price)
  ),
  categories:category_discounts (
    category:categories (id, name)
  )
`;

// Flatten nested junction table results into flat arrays
function flattenDiscount(d) {
  return {
    ...d,
    products:   (d.products   || []).map((r) => r.product).filter(Boolean),
    categories: (d.categories || []).map((r) => r.category).filter(Boolean),
  };
}

// ─── Active discount date filter helper ──────────────────────────────────────
// Applied in JS after fetch since Supabase JS can't express OR groups with
// mixed null/date conditions cleanly in a single filter chain.

function isDiscountActive(d) {
  const now = new Date();
  const started = !d.start_date || new Date(d.start_date) <= now;
  const notExpired = !d.end_date || new Date(d.end_date) >= now;
  return d.is_enabled && started && notExpired;
}

// ─── Get All Discounts ────────────────────────────────────────────────────────

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

    let query = supabase
      .from("discounts")
      .select(DISCOUNT_WITH_JOINS)
      .order("priority",    { ascending: false })
      .order("created_at",  { ascending: false });

    if (discountCategory)       query = query.eq("discount_category", discountCategory);
    if (discountType)           query = query.eq("discount_type", discountType);
    if (isEnabled !== undefined) query = query.eq("is_enabled", isEnabled === "true");
    if (requiresVerification !== undefined)
      query = query.eq("requires_verification", requiresVerification === "true");
    if (search)
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    let discounts = data.map(flattenDiscount);

    // activeOnly filter done in JS (complex date/null logic)
    if (activeOnly === "true") {
      discounts = discounts.filter(isDiscountActive);
    }

    return res.status(200).json(discounts);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Discount By ID ───────────────────────────────────────────────────────

exports.getDiscountById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("discounts")
      .select(DISCOUNT_WITH_JOINS_PRICE)
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Discount not found" });

    return res.status(200).json(flattenDiscount(data));
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

    // Validation
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

    // Check name uniqueness
    const { data: existing } = await supabase
      .from("discounts")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ message: "Discount with this name already exists" });
    }

    // Insert discount
    const { data: newDiscount, error: insertError } = await supabase
      .from("discounts")
      .insert({
        name,
        description,
        discount_type:            discountType,
        discount_value:           discountValue,
        discount_category:        discountCategory,
        start_date:               startDate || null,
        end_date:                 endDate || null,
        is_enabled:               isEnabled !== undefined ? isEnabled : true,
        requires_verification:    requiresVerification || false,
        applicable_to:            applicableTo || "ALL_PRODUCTS",
        minimum_purchase_amount:  minimumPurchaseAmount || null,
        maximum_discount_amount:  maximumDiscountAmount || null,
        priority:                 priority || 0,
        stackable:                stackable || false,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    // Associate categories
    if (applicableTo === "CATEGORIES" && categoryIds?.length > 0) {
      const { data: validCats } = await supabase
        .from("categories")
        .select("id")
        .in("id", categoryIds);

      if (!validCats || validCats.length !== categoryIds.length) {
        return res.status(400).json({ message: "One or more category IDs are invalid" });
      }

      const { error: catError } = await supabase
        .from("category_discounts")
        .insert(categoryIds.map((cid) => ({ category_id: cid, discount_id: newDiscount.id })));
      if (catError) throw catError;
    }

    // Associate products
    if (applicableTo === "SPECIFIC_PRODUCTS" && productIds?.length > 0) {
      const { data: validProds } = await supabase
        .from("products")
        .select("id")
        .in("id", productIds);

      if (!validProds || validProds.length !== productIds.length) {
        return res.status(400).json({ message: "One or more product IDs are invalid" });
      }

      const { error: prodError } = await supabase
        .from("product_discounts")
        .insert(productIds.map((pid) => ({ product_id: pid, discount_id: newDiscount.id })));
      if (prodError) throw prodError;
    }

    // Return full record with associations
    const { data: full, error: fetchError } = await supabase
      .from("discounts")
      .select(DISCOUNT_WITH_JOINS)
      .eq("id", newDiscount.id)
      .single();

    if (fetchError) throw fetchError;

    return res.status(201).json(flattenDiscount(full));
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

    const { data: discount, error: fetchError } = await supabase
      .from("discounts")
      .select("*")
      .eq("id", discountId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!discount) return res.status(404).json({ message: "Discount not found" });

    // Name uniqueness check
    if (name && name !== discount.name) {
      const { data: taken } = await supabase
        .from("discounts")
        .select("id")
        .eq("name", name)
        .maybeSingle();
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

    const updates = {
      name:                     name                     ?? discount.name,
      description:              description              !== undefined ? description              : discount.description,
      discount_type:            discountType             ?? discount.discount_type,
      discount_value:           discountValue            !== undefined ? discountValue            : discount.discount_value,
      discount_category:        discountCategory         ?? discount.discount_category,
      start_date:               startDate                !== undefined ? startDate                : discount.start_date,
      end_date:                 endDate                  !== undefined ? endDate                  : discount.end_date,
      is_enabled:               isEnabled                !== undefined ? isEnabled                : discount.is_enabled,
      requires_verification:    requiresVerification     !== undefined ? requiresVerification     : discount.requires_verification,
      applicable_to:            applicableTo             ?? discount.applicable_to,
      minimum_purchase_amount:  minimumPurchaseAmount    !== undefined ? minimumPurchaseAmount    : discount.minimum_purchase_amount,
      maximum_discount_amount:  maximumDiscountAmount    !== undefined ? maximumDiscountAmount    : discount.maximum_discount_amount,
      priority:                 priority                 !== undefined ? priority                 : discount.priority,
      stackable:                stackable                !== undefined ? stackable                : discount.stackable,
    };

    const { error: updateError } = await supabase
      .from("discounts")
      .update(updates)
      .eq("id", discountId);
    if (updateError) throw updateError;

    // Sync category associations
    if (categoryIds !== undefined) {
      await supabase.from("category_discounts").delete().eq("discount_id", discountId);

      if (categoryIds.length > 0) {
        const { data: validCats } = await supabase
          .from("categories").select("id").in("id", categoryIds);
        if (!validCats || validCats.length !== categoryIds.length) {
          return res.status(400).json({ message: "One or more category IDs are invalid" });
        }
        const { error: catError } = await supabase
          .from("category_discounts")
          .insert(categoryIds.map((cid) => ({ category_id: cid, discount_id: discountId })));
        if (catError) throw catError;
      }
    }

    // Sync product associations
    if (productIds !== undefined) {
      await supabase.from("product_discounts").delete().eq("discount_id", discountId);

      if (productIds.length > 0) {
        const { data: validProds } = await supabase
          .from("products").select("id").in("id", productIds);
        if (!validProds || validProds.length !== productIds.length) {
          return res.status(400).json({ message: "One or more product IDs are invalid" });
        }
        const { error: prodError } = await supabase
          .from("product_discounts")
          .insert(productIds.map((pid) => ({ product_id: pid, discount_id: discountId })));
        if (prodError) throw prodError;
      }
    }

    const { data: full, error: fullFetchError } = await supabase
      .from("discounts")
      .select(DISCOUNT_WITH_JOINS)
      .eq("id", discountId)
      .single();
    if (fullFetchError) throw fullFetchError;

    return res.status(200).json(flattenDiscount(full));
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete Discount ──────────────────────────────────────────────────────────

exports.deleteDiscount = async (req, res) => {
  try {
    const discountId = req.params.id;

    const { data: discount, error: fetchError } = await supabase
      .from("discounts")
      .select("id")
      .eq("id", discountId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!discount) return res.status(404).json({ message: "Discount not found" });

    // Junction rows are deleted via ON DELETE CASCADE in the DB
    const { error } = await supabase.from("discounts").delete().eq("id", discountId);
    if (error) throw error;

    return res.status(200).json({ message: "Discount deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Toggle Discount Status ───────────────────────────────────────────────────

exports.toggleDiscountStatus = async (req, res) => {
  try {
    const { data: discount, error: fetchError } = await supabase
      .from("discounts")
      .select("id, is_enabled")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!discount) return res.status(404).json({ message: "Discount not found" });

    const newStatus = !discount.is_enabled;

    const { error } = await supabase
      .from("discounts")
      .update({ is_enabled: newStatus })
      .eq("id", discount.id);
    if (error) throw error;

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

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, category_id")
      .eq("id", productId)
      .maybeSingle();

    if (productError) throw productError;
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Fetch all enabled discounts with their associations
    const { data, error } = await supabase
      .from("discounts")
      .select(DISCOUNT_WITH_JOINS)
      .eq("is_enabled", true)
      .order("priority", { ascending: false });

    if (error) throw error;

    const discounts = data.map(flattenDiscount);

    // Filter: active dates + applicable to this product
    const applicable = discounts.filter((d) => {
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

    const [
      { data: product, error: pe },
      { data: discountRaw, error: de },
    ] = await Promise.all([
      supabase.from("products").select("id, name, price, category_id").eq("id", productId).maybeSingle(),
      supabase.from("discounts").select(DISCOUNT_WITH_JOINS).eq("id", discountId).maybeSingle(),
    ]);

    if (pe) throw pe;
    if (de) throw de;
    if (!product)      return res.status(404).json({ message: "Product not found" });
    if (!discountRaw)  return res.status(404).json({ message: "Discount not found" });

    const discount = flattenDiscount(discountRaw);

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

    // Check applicability
    if (discount.applicable_to === "SPECIFIC_PRODUCTS") {
      const ok = discount.products.some((p) => String(p.id) === String(productId));
      if (!ok) return res.status(400).json({ message: "Discount not applicable to this product" });
    } else if (discount.applicable_to === "CATEGORIES") {
      const ok = discount.categories.some((c) => String(c.id) === String(product.category_id));
      if (!ok) return res.status(400).json({ message: "Discount not applicable to this product" });
    }

    // Calculate
    let discountAmount =
      discount.discount_type === "PERCENTAGE"
        ? (product.price * discount.discount_value) / 100
        : Math.min(discount.discount_value, product.price);

    if (discount.maximum_discount_amount) {
      discountAmount = Math.min(discountAmount, discount.maximum_discount_amount);
    }

    const finalPrice = Math.max(0, product.price - discountAmount);

    return res.status(200).json({
      productId:     product.id,
      productName:   product.name,
      originalPrice: parseFloat(product.price),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalPrice:    parseFloat(finalPrice.toFixed(2)),
      discountName:  discount.name,
      discountType:  discount.discount_type,
      discountValue: parseFloat(discount.discount_value),
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};