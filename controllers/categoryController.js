const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Get All Categories ───────────────────────────────────────────────────────

exports.getAllCategories = async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from("categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    return res.status(200).json(categories);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Category By ID (with products) ──────────────────────────────────────

exports.getCategoryById = async (req, res) => {
  try {
    const { data: category, error } = await supabase
      .from("categories")
      .select(`*, products (*)`)
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!category) return res.status(404).json({ message: "Category not found" });

    return res.status(200).json(category);
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

    const { data: existing } = await supabase
      .from("categories")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }

    const { data: newCategory, error } = await supabase
      .from("categories")
      .insert({ name, description })
      .select()
      .single();

    if (error) throw error;

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

    const { data: category, error: fetchError } = await supabase
      .from("categories")
      .select("*")
      .eq("id", categoryId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!category) return res.status(404).json({ message: "Category not found" });

    if (name && name !== category.name) {
      const { data: existing } = await supabase
        .from("categories")
        .select("id")
        .eq("name", name)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({ message: "Category with this name already exists" });
      }
    }

    const updates = {
      name:        name        ?? category.name,
      description: description !== undefined ? description : category.description,
    };

    const { data: updatedCategory, error: updateError } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", categoryId)
      .select()
      .single();

    if (updateError) throw updateError;

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

    const { data: category, error: fetchError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", categoryId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!category) return res.status(404).json({ message: "Category not found" });

    const { count: productCount, error: countError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (countError) throw countError;

    if (productCount > 0) {
      return res.status(400).json({
        message: "Cannot delete category with associated products. Remove products first.",
      });
    }

    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", categoryId);

    if (deleteError) throw deleteError;

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