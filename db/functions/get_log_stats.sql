-- Activity-log aggregation (Drizzle/PostgREST both call this via RPC).
-- Returns action/module/user breakdowns for an optional date range.
-- Mirror of the documenting comment in controllers/logController.js.

create or replace function get_log_stats(
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null
)
returns json as $$
declare
  action_stats json;
  module_stats json;
  user_stats   json;
begin
  select json_agg(r) into action_stats from (
    select action, count(*)::int as count
    from logs
    where (p_date_from is null or created_at >= p_date_from)
      and (p_date_to   is null or created_at <= p_date_to)
    group by action
  ) r;

  select json_agg(r) into module_stats from (
    select module, count(*)::int as count
    from logs
    where (p_date_from is null or created_at >= p_date_from)
      and (p_date_to   is null or created_at <= p_date_to)
    group by module
  ) r;

  select json_agg(r) into user_stats from (
    select l.user_id, count(*)::int as count, u.username
    from logs l
    left join users u on u.id = l.user_id
    where (p_date_from is null or l.created_at >= p_date_from)
      and (p_date_to   is null or l.created_at <= p_date_to)
    group by l.user_id, u.username
  ) r;

  return json_build_object(
    'actionStats', coalesce(action_stats, '[]'),
    'moduleStats', coalesce(module_stats, '[]'),
    'userStats',   coalesce(user_stats,   '[]')
  );
end;
$$ language plpgsql;
