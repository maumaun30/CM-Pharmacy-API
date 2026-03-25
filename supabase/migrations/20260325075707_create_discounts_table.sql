-- Migration: create_discounts_and_junction_tables

create type discount_type     as enum ('PERCENTAGE', 'FIXED_AMOUNT');
create type discount_category as enum ('PWD', 'SENIOR_CITIZEN', 'PROMOTIONAL', 'SEASONAL', 'OTHER');
create type applicable_to     as enum ('ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'CATEGORIES');

create table discounts (
  id                      bigserial         primary key,
  name                    text              not null unique,
  description             text,
  discount_type           discount_type     not null default 'PERCENTAGE',
  discount_value          numeric(10, 2)    not null,
  discount_category       discount_category not null default 'OTHER',
  start_date              timestamptz,
  end_date                timestamptz,
  is_enabled              boolean           not null default true,
  requires_verification   boolean           not null default false,
  applicable_to           applicable_to     not null default 'ALL_PRODUCTS',
  minimum_purchase_amount numeric(10, 2),
  maximum_discount_amount numeric(10, 2),
  priority                integer           not null default 0,
  stackable               boolean           not null default false,
  created_at              timestamptz       not null default now(),
  updated_at              timestamptz       not null default now()
);

create index idx_discounts_category   on discounts (discount_category);
create index idx_discounts_is_enabled on discounts (is_enabled);
create index idx_discounts_dates      on discounts (start_date, end_date);
create index idx_discounts_priority   on discounts (priority);

create trigger discounts_set_updated_at
  before update on discounts
  for each row execute function set_updated_at();

-- Junction: product ↔ discount
create table product_discounts (
  id          bigserial   primary key,
  product_id  bigint      not null references products(id)  on update cascade on delete cascade,
  discount_id bigint      not null references discounts(id) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_discount_unique unique (product_id, discount_id)
);

create index idx_product_discounts_product  on product_discounts (product_id);
create index idx_product_discounts_discount on product_discounts (discount_id);

create trigger product_discounts_set_updated_at
  before update on product_discounts
  for each row execute function set_updated_at();