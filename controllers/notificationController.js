const { and, eq, desc, count, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { dbErrorMessage } = require("../utils/dbError");

const { notifications } = schema;

// Notifications are strictly personal: every query is scoped to req.user.id.

const toSnake = (row) => ({
  id: row.id,
  user_id: row.userId,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data,
  branch_id: row.branchId,
  is_read: row.isRead,
  created_at: row.createdAt,
});

// ── GET /api/notifications?unread=true&page=&limit= ──────────────────────────
exports.listNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    const conditions = [eq(notifications.userId, req.user.id)];
    if (req.query.unread === "true") conditions.push(eq(notifications.isRead, false));
    const where = and(...conditions);

    const rows = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
    const [{ unread }] = await db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, req.user.id), eq(notifications.isRead, false)));

    return res.json({
      notifications: rows.map(toSnake),
      unread_count: Number(unread),
      total: Number(total),
      page,
      limit,
    });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/notifications/:id/read ──────────────────────────────────────────
exports.markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, Number(id)), eq(notifications.userId, req.user.id)))
      .returning();

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};

// ── PUT /api/notifications/read-all ──────────────────────────────────────────
exports.markAllRead = async (req, res) => {
  try {
    const updated = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, req.user.id), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });

    return res.json({ message: "All notifications marked as read", updated: updated.length });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({ message: "Server error", error: dbErrorMessage(error) });
  }
};
