-- Migration: create_sales_and_sale_items_tables

create type sale_status as enum ('completed', 'partially_refunded', 'fully_refunded');

create table sales (
  id              bigserial      primary key,
  branch_id       bigint         references branches(id) on update cascade on delete restrict,
  subtotal        numeric(10, 2),
  total_discount  numeric(10, 2) default 0,
  total_amount    numeric(10, 2) not null,
  cash_amount     numeric(10, 2),
  change_amount   numeric(10, 2),
  sold_by         bigint         not null references users(id) on update cascade on delete restrict,
  sold_at         timestamptz    not null default now(),
  status          sale_status    not null default 'completed',
  created_at      timestamptz    not null default now(),
  updated_at      timestamptz    not null default now()
);

create index idx_sales_branch_id on sales (branch_id);
create index idx_sales_sold_by   on sales (sold_by);
create index idx_sales_sold_at   on sales (sold_at);

create trigger sales_set_updated_at
  before update on sales
  for each row execute function set_updated_at();

-- Sale items
create table sale_items (
  id               bigserial      primary key,
  sale_id          bigint         not null references sales(id)     on update cascade on delete cascade,
  product_id       bigint         not null references products(id)  on update cascade on delete restrict,
  quantity         integer        not null,
  price            numeric(10, 2) not null,
  discounted_price numeric(10, 2),
  discount_id      bigint         references discounts(id)          on update cascade on delete set null,
  discount_amount  numeric(10, 2) default 0
);

create index idx_sale_items_sale_id    on sale_items (sale_id);
create index idx_sale_items_product_id on sale_items (product_id);
create index idx_sale_items_discount_id on sale_items (discount_id);