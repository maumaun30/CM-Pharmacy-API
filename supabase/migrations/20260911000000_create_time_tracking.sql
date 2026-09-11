-- Employee time tracking: clock in/out from the mobile app, supervision and
-- approval from the web console (CM-Pharmacy-UI /time).
--
-- Design notes
--  * A clock event carries the EVIDENCE that was observed on the device (SSID,
--    BSSID, coordinates). The client check is UX; the server re-evaluates the
--    branch rules here and decides verified vs flagged. Never trust the client.
--  * "Late" and "Edited" are DERIVED in the API (roster comparison / edited_by
--    being set), not stored statuses — only the lifecycle is stored.
--  * client_ref mirrors sales: the mobile app queues clock events offline and
--    replays them, so the same event must never create two rows.

-- ── Branch clock-in rules ────────────────────────────────────────────────────
-- One row per branch. Managers edit their own; admins edit any.
create table if not exists branch_clock_rules (
  branch_id bigint primary key references branches(id) on update cascade on delete cascade,
  wifi_lock boolean not null default true,
  geo_lock boolean not null default true,
  geo_radius_m integer not null default 150 check (geo_radius_m > 0),
  -- Branch coordinates the geo check measures against. Null disables the check
  -- regardless of geo_lock, since there is nothing to measure from.
  latitude numeric(10,7),
  longitude numeric(10,7),
  -- Close forgotten shifts instead of billing the night; flagged for approval.
  auto_clock_out boolean not null default true,
  auto_clock_out_at time not null default '22:00',
  -- Minutes past a rostered start before a clock-in counts as late.
  late_grace_minutes integer not null default 15 check (late_grace_minutes >= 0),
  updated_by bigint references users(id) on update cascade on delete set null,
  updated_at timestamptz not null default now()
);

-- ── Approved access points ──────────────────────────────────────────────────
-- Multiple BSSIDs per branch on purpose: a router swap or a second AP must not
-- lock a whole branch out. is_allowed = false records a KNOWN-BAD network (the
-- guest SSID) so the API can explain the rejection instead of just failing.
create table if not exists branch_access_points (
  id bigserial primary key,
  branch_id bigint not null references branches(id) on update cascade on delete cascade,
  ssid text not null,
  bssid text not null,
  label text,
  is_allowed boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uniq_access_point_branch_bssid on branch_access_points (branch_id, lower(bssid));
create index if not exists idx_access_points_branch on branch_access_points (branch_id);

-- ── Pay rules ───────────────────────────────────────────────────────────────
create table if not exists branch_pay_rules (
  branch_id bigint primary key references branches(id) on update cascade on delete cascade,
  normal_week_hours numeric(5,2) not null default 45,
  overtime_multiplier numeric(4,2) not null default 1.5,
  holiday_multiplier numeric(4,2) not null default 2.0,
  unpaid_break_minutes integer not null default 30 check (unpaid_break_minutes >= 0),
  -- Day of month the pay period cuts off on.
  pay_period_day integer not null default 25 check (pay_period_day between 1 and 28),
  hourly_rate numeric(10,2),
  updated_by bigint references users(id) on update cascade on delete set null,
  updated_at timestamptz not null default now()
);

-- ── Roster ──────────────────────────────────────────────────────────────────
-- Drives "of N rostered today", late detection, and upcoming shifts on mobile.
create table if not exists shift_schedules (
  id bigserial primary key,
  user_id bigint not null references users(id) on update cascade on delete cascade,
  branch_id bigint not null references branches(id) on update cascade on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  created_by bigint references users(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_shift_schedules_user_start on shift_schedules (user_id, starts_at);
create index if not exists idx_shift_schedules_branch_start on shift_schedules (branch_id, starts_at);

-- ── Coverage requirements ───────────────────────────────────────────────────
-- How many people a branch needs in a window. Coverage gaps = requirement minus
-- whoever is actually rostered for that window.
create table if not exists coverage_requirements (
  id bigserial primary key,
  branch_id bigint not null references branches(id) on update cascade on delete cascade,
  -- 0 = Sunday, matching Postgres extract(dow).
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  required_staff integer not null default 1 check (required_staff > 0),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists idx_coverage_requirements_branch on coverage_requirements (branch_id, weekday);

-- ── Time entries ────────────────────────────────────────────────────────────
create table if not exists time_entries (
  id bigserial primary key,
  user_id bigint not null references users(id) on update cascade on delete restrict,
  branch_id bigint not null references branches(id) on update cascade on delete restrict,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  -- Accumulated unpaid break. break_started_at is non-null only while on break.
  break_minutes integer not null default 0 check (break_minutes >= 0),
  break_started_at timestamptz,
  status text not null default 'open' check (status in ('open','pending','approved')),
  source text not null default 'mobile' check (source in ('mobile','console','automation')),
  -- Server's verdict on the presence check, plus the evidence it judged.
  verified boolean not null default false,
  flag_reason text,
  evidence jsonb not null default '{}'::jsonb,
  -- Set when auto clock-out closed a forgotten shift.
  auto_closed boolean not null default false,
  approved_by bigint references users(id) on update cascade on delete set null,
  approved_at timestamptz,
  edited_by bigint references users(id) on update cascade on delete set null,
  edited_at timestamptz,
  edit_reason text,
  note text,
  -- Offline replay guard for the mobile outbox.
  client_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);

-- One person cannot have two shifts running at once.
create unique index if not exists uniq_time_entry_open_per_user on time_entries (user_id) where clock_out_at is null;
create unique index if not exists uniq_time_entries_client_ref on time_entries (client_ref) where client_ref is not null;
create index if not exists idx_time_entries_branch_in on time_entries (branch_id, clock_in_at desc);
create index if not exists idx_time_entries_user_in on time_entries (user_id, clock_in_at desc);
create index if not exists idx_time_entries_status_branch on time_entries (status, branch_id);

-- ── Defaults for existing branches ──────────────────────────────────────────
-- Every branch needs a rule row before anyone can clock in; seed permissive
-- defaults with the Wi-Fi lock ON but no access points yet, which the API
-- treats as "cannot satisfy the check" — so add an AP before enabling it in
-- anger. Coordinates stay null until someone sets them in the console.
insert into branch_clock_rules (branch_id, wifi_lock, geo_lock)
select id, false, false from branches
on conflict (branch_id) do nothing;

insert into branch_pay_rules (branch_id)
select id from branches
on conflict (branch_id) do nothing;
