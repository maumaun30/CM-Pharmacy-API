-- Atomic stock transfer between branches (locks source row, deducts, upserts
-- destination, writes two stock ledger rows). Mirror of the documenting comment
-- in controllers/branchStockController.js.

create or replace function transfer_branch_stock(
  p_product_id    bigint,
  p_from_branch   bigint,
  p_to_branch     bigint,
  p_quantity      integer,
  p_performed_by  bigint,
  p_reason        text default null
) returns void as $$
declare
  from_stock  integer;
  to_stock    integer;
begin
  -- Lock source stock row
  select current_stock into from_stock
  from branch_stocks
  where product_id = p_product_id and branch_id = p_from_branch
  for update;

  if from_stock is null then
    raise exception 'Source branch stock not initialized';
  end if;
  if from_stock < p_quantity then
    raise exception 'Insufficient stock: available %, requested %', from_stock, p_quantity;
  end if;

  -- Deduct from source
  update branch_stocks
  set current_stock = current_stock - p_quantity
  where product_id = p_product_id and branch_id = p_from_branch;

  -- Add to destination (upsert)
  insert into branch_stocks (product_id, branch_id, current_stock)
  values (p_product_id, p_to_branch, p_quantity)
  on conflict (product_id, branch_id)
  do update set current_stock = branch_stocks.current_stock + p_quantity;

  -- Log stock movements
  insert into stocks (product_id, branch_id, transaction_type, quantity, quantity_before, quantity_after, reason, performed_by)
  values
    (p_product_id, p_from_branch, 'ADJUSTMENT', -p_quantity, from_stock, from_stock - p_quantity, p_reason, p_performed_by),
    (p_product_id, p_to_branch,   'ADJUSTMENT',  p_quantity, coalesce((select current_stock from branch_stocks where product_id = p_product_id and branch_id = p_to_branch), 0) - p_quantity, coalesce((select current_stock from branch_stocks where product_id = p_product_id and branch_id = p_to_branch), 0), p_reason, p_performed_by);
end;
$$ language plpgsql;
