-- Migration: create_logs_table

create table logs (
  id          bigserial   primary key,
  user_id     bigint      references users(id) on update cascade on delete set null,
  action      text        not null,
  module      text        not null,
  record_id   bigint,
  description text,
  metadata    jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
  -- No updated_at — logs are immutable
);

create index idx_logs_user_id   on logs (user_id);
create index idx_logs_action    on logs (action);
create index idx_logs_module    on logs (module);
create index idx_logs_created_at on logs (created_at);
create index idx_logs_module_record on logs (module, record_id);