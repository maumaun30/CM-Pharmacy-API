-- Atomic sale creation. Source of truth for sale + stock mutation.
-- Kept in sync with the documenting comment in controllers/saleController.js.
-- Inserts the sale header, each sale_item, locks branch_stocks FOR UPDATE,
-- validates + deducts stock, and writes a stock ledger row per item.

create or replace function create_sale(
  p_sold_by      bigint,
  p_branch_id    bigint,
  p_subtotal     numeric,
  p_discount     numeric,
  p_total        numeric,
  p_cash         numeric,
  p_change       numeric,
  p_items        jsonb
  -- [{ product_id, quantity, price, discounted_price, discount_id, discount_amount }]
)
returns bigint as $$
declare
  v_sale_id       bigint;
  v_item          jsonb;
  v_current_stock integer;
  v_new_stock     integer;
begin
  -- 1. Create sale header
  insert into sales (
    sold_by, branch_id, subtotal, total_discount,
    total_amount, cash_amount, change_amount
  )
  values (
    p_sold_by, p_branch_id, p_subtotal, p_discount,
    p_total, p_cash, p_change
  )
  returning id into v_sale_id;

  -- 2. Process each cart item
  for v_item in select * from jsonb_array_elements(p_items) loop
    -- Create sale item
    insert into sale_items (
      sale_id, product_id, quantity, price,
      discounted_price, discount_id, discount_amount
    )
    values (
      v_sale_id,
      (v_item->>'product_id')::bigint,
      (v_item->>'quantity')::integer,
      (v_item->>'price')::numeric,
      nullif(v_item->>'discounted_price', '')::numeric,
      nullif(v_item->>'discount_id', '')::bigint,
      (v_item->>'discount_amount')::numeric
    );

    -- Lock and fetch current branch stock
    select current_stock into v_current_stock
    from branch_stocks
    where product_id = (v_item->>'product_id')::bigint
      and branch_id  = p_branch_id
    for update;

    if v_current_stock is null then
      raise exception 'BranchStock not found for product % at branch %',
        (v_item->>'product_id'), p_branch_id;
    end if;

    v_new_stock := v_current_stock - (v_item->>'quantity')::integer;

    if v_new_stock < 0 then
      raise exception 'Insufficient stock for product %. Available: %, Requested: %',
        (v_item->>'product_id'), v_current_stock, (v_item->>'quantity')::integer;
    end if;

    -- Deduct stock
    update branch_stocks
    set current_stock = v_new_stock
    where product_id = (v_item->>'product_id')::bigint
      and branch_id  = p_branch_id;

    -- Log stock movement
    insert into stocks (
      product_id, branch_id, transaction_type,
      quantity, quantity_before, quantity_after,
      reference_id, reference_type, performed_by
    )
    values (
      (v_item->>'product_id')::bigint,
      p_branch_id,
      'SALE',
      -(v_item->>'quantity')::integer,
      v_current_stock,
      v_new_stock,
      v_sale_id,
      'sale',
      p_sold_by
    );
  end loop;

  return v_sale_id;
end;
$$ language plpgsql;
