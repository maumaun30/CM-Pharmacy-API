// controllers/branchController.js
const { Branch, User, Sale, Stock } = require("../models");
const { Op } = require("sequelize");
const { createLog } = require("../middleware/logMiddleware");

// Get all branches
exports.getAllBranches = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const whereClause = {};

    if (isActive !== undefined) {
      whereClause.isActive = isActive === "true";
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { city: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const branches = await Branch.findAll({
      where: whereClause,
      order: [
        ["isMainBranch", "DESC"],
        ["name", "ASC"],
      ],
    });

    return res.status(200).json(branches);
  } catch (error) {
    console.error("Error fetching branches:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get branch by ID
exports.getBranchById = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id", "username", "email", "role"],
        },
      ],
    });

    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    return res.status(200).json(branch);
  } catch (error) {
    console.error("Error fetching branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Create branch
exports.createBranch = async (req, res) => {
  try {
    const {
      name,
      code,
      address,
      city,
      province,
      postalCode,
      phone,
      email,
      managerName,
      isActive,
      isMainBranch,
      operatingHours,
    } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(400).json({
        message: "Name and code are required",
      });
    }

    // Check if code already exists
    const existingBranch = await Branch.findOne({ where: { code } });
    if (existingBranch) {
      return res.status(400).json({
        message: "Branch code already exists",
      });
    }

    // If setting as main branch, unset other main branches
    if (isMainBranch) {
      await Branch.update(
        { isMainBranch: false },
        { where: { isMainBranch: true } }
      );
    }

    const branch = await Branch.create({
      name,
      code,
      address,
      city,
      province,
      postalCode,
      phone,
      email,
      managerName,
      isActive: isActive !== undefined ? isActive : true,
      isMainBranch: isMainBranch || false,
      operatingHours: operatingHours || undefined,
    });

    await createLog(
      req,
      "CREATE",
      "branches",
      branch.id,
      `Created branch: ${branch.name}`,
      { branch: branch.toJSON() }
    );

    return res.status(201).json(branch);
  } catch (error) {
    console.error("Error creating branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Update branch
exports.updateBranch = async (req, res) => {
  try {
    const branchId = req.params.id;
    const {
      name,
      code,
      address,
      city,
      province,
      postalCode,
      phone,
      email,
      managerName,
      isActive,
      isMainBranch,
      operatingHours,
    } = req.body;

    const branch = await Branch.findByPk(branchId);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // Check if code is being changed and already exists
    if (code && code !== branch.code) {
      const existingBranch = await Branch.findOne({ where: { code } });
      if (existingBranch) {
        return res.status(400).json({
          message: "Branch code already exists",
        });
      }
    }

    // If setting as main branch, unset other main branches
    if (isMainBranch && !branch.isMainBranch) {
      await Branch.update(
        { isMainBranch: false },
        { where: { isMainBranch: true } }
      );
    }

    await branch.update({
      name: name || branch.name,
      code: code || branch.code,
      address: address !== undefined ? address : branch.address,
      city: city !== undefined ? city : branch.city,
      province: province !== undefined ? province : branch.province,
      postalCode: postalCode !== undefined ? postalCode : branch.postalCode,
      phone: phone !== undefined ? phone : branch.phone,
      email: email !== undefined ? email : branch.email,
      managerName: managerName !== undefined ? managerName : branch.managerName,
      isActive: isActive !== undefined ? isActive : branch.isActive,
      isMainBranch: isMainBranch !== undefined ? isMainBranch : branch.isMainBranch,
      operatingHours: operatingHours !== undefined ? operatingHours : branch.operatingHours,
    });

    await createLog(
      req,
      "UPDATE",
      "branches",
      branch.id,
      `Updated branch: ${branch.name}`,
      { branch: branch.toJSON() }
    );

    return res.status(200).json(branch);
  } catch (error) {
    console.error("Error updating branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Delete branch
exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    // Check if branch has associated records
    const [userCount, saleCount, stockCount] = await Promise.all([
      User.count({ where: { branchId: branch.id } }),
      Sale.count({ where: { branchId: branch.id } }),
      Stock.count({ where: { branchId: branch.id } }),
    ]);

    if (userCount > 0 || saleCount > 0 || stockCount > 0) {
      return res.status(400).json({
        message: "Cannot delete branch with associated users, sales, or stock records",
      });
    }

    await branch.destroy();

    await createLog(
      req,
      "DELETE",
      "branches",
      branch.id,
      `Deleted branch: ${branch.name}`,
      { branch: branch.toJSON() }
    );

    return res.status(200).json({ message: "Branch deleted successfully" });
  } catch (error) {
    console.error("Error deleting branch:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Toggle branch status
exports.toggleBranchStatus = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    branch.isActive = !branch.isActive;
    await branch.save();

    await createLog(
      req,
      "UPDATE",
      "branches",
      branch.id,
      `${branch.isActive ? "Activated" : "Deactivated"} branch: ${branch.name}`,
      { isActive: branch.isActive }
    );

    return res.status(200).json({
      message: `Branch ${branch.isActive ? "activated" : "deactivated"}`,
      isActive: branch.isActive,
    });
  } catch (error) {
    console.error("Error toggling branch status:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get branch statistics
exports.getBranchStats = async (req, res) => {
  try {
    const branchId = req.params.id;

    const [userCount, todaySales, monthlySales, stockTransactions] = await Promise.all([
      User.count({ where: { branchId } }),
      Sale.count({
        where: {
          branchId,
          soldAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      Sale.count({
        where: {
          branchId,
          soldAt: {
            [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      Stock.count({
        where: {
          branchId,
          createdAt: {
            [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return res.status(200).json({
      userCount,
      todaySales,
      monthlySales,
      stockTransactions,
    });
  } catch (error) {
    console.error("Error fetching branch stats:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};