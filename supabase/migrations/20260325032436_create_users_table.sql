-- supabase/migrations/20240325000000_create_users_table.sql

create table users (
  id          bigserial primary key,
  username    text not null unique,
  email       text not null unique,
  password    text not null,
  pin         text,
  role        text not null default 'cashier',
  first_name  text,
  last_name   text,
  contact_number text,
  branch_id   bigint references branches(id),
  current_branch_id bigint references branches(id),
  is_active   boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);