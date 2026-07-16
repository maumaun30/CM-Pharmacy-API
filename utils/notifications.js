// ─────────────────────────────────────────────────────────────────────────────
// DB-backed notification service (fan-out on write).
//
// One `notifications` row per recipient user; realtime delivery over the
// per-user socket room (`user-${id}`) via emitNotificationNew. Same contract
// as createLog: these helpers NEVER throw — a notification failure must not
// fail the parent operation (sale, refund, stock adjustment).
// ─────────────────────────────────────────────────────────────────────────────

const { and, eq, inArray, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");
const { emitNotificationNew } = require("./socket");

const { users, notifications } = schema;

// Project a Drizzle (camelCase) notifications row to the API's snake_case
// response shape — the same shape GET /api/notifications returns, so socket
// consumers and REST consumers see identical objects.
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

/**
 * Who should hear about a branch-scoped supervisor event?
 * All active admins + active managers whose home, current, or allowed
 * branches include the branch. Mirrors the socket room visibility rules.
 * @returns {Promise<number[]>} user ids (empty array on error)
 */
const resolveRecipients = async (branchId) => {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          sql`(
            ${users.role} = 'admin'
            or (
              ${users.role} = 'manager'
              and (
                ${users.branchId} = ${branchId}
                or ${users.currentBranchId} = ${branchId}
                or ${branchId} = any(${users.allowedBranchIds})
              )
            )
          )`
        )
      );
    return rows.map((r) => r.id);
  } catch (error) {
    console.error("resolveRecipients error:", error);
    return [];
  }
};

/**
 * Insert one notification per user and emit notification:new to each.
 * @param {number[]} userIds
 * @param {{type:string,title:string,body:string,data?:object,branchId?:number|null}} payload
 * @returns {Promise<object[]>} inserted rows (snake_case); [] on error
 */
const notifyUsers = async (userIds, { type, title, body, data = {}, branchId = null }) => {
  try {
    if (!userIds || userIds.length === 0) return [];
    const values = userIds.map((userId) => ({ userId, type, title, body, data, branchId }));
    const inserted = await db.insert(notifications).values(values).returning();
    const snake = inserted.map(toSnake);
    for (const n of snake) emitNotificationNew(n.user_id, n);
    return snake;
  } catch (error) {
    console.error("notifyUsers error:", error);
    return [];
  }
};

/**
 * Notify a branch's supervisors (admins + branch managers).
 */
const notifyBranchSupervisors = async (branchId, payload) => {
  const recipients = await resolveRecipients(branchId);
  return notifyUsers(recipients, { ...payload, branchId });
};

/**
 * Low-stock notification with dedupe: a recipient who already has an UNREAD
 * low_stock notification for this product+branch is skipped, so repeated
 * sales of an already-low product don't pile up rows.
 * @param {number} branchId
 * @param {{id:number,name:string,current_stock?:number}} productData
 */
const notifyLowStock = async (branchId, productData) => {
  try {
    const productId = productData.id ?? productData.productId;
    const recipients = await resolveRecipients(branchId);
    if (recipients.length === 0) return [];

    const existing = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, recipients),
          eq(notifications.type, "low_stock"),
          eq(notifications.isRead, false),
          eq(notifications.branchId, branchId),
          sql`${notifications.data}->>'productId' = ${String(productId)}`
        )
      );
    const alreadyNotified = new Set(existing.map((r) => r.userId));
    const fresh = recipients.filter((id) => !alreadyNotified.has(id));

    const stockNote =
      productData.current_stock != null ? ` (${productData.current_stock} left)` : "";
    return notifyUsers(fresh, {
      type: "low_stock",
      title: "Low stock",
      body: `${productData.name} is low${stockNote}`,
      data: { productId },
      branchId,
    });
  } catch (error) {
    console.error("notifyLowStock error:", error);
    return [];
  }
};

module.exports = {
  resolveRecipients,
  notifyUsers,
  notifyBranchSupervisors,
  notifyLowStock,
};
