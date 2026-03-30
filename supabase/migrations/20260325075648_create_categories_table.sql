-- Migration: create_categories_table

create table categories (
  id          bigserial     primary key,
  name        text          not null unique,
  description text,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create trigger categories_set_updated_at
  before update on categories
  for each row execute function set_updated_at();