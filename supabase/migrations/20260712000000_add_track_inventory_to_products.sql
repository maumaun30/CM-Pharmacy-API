-- Add per-product inventory tracking toggle.
-- Products with track_inventory = false are sold without any branch_stocks
-- requirement or deduction (e.g. services / non-stock items). Existing products
-- default to true so current stock-controlled behavior is unchanged.
alter table products
  add column if not exists track_inventory boolean not null default true;
