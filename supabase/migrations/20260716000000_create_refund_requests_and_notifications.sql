-- Refund requests: async cashier-initiated refunds awaiting admin/manager review.
-- Approval calls the existing process_refund() RPC; this table only tracks the
-- request lifecycle (pending → approved/declined) and links to the refund row.
create table if not exists refund_requests (
  id bigserial primary key,
  sale_id bigint not null references sales(id) on update cascade on delete restrict,
  branch_id bigint not null references branches(id) on update cascade on delete restrict,
  requested_by bigint not null references users(id) on update cascade on delete restrict,
  items jsonb not null,
  reason text,
  total_refund numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  reviewed_by bigint references users(id) on update cascade on delete set null,
  review_note text,
  refund_id bigint references refunds(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists idx_refund_requests_status_branch on refund_requests (status, branch_id);
create index if not exists idx_refund_requests_sale_id on refund_requests (sale_id);
create index if not exists idx_refund_requests_requested_by on refund_requests (requested_by);

-- Notifications: fan-out-on-write, one row per recipient user.
create table if not exists notifications (
  id bigserial primary key,
  user_id bigint not null references users(id) on update cascade on delete cascade,
  type text not null check (type in ('refund_request','refund_approved','refund_declined','low_stock')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  branch_id bigint references branches(id) on update cascade on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_unread on notifications (user_id, is_read);
create index if not exists idx_notifications_created_at on notifications (created_at);
