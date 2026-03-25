-- Migration: create_refunds_and_refund_items_tables

create table refunds (
  id            bigserial      primary key,
  sale_id       bigint         not null references sales(id)    on update cascade on delete restrict,
  branch_id     bigint         not null references branches(id) on update cascade on delete restrict,
  refunded_by   bigint         not null references users(id)    on update cascade on delete restrict,
  total_refund  numeric(10, 2) not null,
  reason        text,
  created_at    timestamptz    not null default now()
  -- No updated_at — refunds are immutable records
);

create index idx_refunds_sale_id     on refunds (sale_id);
create index idx_refunds_branch_id   on refunds (branch_id);
create index idx_refunds_refunded_by on refunds (refunded_by);

create table refund_items (
  id            bigserial      primary key,
  refund_id     bigint         not null references refunds(id)    on update cascade on delete cascade,
  sale_item_id  bigint         not null references sale_items(id) on update cascade on delete restrict,
  product_id    bigint         not null references products(id)   on update cascade on delete restrict,
  quantity      integer        not null,
  refund_amount numeric(10, 2) not null,
  created_at    timestamptz    not null default now()
);

create index idx_refund_items_refund_id    on refund_items (refund_id);
create index idx_refund_items_sale_item_id on refund_items (sale_item_id);
create index idx_refund_items_product_id   on refund_items (product_id);