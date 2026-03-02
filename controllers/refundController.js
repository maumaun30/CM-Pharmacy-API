const {
  Sale,
  SaleItem,
  Product,
  User,
  Discount,
  Refund,
  RefundItem,
  Stock,
  Branch,
  BranchStock,
} = require("../models");
const { createLog } = require("../middleware/logMiddleware");
const { emitDashboardRefresh, emitStockUpdate } = require("../utils/socket");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales/:saleId/refunds
// Body: { items: [{ saleItemId, quantity }], reason? }
// ─────────────────────────────────────────────────────────────────────────────
exports.createRefund = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { items, reason } = req.body;

    // ── 1. Basic input validation ────────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Refund items are required" });
    }

    for (const item of items) {
      if (!item.saleItemId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          message: "Each refund item must have a valid saleItemId and quantity",
        });
      }
    }

    // ── 2. Resolve requesting user & active branch ───────────────────────────
    const user = await User.findByPk(req.user.id, {
      include: [
        { model: Branch, as: "branch" },
        { model: Branch, as: "currentBranch" },
      ],
    });

    const activeBranchId = user.currentBranchId || user.branchId;

    if (!activeBranchId) {
      return res
        .status(400)
        .json({ message: "User is not assigned to any branch" });
    }

    // ── 3. Fetch the original sale ───────────────────────────────────────────
    const sale = await Sale.findByPk(saleId, {
      include: [
        {
          model: SaleItem,
          as: "items",
          include: [{ model: Product, as: "Product" }],
        },
      ],
    });

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    // Prevent refunding a sale from a different branch (non-admins)
    if (user.role !== "admin" && sale.branchId !== activeBranchId) {
      return res.status(403).json({
        message: "You are not allowed to refund sales from other branches",
      });
    }

    // ── 4. Fetch already-refunded quantities for this sale ───────────────────
    const existingRefunds = await RefundItem.findAll({
      include: [
        {
          model: Refund,
          as: "refund",
          where: { saleId },
          attributes: [],
        },
      ],
      attributes: ["saleItemId", "quantity"],
    });

    // Map: saleItemId → total already-refunded quantity
    const alreadyRefunded = existingRefunds.reduce((acc, ri) => {
      acc[ri.saleItemId] = (acc[ri.saleItemId] || 0) + ri.quantity;
      return acc;
    }, {});

    // ── 5. Validate each requested refund item ───────────────────────────────
    const saleItemMap = new Map(sale.items.map((si) => [si.id, si]));
    let calculatedTotalRefund = 0;
    const stockUpdates = [];

    for (const item of items) {
      const saleItem = saleItemMap.get(item.saleItemId);

      if (!saleItem) {
        return res.status(404).json({
          message: `SaleItem ID ${item.saleItemId} does not belong to Sale #${saleId}`,
        });
      }

      const previouslyRefunded = alreadyRefunded[item.saleItemId] || 0;
      const refundableQty = saleItem.quantity - previouslyRefunded;

      if (item.quantity > refundableQty) {
        return res.status(400).json({
          message: `Cannot refund ${item.quantity} of "${saleItem.Product.name}". Refundable: ${refundableQty}`,
        });
      }

      // Use the discounted price if one was applied, otherwise original price
      const unitPrice = saleItem.discountedPrice
        ? Number(saleItem.discountedPrice)
        : Number(saleItem.price);

      calculatedTotalRefund += unitPrice * item.quantity;

      stockUpdates.push({
        productId: saleItem.productId,
        quantity: item.quantity,
        saleItemId: saleItem.id,
        refundAmount: unitPrice * item.quantity,
        unitPrice,
      });
    }

    // ── 6. Run everything inside a transaction ───────────────────────────────
    const result = await Sale.sequelize.transaction(async (t) => {
      // Create the Refund header
      const refund = await Refund.create(
        {
          saleId: sale.id,
          branchId: sale.branchId,
          refundedBy: req.user.id,
          totalRefund: calculatedTotalRefund,
          reason: reason || null,
        },
        { transaction: t },
      );

      // Create RefundItems, restore BranchStock, and log each Stock movement
      for (const su of stockUpdates) {
        // RefundItem record
        await RefundItem.create(
          {
            refundId: refund.id,
            saleItemId: su.saleItemId,
            productId: su.productId,
            quantity: su.quantity,
            refundAmount: su.refundAmount,
          },
          { transaction: t },
        );

        // Fetch current branch stock so we have an accurate "before" value
        const branchStock = await BranchStock.findOne({
          where: { productId: su.productId, branchId: sale.branchId },
          transaction: t,
          lock: t.LOCK.UPDATE, // prevent race conditions
        });

        if (!branchStock) {
          throw new Error(
            `BranchStock record not found for product ${su.productId} at branch ${sale.branchId}`,
          );
        }

        const newStockLevel = branchStock.currentStock + su.quantity;

        await BranchStock.update(
          { currentStock: newStockLevel },
          {
            where: { productId: su.productId, branchId: sale.branchId },
            transaction: t,
          },
        );

        await Stock.create(
          {
            productId: su.productId,
            branchId: sale.branchId,
            transactionType: "REFUND",
            quantity: su.quantity, // positive — stock is returning
            quantityBefore: branchStock.currentStock,
            quantityAfter: newStockLevel,
            referenceId: refund.id,
            referenceType: "refund",
            performedBy: req.user.id,
          },
          { transaction: t },
        );

        // Store the new level for socket emission after commit
        su.newStockLevel = newStockLevel;
      }

      // Optional: update Sale status
      // Determine whether the whole sale is now fully refunded
      const totalSaleQty = sale.items.reduce((s, i) => s + i.quantity, 0);
      const totalRefundedQty = Object.values(alreadyRefunded).reduce(
        (s, q) => s + q,
        0,
      ) + items.reduce((s, i) => s + i.quantity, 0);

      const newStatus =
        totalRefundedQty >= totalSaleQty
          ? "fully_refunded"
          : "partially_refunded";

      await Sale.update(
        { status: newStatus },
        { where: { id: sale.id }, transaction: t },
      );

      return refund;
    });

    // ── 7. Audit log ─────────────────────────────────────────────────────────
    await createLog(
      req,
      "REFUND",
      "refunds",
      result.id,
      `Processed refund #${result.id} for Sale #${sale.id} - Refund: ₱${calculatedTotalRefund.toFixed(2)}`,
      {
        saleId: sale.id,
        items: items.length,
        totalRefund: calculatedTotalRefund,
        reason: reason || null,
        branch: sale.branchId,
      },
    );

    // ── 8. Socket emissions ──────────────────────────────────────────────────
    for (const su of stockUpdates) {
      emitStockUpdate(sale.branchId, {
        productId: su.productId,
        newStock: su.newStockLevel,
      });
    }

    emitDashboardRefresh(sale.branchId);

    // ── 9. Response ──────────────────────────────────────────────────────────
    return res.status(201).json({
      message: "Refund processed successfully",
      refundId: result.id,
      saleId: sale.id,
      totalRefund: calculatedTotalRefund,
      reason: reason || null,
      items: stockUpdates.map((su) => ({
        saleItemId: su.saleItemId,
        productId: su.productId,
        quantity: su.quantity,
        refundAmount: su.refundAmount,
      })),
    });
  } catch (error) {
    console.error("Refund error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales/:saleId/refunds
// Returns all refunds for a given sale
// ─────────────────────────────────────────────────────────────────────────────
exports.getRefundsBySale = async (req, res) => {
  try {
    const { saleId } = req.params;

    const refunds = await Refund.findAll({
      where: { saleId },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: User,
          as: "refunder",
          attributes: ["id", "username", "firstName", "lastName"],
        },
        {
          model: RefundItem,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["id", "name"],
            },
          ],
        },
      ],
    });

    const response = refunds.map((refund) => ({
      id: refund.id,
      saleId: refund.saleId,
      totalRefund: parseFloat(refund.totalRefund),
      reason: refund.reason,
      createdAt: refund.createdAt,
      refundedBy: refund.refunder
        ? {
            id: refund.refunder.id,
            name:
              refund.refunder.firstName && refund.refunder.lastName
                ? `${refund.refunder.firstName} ${refund.refunder.lastName}`.trim()
                : refund.refunder.username || "Unknown",
          }
        : null,
      items: refund.items.map((item) => ({
        id: item.id,
        product: { id: item.product.id, name: item.product.name },
        quantity: item.quantity,
        refundAmount: parseFloat(item.refundAmount),
      })),
    }));

    res.json(response);
  } catch (error) {
    console.error("Error fetching refunds:", error);
    res.status(500).json({ message: "Error fetching refunds", error: error.message });
  }
};