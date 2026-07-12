-- Atomic sale creation. Source of truth for sale + stock mutation.
-- Kept in sync with the documenting comment in controllers/saleController.js.
-- Inserts the sale header, each sale_item, and (for products with
-- track_inventory = true) locks branch_stocks FOR UPDATE, deducts stock (which
-- MAY go negative — overselling is allowed; the next stock-in nets it out), and
-- writes a stock ledger row. Products with track_inventory = false (services /
-- non-stock items) skip all branch_stocks handling entirely.

-- Adding args changes the signature, so drop the previous 8-arg version first
-- (CREATE OR REPLACE would otherwise leave it as an ambiguous overload).
drop function if exists create_sale(
  bigint, bigint, numeric, numeric, numeric, numeric, numeric, jsonb
);

create or replace function create_sale(
  p_sold_by      bigint,
  p_branch_id    bigint,
  p_subtotal     numeric,
  p_discount     numeric,
  p_total        numeric,
  p_cash         numeric,
  p_change       numeric,
  p_items        jsonb,
  -- [{ product_id, quantity, price, discounted_price, discount_id, discount_amount }]
  p_customer_name          text default null,
  p_customer_id_number     text default null,
  p_customer_discount_type text default null
)
returns bigint as $$
declare
  v_sale_id       bigint;
  v_item          jsonb;
  v_current_stock integer;
  v_new_stock     integer;
  v_product_id    bigint;
  v_quantity      integer;
  v_tracked       boolean;
begin
  -- 1. Create sale header
  insert into sales (
    sold_by, branch_id, subtotal, total_discount,
    total_amount, cash_amount, change_amount,
    customer_name, customer_id_number, customer_discount_type
  )
  values (
    p_sold_by, p_branch_id, p_subtotal, p_discount,
    p_total, p_cash, p_change,
    p_customer_name, p_customer_id_number, p_customer_discount_type
  )
  returning id into v_sale_id;

  -- 2. Process each cart item
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::bigint;
    v_quantity   := (v_item->>'quantity')::integer;

    -- Create sale item
    insert into sale_items (
      sale_id, product_id, quantity, price,
      discounted_price, discount_id, discount_amount
    )
    values (
      v_sale_id,
      v_product_id,
      v_quantity,
      (v_item->>'price')::numeric,
      nullif(v_item->>'discounted_price', '')::numeric,
      nullif(v_item->>'discount_id', '')::bigint,
      (v_item->>'discount_amount')::numeric
    );

    -- Skip all stock handling for products that don't track inventory
    -- (services / non-stock items have no branch_stocks row to deduct).
    select track_inventory into v_tracked
    from products
    where id = v_product_id;

    if coalesce(v_tracked, true) then
      -- Lock and fetch current branch stock
      select current_stock into v_current_stock
      from branch_stocks
      where product_id = v_product_id
        and branch_id  = p_branch_id
      for update;

      if v_current_stock is null then
        raise exception 'BranchStock not found for product % at branch %',
          v_product_id, p_branch_id;
      end if;

      -- Overselling is allowed for tracked products: stock may go negative, and
      -- the next stock-in nets it out automatically (quantity_before + received).
      v_new_stock := v_current_stock - v_quantity;

      -- Deduct stock
      update branch_stocks
      set current_stock = v_new_stock
      where product_id = v_product_id
        and branch_id  = p_branch_id;

      -- Log stock movement
      insert into stocks (
        product_id, branch_id, transaction_type,
        quantity, quantity_before, quantity_after,
        reference_id, reference_type, performed_by
      )
      values (
        v_product_id,
        p_branch_id,
        'SALE',
        -v_quantity,
        v_current_stock,
        v_new_stock,
        v_sale_id,
        'sale',
        p_sold_by
      );
    end if;
  end loop;

  return v_sale_id;
end;
$$ language plpgsql;
