const { Category, Product } = require("../models");
const { createLog } = require("../middleware/logMiddleware");

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll();
    return res.status(200).json(categories);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id, {
      include: [
        {
          model: Product,
          as: "products",
        },
      ],
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.status(200).json(category);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Create new category
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    // Check if category already exists
    const existingCategory = await Category.findOne({ where: { name } });
    if (existingCategory) {
      return res
        .status(400)
        .json({ message: "Category with this name already exists" });
    }

    const newCategory = await Category.create({
      name,
      description,
    });

    await createLog(
      req,
      "CREATE",
      "categories",
      `Created category: ${newCategory.name}`,
      {
        category: newCategory.toJSON(),
      },
    );

    return res.status(201).json(newCategory);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update category
exports.updateCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const categoryId = req.params.id;

    const category = await Category.findByPk(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Check if updated name already exists (and isn't the current category)
    if (name && name !== category.name) {
      const existingCategory = await Category.findOne({ where: { name } });
      if (existingCategory) {
        return res
          .status(400)
          .json({ message: "Category with this name already exists" });
      }
    }

    await category.update({
      name: name || category.name,
      description:
        description !== undefined ? description : category.description,
    });

    await createLog(
      req,
      "UPDATE",
      "categories",
      `Updated category: ${category.name}`,
      {
        before: { ...category._previousDataValues },
        after: { ...category.toJSON() },
      },
    );

    return res.status(200).json(category);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Delete category
exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const category = await Category.findByPk(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Check if category has products
    const productCount = await Product.count({ where: { categoryId } });
    if (productCount > 0) {
      return res.status(400).json({
        message:
          "Cannot delete category with associated products. Remove products first.",
      });
    }

    await category.destroy();

    await createLog(
      req,
      "DELETE",
      "categories",
      categoryId,
      `Deleted category: ${category.name}`,
      { category: category.toJSON() },
    );

    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
