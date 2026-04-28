-- Update get_top_products RPC to accept an optional p_until upper bound
-- so the analytics page can scope results to a specific period.

drop function if exists public.get_top_products(bigint, timestamptz, integer);
drop function if exists public.get_top_products(bigint, timestamptz, timestamptz, integer);

create or replace function public.get_top_products(
  p_branch_id bigint      default null,
  p_since     timestamptz default (now() - interval '30 days'),
  p_until     timestamptz default now(),
  p_limit     integer     default 10
)
returns table (
  id                  bigint,
  name                text,
  sku                 text,
  price               numeric,
  total_quantity_sold bigint,
  total_revenue       numeric,
  number_of_sales     bigint
) as $$
begin
  return query
  select
    p.id,
    p.name,
    p.sku,
    p.price,
    sum(si.quantity)::bigint           as total_quantity_sold,
    sum(si.quantity * si.price)        as total_revenue,
    count(distinct si.sale_id)::bigint as number_of_sales
  from products p
  inner join sale_items si on p.id = si.product_id
  inner join sales s       on si.sale_id = s.id
  where s.sold_at >= p_since
    and s.sold_at <= p_until
    and (p_branch_id is null or s.branch_id = p_branch_id)
  group by p.id, p.name, p.sku, p.price
  order by total_quantity_sold desc
  limit p_limit;
end;
$$ language plpgsql;
