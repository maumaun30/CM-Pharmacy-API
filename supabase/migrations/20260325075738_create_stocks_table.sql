-- Migration: create_stocks_table

create type stock_transaction_type as enum (
  'INITIAL_STOCK',
  'PURCHASE',
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'DAMAGE',
  'EXPIRED',
  'REFUND'
);

create table stocks (
  id               bigserial              primary key,
  branch_id        bigint                 references branches(id)  on update cascade on delete restrict,
  product_id       bigint                 not null references products(id) on update cascade on delete cascade,
  transaction_type stock_transaction_type not null,
  quantity         integer                not null,
  quantity_before  integer                not null,
  quantity_after   integer                not null,
  unit_cost        numeric(10, 2),
  total_cost       numeric(10, 2),
  batch_number     text,
  expiry_date      timestamptz,
  supplier         text,
  reference_id     bigint,
  reference_type   text,
  reason           text,
  performed_by     bigint                 not null references users(id) on update cascade on delete restrict,
  created_at       timestamptz            not null default now()
  -- No updated_at — stock ledger rows are immutable
);

create index idx_stocks_branch_id        on stocks (branch_id);
create index idx_stocks_product_id       on stocks (product_id);
create index idx_stocks_transaction_type on stocks (transaction_type);
create index idx_stocks_created_at       on stocks (created_at);
create index idx_stocks_performed_by     on stocks (performed_by);
create index idx_stocks_batch_number     on stocks (batch_number);
create index idx_stocks_reference        on stocks (reference_type, reference_id);