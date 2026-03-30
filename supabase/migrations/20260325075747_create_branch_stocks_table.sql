-- Migration: create_branch_stocks_table

create table branch_stocks (
  id            bigserial   primary key,
  product_id    bigint      not null references products(id)  on update cascade on delete cascade,
  branch_id     bigint      not null references branches(id)  on update cascade on delete cascade,
  current_stock integer     not null default 0,
  minimum_stock integer     default 10,
  maximum_stock integer,
  reorder_point integer     default 20,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint unique_product_branch unique (product_id, branch_id)
);

create index idx_branch_stocks_branch_id     on branch_stocks (branch_id);
create index idx_branch_stocks_product_id    on branch_stocks (product_id);
create index idx_branch_stocks_current_stock on branch_stocks (current_stock);

create trigger branch_stocks_set_updated_at
  before update on branch_stocks
  for each row execute function set_updated_at();