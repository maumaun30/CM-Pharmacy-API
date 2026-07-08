-- Atomic refund: refunds + refund_items + branch_stocks (restore) + stocks
-- ledger + sales.status update, all in one transaction. Mirror of the
-- documenting comment in controllers/refundController.js.

create or replace function process_refund(
  p_sale_id       bigint,
  p_branch_id     bigint,
  p_refunded_by   bigint,
  p_total_refund  numeric,
  p_reason        text,
  p_items         jsonb,
  -- [{ sale_item_id, product_id, quantity, refund_amount }]
  p_new_sale_status text
)
returns bigint as $$
declare
  v_refund_id      bigint;
  v_item           jsonb;
  v_current_stock  integer;
  v_new_stock      integer;
begin
  -- 1. Create refund header
  insert into refunds (sale_id, branch_id, refunded_by, total_refund, reason)
  values (p_sale_id, p_branch_id, p_refunded_by, p_total_refund, p_reason)
  returning id into v_refund_id;

  -- 2. Process each item
  for v_item in select * from jsonb_array_elements(p_items) loop
    -- Create refund item
    insert into refund_items (refund_id, sale_item_id, product_id, quantity, refund_amount)
    values (
      v_refund_id,
      (v_item->>'sale_item_id')::bigint,
      (v_item->>'product_id')::bigint,
      (v_item->>'quantity')::integer,
      (v_item->>'refund_amount')::numeric
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

    v_new_stock := v_current_stock + (v_item->>'quantity')::integer;

    -- Restore stock
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
      'REFUND',
      (v_item->>'quantity')::integer,
      v_current_stock,
      v_new_stock,
      v_refund_id,
      'refund',
      p_refunded_by
    );
  end loop;

  -- 3. Update sale status (cast text -> sale_status enum)
  update sales set status = p_new_sale_status::sale_status where id = p_sale_id;

  return v_refund_id;
end;
$$ language plpgsql;
