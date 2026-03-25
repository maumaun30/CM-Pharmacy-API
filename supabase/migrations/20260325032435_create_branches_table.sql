-- Migration: create_branches_table
-- Generated from Sequelize migration

create table branches (
  id              bigserial primary key,
  name            text          not null unique,
  code            varchar(10)   not null unique,
  address         text,
  city            text,
  province        text,
  postal_code     varchar(20),
  phone           varchar(50),
  email           text,
  manager_name    text,
  is_active       boolean       not null default true,
  is_main_branch  boolean       not null default false,
  operating_hours jsonb,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

-- Indexes
create index idx_branches_code      on branches (code);
create index idx_branches_is_active on branches (is_active);
create index idx_branches_city      on branches (city);

-- Only one main branch allowed at a time
create unique index branches_only_one_main
  on branches (is_main_branch)
  where is_main_branch = true;

-- Auto-update updated_at on row changes
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger branches_set_updated_at
  before update on branches
  for each row
  execute function set_updated_at();