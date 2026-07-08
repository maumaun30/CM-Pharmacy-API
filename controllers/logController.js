const { and, eq, or, ilike, gte, lte, desc, count, sql } = require("drizzle-orm");
const { db, schema } = require("../config/db");

const { logs, users } = schema;

// Nested user projection (matches supabase `user:users (...)` alias, snake_case).
const userNested = (u) => ({
  id: u.id, username: u.username, email: u.email,
  first_name: u.firstName, last_name: u.lastName, role: u.role,
});

// Full log row in snake_case (matches `logs.select("*")`).
const logFull = {
  id: logs.id,
  user_id: logs.userId,
  action: logs.action,
  module: logs.module,
  record_id: logs.recordId,
  description: logs.description,
  metadata: logs.metadata,
  ip_address: logs.ipAddress,
  user_agent: logs.userAgent,
  created_at: logs.createdAt,
};

// ─── Get All Logs (paginated, filtered) ──────────────────────────────────────

exports.getAllLogs = async (req, res) => {
  try {
    const {
      userId,
      action,
      module,
      search,
      dateFrom,
      dateTo,
      page  = 1,
      limit = 50,
    } = req.query;

    const pageNum  = parseInt(page);
    const pageSize = parseInt(limit);
    const offset   = (pageNum - 1) * pageSize;

    // Build filter conditions (all on the logs table).
    const conds = [];
    if (userId) conds.push(eq(logs.userId, userId));
    if (action) conds.push(eq(logs.action, action));
    if (module) conds.push(eq(logs.module, module));
    if (search)
      conds.push(
        or(
          ilike(logs.description, `%${search}%`),
          ilike(logs.action, `%${search}%`),
          ilike(logs.module, `%${search}%`)
        )
      );
    if (dateFrom) conds.push(gte(logs.createdAt, new Date(dateFrom).toISOString()));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conds.push(lte(logs.createdAt, endOfDay.toISOString()));
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({ ...logFull, user: userNested(users) })
      .from(logs)
      .leftJoin(users, eq(logs.userId, users.id))
      .where(where)
      .orderBy(desc(logs.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Collapse the joined user to null when the log has no user (supabase semantics).
    for (const r of rows) r.user = r.user?.id ? r.user : null;

    const [{ total }] = await db
      .select({ total: count() })
      .from(logs)
      .where(where);

    return res.status(200).json({
      logs: rows,
      pagination: {
        total,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Log Stats ────────────────────────────────────────────────────────────
// Server-side aggregation via the get_log_stats Postgres function.
// Definition lives in db/functions/get_log_stats.sql.

exports.getLogStats = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const endOfDay = dateTo ? new Date(dateTo) : null;
    if (endOfDay) endOfDay.setHours(23, 59, 59, 999);

    const pFrom = dateFrom ? new Date(dateFrom).toISOString() : null;
    const pTo = endOfDay ? endOfDay.toISOString() : null;

    const result = await db.execute(
      sql`select get_log_stats(${pFrom}::timestamptz, ${pTo}::timestamptz) as data`
    );

    return res.status(200).json(result.rows[0].data);
  } catch (error) {
    console.error("Error fetching log stats:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Logs For a Specific Record ──────────────────────────────────────────

exports.getRecordLogs = async (req, res) => {
  try {
    const { module, recordId } = req.params;

    const rows = await db
      .select({
        ...logFull,
        user: { id: users.id, username: users.username, email: users.email },
      })
      .from(logs)
      .leftJoin(users, eq(logs.userId, users.id))
      .where(and(eq(logs.module, module), eq(logs.recordId, parseInt(recordId))))
      .orderBy(desc(logs.createdAt));

    for (const r of rows) r.user = r.user?.id ? r.user : null;

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching record logs:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
