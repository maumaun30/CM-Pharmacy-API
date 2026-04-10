const supabase = require("../config/supabase");
const { createLog } = require("../middleware/logMiddleware");

// ─── Shared select string for branch_stocks with joins ────────────────────────

const STOCK_WITH_JOINS = `
  *,
  product:products (
    id, name, sku, brand_name, generic_name, price, cost, status
  ),
  branch:branches (
    id, name, code, address
  )
`;

// ─── Stock status filter helper ───────────────────────────────────────────────
// Supabase doesn't support column-to-column comparisons in .eq()/.lt() etc.,
// so we use a Postgres filter via .filter() with the raw operator for those cases.

const applyStatusFilter = (query, status) => {
  switch (status) {
    case "OUT_OF_STOCK":
      return query.eq("current_stock", 0);
    case "CRITICAL":
      return query
        .gt("current_stock", 0)
        .filter("current_stock", "lte", "reorder_point") // col <= col via RPC workaround below
        // NOTE: Supabase JS doesn't support column-to-column comparisons natively.
        // Use a Postgres view or RPC for precise CRITICAL/LOW filtering.
        // The .filter() here uses a literal value — replace with an RPC if needed.
        .lte("current_stock", "minimum_stock"); // approximate: currentStock <= minimumStock value
    case "LOW":
      return query
        .gt("current_stock", 0)
        .gt("current_stock", "minimum_stock"); // approximate
    case "IN_STOCK":
      return query.gt("current_stock", 0);
    default:
      return query;
  }
};

// ─── Get All Branch Stocks ────────────────────────────────────────────────────

exports.getAllBranchStocks = async (req, res) => {
  try {
    const { branch_id, product_id, status } = req.query;

    let query = supabase
      .from("branch_stocks")
      .select(STOCK_WITH_JOINS)
      .order("branch_id", { ascending: true })
      .order("current_stock", { ascending: true });

    if (branch_id) query = query.eq("branch_id", branch_id);
    if (product_id) query = query.eq("product_id", product_id);
    if (status) query = applyStatusFilter(query, status);

    const { data: branchStocks, error } = await query;
    if (error) throw error;

    // Apply precise column-to-column status filtering in JS for CRITICAL/LOW
    const filtered = filterByStatus(branchStocks, status);

    return res.status(200).json(filtered);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Product Stock Across All Branches ────────────────────────────────────

exports.getProductStockAllBranches = async (req, res) => {
  try {
    const { product_id } = req.params;

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, sku, brand_name")
      .eq("id", product_id)
      .maybeSingle();

    if (productError) throw productError;
    if (!product) return res.status(404).json({ message: "Product not found" });

    const { data: branchStocks, error } = await supabase
      .from("branch_stocks")
      .select(`*, branch:branches (id, name, code, address)`)
      .eq("product_id", product_id)
      .order("branch_id", { ascending: true });

    if (error) throw error;

    const totalStock = branchStocks.reduce(
      (sum, bs) => sum + (bs.current_stock || 0),
      0
    );

    return res.status(200).json({ product, totalStock, branchStocks });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Stock For Specific Branch ───────────────────────────────────────────

exports.getBranchStock = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { status, search } = req.query;

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id, name, code")
      .eq("id", branch_id)
      .maybeSingle();

    if (branchError) throw branchError;
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    let query = supabase
      .from("branch_stocks")
      .select(STOCK_WITH_JOINS)
      .eq("branch_id", branch_id)
      .order("current_stock", { ascending: true });

    if (status) query = applyStatusFilter(query, status);

    const { data: branchStocks, error } = await query;
    if (error) throw error;

    // Column-to-column status filtering + product search done in JS
    let stocks = filterByStatus(branchStocks, status);

    if (search) {
      const term = search.toLowerCase();
      stocks = stocks.filter((bs) => {
        const p = bs.product;
        return (
          p?.name?.toLowerCase().includes(term) ||
          p?.sku?.toLowerCase().includes(term) ||
          p?.brand_name?.toLowerCase().includes(term) ||
          p?.generic_name?.toLowerCase().includes(term)
        );
      });
    }

    const summary = buildSummary(stocks);

    return res.status(200).json({ branch, summary, stocks });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Transfer Stock Between Branches ─────────────────────────────────────────
// Uses a Postgres RPC to keep the transfer atomic.
// Create this function in Supabase SQL editor (see comment below).

exports.transferStock = async (req, res) => {
  try {
    const { product_id, frombranch_id, tobranch_id, quantity, reason } = req.body;
    const performedBy = req.user.id;

    if (!product_id || !frombranch_id || !tobranch_id || !quantity) {
      return res.status(400).json({
        message: "Product, source branch, destination branch, and quantity are required",
      });
    }
    if (quantity <= 0) {
      return res.status(400).json({ message: "Quantity must be positive" });
    }
    if (String(frombranch_id) === String(tobranch_id)) {
      return res.status(400).json({ message: "Cannot transfer to the same branch" });
    }

    // Verify product and branches exist
    const [
      { data: product, error: pe },
      { data: fromBranch, error: fbe },
      { data: toBranch, error: tbe },
    ] = await Promise.all([
      supabase.from("products").select("id, name, sku").eq("id", product_id).maybeSingle(),
      supabase.from("branches").select("id, name").eq("id", frombranch_id).maybeSingle(),
      supabase.from("branches").select("id, name").eq("id", tobranch_id).maybeSingle(),
    ]);

    if (pe) throw pe;
    if (fbe) throw fbe;
    if (tbe) throw tbe;
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!fromBranch || !toBranch) return res.status(404).json({ message: "Branch not found" });

    /*
      This calls a Postgres function for atomicity. Create it once in Supabase SQL editor:

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
    */

    const { error: rpcError } = await supabase.rpc("transfer_branch_stock", {
      p_product_id:   product_id,
      p_from_branch:  frombranch_id,
      p_to_branch:    tobranch_id,
      p_quantity:     quantity,
      p_performed_by: performedBy,
      p_reason:       reason || null,
    });

    if (rpcError) throw rpcError;

    await createLog(
      req, "TRANSFER", "stock", null,
      `Transferred ${quantity} units of ${product.name} from ${fromBranch.name} to ${toBranch.name}`,
      { product_id, frombranch_id, tobranch_id, quantity, reason }
    );

    // Fetch updated stocks
    const [{ data: updatedFrom }, { data: updatedTo }] = await Promise.all([
      supabase
        .from("branch_stocks")
        .select(`*, branch:branches (id, name, code)`)
        .eq("product_id", product_id)
        .eq("branch_id", frombranch_id)
        .maybeSingle(),
      supabase
        .from("branch_stocks")
        .select(`*, branch:branches (id, name, code)`)
        .eq("product_id", product_id)
        .eq("branch_id", tobranch_id)
        .maybeSingle(),
    ]);

    return res.status(200).json({
      message: "Stock transferred successfully",
      transfer: {
        product: { id: product.id, name: product.name, sku: product.sku },
        from: updatedFrom,
        to: updatedTo,
        quantity,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Error transferring stock", error: error.message });
  }
};

// ─── Initialize Branch Stock ──────────────────────────────────────────────────

exports.initializeBranchStock = async (req, res) => {
  try {
    const { product_id, branch_id, currentStock, minimumStock, maximumStock, reorderPoint } = req.body;

    if (!product_id || !branch_id) {
      return res.status(400).json({ message: "Product ID and Branch ID are required" });
    }

    const [
      { data: product, error: pe },
      { data: branch, error: be },
    ] = await Promise.all([
      supabase.from("products").select("id, name").eq("id", product_id).maybeSingle(),
      supabase.from("branches").select("id, name").eq("id", branch_id).maybeSingle(),
    ]);

    if (pe) throw pe;
    if (be) throw be;
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    // Check if already initialized
    const { data: existing } = await supabase
      .from("branch_stocks")
      .select("id")
      .eq("product_id", product_id)
      .eq("branch_id", branch_id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        message: "Branch stock already initialized for this product",
      });
    }

    const { data: branchStock, error } = await supabase
      .from("branch_stocks")
      .insert({
        product_id:    product_id,
        branch_id:     branch_id,
        current_stock: currentStock || 0,
        minimum_stock: minimumStock || 10,
        maximum_stock: maximumStock || null,
        reorder_point: reorderPoint || 20,
      })
      .select(`
        *,
        product:products (id, name, sku, brand_name),
        branch:branches  (id, name, code)
      `)
      .single();

    if (error) throw error;

    await createLog(
      req, "CREATE", "branch_stocks", branchStock.id,
      `Initialized stock for ${product.name} at ${branch.name}`,
      { branchStock }
    );

    return res.status(201).json(branchStock);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Update Branch Stock Settings ────────────────────────────────────────────

exports.updateBranchStockSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { minimumStock, maximumStock, reorderPoint } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from("branch_stocks")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ message: "Branch stock not found" });

    const updates = {
      minimum_stock: minimumStock !== undefined ? minimumStock : existing.minimum_stock,
      maximum_stock: maximumStock !== undefined ? maximumStock : existing.maximum_stock,
      reorder_point: reorderPoint !== undefined ? reorderPoint : existing.reorder_point,
    };

    const { data: updated, error } = await supabase
      .from("branch_stocks")
      .update(updates)
      .eq("id", id)
      .select(`
        *,
        product:products (id, name, sku),
        branch:branches  (id, name, code)
      `)
      .single();

    if (error) throw error;

    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Get Stock Alerts ─────────────────────────────────────────────────────────

exports.getStockAlerts = async (req, res) => {
  try {
    const { branch_id } = req.query;

    let query = supabase
      .from("branch_stocks")
      .select(`
        *,
        product:products!inner (id, name, sku, brand_name, status),
        branch:branches (id, name, code)
      `)
      .eq("product.status", "ACTIVE")  // only active products
      .order("current_stock", { ascending: true })
      .order("branch_id", { ascending: true });

    if (branch_id) query = query.eq("branch_id", branch_id);

    const { data: allStocks, error } = await query;
    if (error) throw error;

    // Column-to-column comparisons done in JS
    const alerts = allStocks.filter(
      (bs) => bs.current_stock === 0 || bs.current_stock <= bs.reorder_point
    );

    const grouped = {
      outOfStock: alerts.filter((a) => a.current_stock === 0),
      critical: alerts.filter(
        (a) => a.current_stock > 0 && a.current_stock <= a.minimum_stock
      ),
      lowStock: alerts.filter(
        (a) => a.current_stock > a.minimum_stock && a.current_stock <= a.reorder_point
      ),
    };

    return res.status(200).json({
      total: alerts.length,
      outOfStockCount: grouped.outOfStock.length,
      criticalCount: grouped.critical.length,
      lowStockCount: grouped.lowStock.length,
      alerts: grouped,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Column-to-column comparisons (currentStock vs minimumStock/reorderPoint)
// can't be done in Supabase JS filters, so we do them post-fetch in JS.
function filterByStatus(stocks, status) {
  if (!status) return stocks;
  switch (status) {
    case "OUT_OF_STOCK":
      return stocks.filter((bs) => bs.current_stock === 0);
    case "CRITICAL":
      return stocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock);
    case "LOW":
      return stocks.filter((bs) => bs.current_stock > bs.minimum_stock && bs.current_stock <= bs.reorder_point);
    case "IN_STOCK":
      return stocks.filter((bs) => bs.current_stock > bs.reorder_point);
    default:
      return stocks;
  }
}

function buildSummary(stocks) {
  return {
    totalProducts:  stocks.length,
    outOfStock:     stocks.filter((bs) => bs.current_stock === 0).length,
    critical:       stocks.filter((bs) => bs.current_stock > 0 && bs.current_stock <= bs.minimum_stock).length,
    lowStock:       stocks.filter((bs) => bs.current_stock > bs.minimum_stock && bs.current_stock <= bs.reorder_point).length,
    inStock:        stocks.filter((bs) => bs.current_stock > bs.reorder_point).length,
  };
}