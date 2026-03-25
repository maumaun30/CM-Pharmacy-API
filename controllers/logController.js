const supabase = require("../config/supabase");

const USER_FIELDS = "id, username, email, first_name, last_name, role";

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

    let query = supabase
      .from("logs")
      .select(`*, user:users (${USER_FIELDS})`, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (userId)  query = query.eq("user_id", userId);
    if (action)  query = query.eq("action", action);
    if (module)  query = query.eq("module", module);
    if (search)
      query = query.or(
        `description.ilike.%${search}%,action.ilike.%${search}%,module.ilike.%${search}%`
      );
    if (dateFrom) query = query.gte("created_at", new Date(dateFrom).toISOString());
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.lte("created_at", endOfDay.toISOString());
    }

    const { data: logs, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      logs,
      pagination: {
        total:      count,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(count / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Log Stats ────────────────────────────────────────────────────────────
// Supabase JS has no GROUP BY — use an RPC for server-side aggregation.
//
// Create once in Supabase SQL Editor:
//
// create or replace function get_log_stats(
//   p_date_from timestamptz default null,
//   p_date_to   timestamptz default null
// )
// returns json as $$
// declare
//   action_stats json;
//   module_stats json;
//   user_stats   json;
// begin
//   select json_agg(r) into action_stats from (
//     select action, count(*)::int as count
//     from logs
//     where (p_date_from is null or created_at >= p_date_from)
//       and (p_date_to   is null or created_at <= p_date_to)
//     group by action
//   ) r;
//
//   select json_agg(r) into module_stats from (
//     select module, count(*)::int as count
//     from logs
//     where (p_date_from is null or created_at >= p_date_from)
//       and (p_date_to   is null or created_at <= p_date_to)
//     group by module
//   ) r;
//
//   select json_agg(r) into user_stats from (
//     select l.user_id, count(*)::int as count, u.username
//     from logs l
//     left join users u on u.id = l.user_id
//     where (p_date_from is null or l.created_at >= p_date_from)
//       and (p_date_to   is null or l.created_at <= p_date_to)
//     group by l.user_id, u.username
//   ) r;
//
//   return json_build_object(
//     'actionStats', coalesce(action_stats, '[]'),
//     'moduleStats', coalesce(module_stats, '[]'),
//     'userStats',   coalesce(user_stats,   '[]')
//   );
// end;
// $$ language plpgsql;

exports.getLogStats = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const endOfDay = dateTo ? new Date(dateTo) : null;
    if (endOfDay) endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase.rpc("get_log_stats", {
      p_date_from: dateFrom ? new Date(dateFrom).toISOString() : null,
      p_date_to:   endOfDay ? endOfDay.toISOString() : null,
    });

    if (error) throw error;

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching log stats:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Logs For a Specific Record ──────────────────────────────────────────

exports.getRecordLogs = async (req, res) => {
  try {
    const { module, recordId } = req.params;

    const { data: logs, error } = await supabase
      .from("logs")
      .select(`*, user:users (id, username, email)`)
      .eq("module", module)
      .eq("record_id", parseInt(recordId))
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json(logs);
  } catch (error) {
    console.error("Error fetching record logs:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};