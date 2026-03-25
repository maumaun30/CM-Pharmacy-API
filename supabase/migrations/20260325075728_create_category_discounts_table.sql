-- Migration: create_category_discounts_table

create table category_discounts (
  id          bigserial   primary key,
  category_id bigint      not null references categories(id) on update cascade on delete cascade,
  discount_id bigint      not null references discounts(id)  on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint category_discount_unique unique (category_id, discount_id)
);

create index idx_category_discounts_category on category_discounts (category_id);
create index idx_category_discounts_discount on category_discounts (discount_id);

create trigger category_discounts_set_updated_at
  before update on category_discounts
  for each row execute function set_updated_at();