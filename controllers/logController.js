// controllers/logController.js
const { Log, User } = require("../models");
const { Op } = require("sequelize");

// Get all logs with filters
exports.getAllLogs = async (req, res) => {
  try {
    const {
      userId,
      action,
      module,
      search,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = req.query;

    const whereClause = {};

    if (userId) {
      whereClause.userId = userId;
    }

    if (action) {
      whereClause.action = action;
    }

    if (module) {
      whereClause.module = module;
    }

    if (search) {
      whereClause[Op.or] = [
        { description: { [Op.iLike]: `%${search}%` } },
        { action: { [Op.iLike]: `%${search}%` } },
        { module: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (dateFrom) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.gte]: new Date(dateFrom),
      };
    }

    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: endOfDay,
      };
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: logs } = await Log.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "username",
            "email",
            "firstName",
            "lastName",
            "fullName",
            "role",
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: offset,
    });

    return res.status(200).json({
      logs,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get log statistics
exports.getLogStats = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const whereClause = {};

    if (dateFrom) {
      whereClause.createdAt = {
        [Op.gte]: new Date(dateFrom),
      };
    }

    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      whereClause.createdAt = {
        ...whereClause.createdAt,
        [Op.lte]: endOfDay,
      };
    }

    const [actionStats, moduleStats, userStats] = await Promise.all([
      // Count by action
      Log.findAll({
        where: whereClause,
        attributes: [
          "action",
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        ],
        group: ["action"],
        raw: true,
      }),
      // Count by module
      Log.findAll({
        where: whereClause,
        attributes: [
          "module",
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        ],
        group: ["module"],
        raw: true,
      }),
      // Count by user
      Log.findAll({
        where: whereClause,
        attributes: [
          "userId",
          [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        ],
        group: ["userId"],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["username"],
          },
        ],
        raw: true,
      }),
    ]);

    return res.status(200).json({
      actionStats,
      moduleStats,
      userStats,
    });
  } catch (error) {
    console.error("Error fetching log stats:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get logs for a specific record
exports.getRecordLogs = async (req, res) => {
  try {
    const { module, recordId } = req.params;

    const logs = await Log.findAll({
      where: {
        module,
        recordId: parseInt(recordId),
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username", "email"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json(logs);
  } catch (error) {
    console.error("Error fetching record logs:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
