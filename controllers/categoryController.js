const { db, schema } = require("../config/db");
const { eq, asc, count } = require("drizzle-orm");
const { createLog } = require("../middleware/logMiddleware");

const { categories, products } = schema;

// ─── Get All Categories ───────────────────────────────────────────────────────

exports.getAllCategories = async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.name));

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Category By ID (with products) ──────────────────────────────────────

exports.getCategoryById = async (req, res) => {
  try {
    const [category] = await db
      .select({ id: categories.id, name: categories.name, description: categories.description })
      .from(categories)
      .where(eq(categories.id, req.params.id))
      .limit(1);

    if (!category) return res.status(404).json({ message: "Category not found" });

    // Nested products — matches the previous supabase nested-select shape.
    const categoryProducts = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        price: products.price,
        status: products.status,
      })
      .from(products)
      .where(eq(products.categoryId, req.params.id));

    return res.status(200).json({ ...category, products: categoryProducts });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Create Category ──────────────────────────────────────────────────────────

exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .limit(1);

    if (existing) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }

    const [newCategory] = await db
      .insert(categories)
      .values({ name, description })
      .returning();

    await createLog(
      req, "CREATE", "categories", newCategory.id,
      `Created category: ${newCategory.name}`,
      { category: newCategory }
    );

    return res.status(201).json(newCategory);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Category ──────────────────────────────────────────────────────────

exports.updateCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const categoryId = req.params.id;

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!category) return res.status(404).json({ message: "Category not found" });

    if (name && name !== category.name) {
      const [existing] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, name))
        .limit(1);

      if (existing) {
        return res.status(400).json({ message: "Category with this name already exists" });
      }
    }

    const updates = {
      name:        name        ?? category.name,
      description: description !== undefined ? description : category.description,
    };

    const [updatedCategory] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, categoryId))
      .returning();

    await createLog(
      req, "UPDATE", "categories", categoryId,
      `Updated category: ${updatedCategory.name}`,
      { before: category, after: updatedCategory }
    );

    return res.status(200).json(updatedCategory);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Delete Category ──────────────────────────────────────────────────────────

exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const [category] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!category) return res.status(404).json({ message: "Category not found" });

    const [{ productCount }] = await db
      .select({ productCount: count() })
      .from(products)
      .where(eq(products.categoryId, categoryId));

    if (productCount > 0) {
      return res.status(400).json({
        message: "Cannot delete category with associated products. Remove products first.",
      });
    }

    await db.delete(categories).where(eq(categories.id, categoryId));

    await createLog(
      req, "DELETE", "categories", categoryId,
      `Deleted category: ${category.name}`,
      { category }
    );

    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
