-- Migration: create_products_table

create type product_status as enum ('ACTIVE', 'INACTIVE');

create table products (
  id                    bigserial       primary key,
  name                  text            not null,
  sku                   text            not null unique,
  barcode               text            unique,
  description           text,
  price                 numeric(10, 2)  not null,
  cost                  numeric(10, 2)  not null,
  expiry_date           timestamptz,
  brand_name            text,
  generic_name          text,
  dosage                text,
  form                  text,
  requires_prescription boolean         not null default false,
  status                product_status  not null default 'ACTIVE',
  category_id           bigint          not null references categories(id)
                                          on update cascade on delete restrict,
  created_at            timestamptz     not null default now(),
  updated_at            timestamptz     not null default now()
);

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();