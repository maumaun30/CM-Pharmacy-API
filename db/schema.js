// AUTO-GENERATED from the live Postgres schema via `npx drizzle-kit pull`,
// then converted from ESM/TS to CommonJS for this JS project.
// Do not hand-edit table shapes here — re-run pull and re-convert if the DB schema changes.
// See docs/local-dev.md.

const { pgTable, uniqueIndex, index, unique, bigserial, text, varchar, boolean, jsonb, timestamp, foreignKey, bigint, numeric, integer, pgEnum } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const applicableTo = pgEnum("applicable_to", ['ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'CATEGORIES'])
const discountCategory = pgEnum("discount_category", ['PWD', 'SENIOR_CITIZEN', 'PROMOTIONAL', 'SEASONAL', 'OTHER'])
const discountType = pgEnum("discount_type", ['PERCENTAGE', 'FIXED_AMOUNT'])
const productStatus = pgEnum("product_status", ['ACTIVE', 'INACTIVE'])
const saleStatus = pgEnum("sale_status", ['completed', 'partially_refunded', 'fully_refunded'])
const stockTransactionType = pgEnum("stock_transaction_type", ['INITIAL_STOCK', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'REFUND'])


const branches = pgTable("branches", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	code: varchar({ length: 10 }).notNull(),
	address: text(),
	city: text(),
	province: text(),
	postalCode: varchar("postal_code", { length: 20 }),
	phone: varchar({ length: 50 }),
	email: text(),
	managerName: text("manager_name"),
	isActive: boolean("is_active").default(true).notNull(),
	isMainBranch: boolean("is_main_branch").default(false).notNull(),
	operatingHours: jsonb("operating_hours"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("branches_only_one_main").using("btree", table.isMainBranch.asc().nullsLast().op("bool_ops")).where(sql`(is_main_branch = true)`),
	index("idx_branches_city").using("btree", table.city.asc().nullsLast().op("text_ops")),
	index("idx_branches_code").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("idx_branches_is_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	unique("branches_name_key").on(table.name),
	unique("branches_code_key").on(table.code),
]);

const sales = pgTable("sales", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	branchId: bigint("branch_id", { mode: "number" }),
	subtotal: numeric({ precision: 10, scale: 2, mode: "number" }),
	totalDiscount: numeric("total_discount", { precision: 10, scale: 2, mode: "number" }).default('0'),
	totalAmount: numeric("total_amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
	cashAmount: numeric("cash_amount", { precision: 10, scale: 2, mode: "number" }),
	changeAmount: numeric("change_amount", { precision: 10, scale: 2, mode: "number" }),
	customerName: text("customer_name"),
	customerIdNumber: text("customer_id_number"),
	customerDiscountType: text("customer_discount_type"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	soldBy: bigint("sold_by", { mode: "number" }).notNull(),
	soldAt: timestamp("sold_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: saleStatus().default('completed').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sales_branch_id").using("btree", table.branchId.asc().nullsLast().op("int8_ops")),
	index("idx_sales_sold_at").using("btree", table.soldAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_sales_sold_by").using("btree", table.soldBy.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "sales_branch_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.soldBy],
			foreignColumns: [users.id],
			name: "sales_sold_by_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

const saleItems = pgTable("sale_items", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	saleId: bigint("sale_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	productId: bigint("product_id", { mode: "number" }).notNull(),
	quantity: integer().notNull(),
	price: numeric({ precision: 10, scale: 2, mode: "number" }).notNull(),
	discountedPrice: numeric("discounted_price", { precision: 10, scale: 2, mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	discountId: bigint("discount_id", { mode: "number" }),
	discountAmount: numeric("discount_amount", { precision: 10, scale: 2, mode: "number" }).default('0'),
}, (table) => [
	index("idx_sale_items_discount_id").using("btree", table.discountId.asc().nullsLast().op("int8_ops")),
	index("idx_sale_items_product_id").using("btree", table.productId.asc().nullsLast().op("int8_ops")),
	index("idx_sale_items_sale_id").using("btree", table.saleId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.saleId],
			foreignColumns: [sales.id],
			name: "sale_items_sale_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "sale_items_product_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.discountId],
			foreignColumns: [discounts.id],
			name: "sale_items_discount_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

const users = pgTable("users", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	username: text().notNull(),
	email: text().notNull(),
	password: text().notNull(),
	pin: text(),
	role: text().default('cashier').notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	contactNumber: text("contact_number"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	branchId: bigint("branch_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	currentBranchId: bigint("current_branch_id", { mode: "number" }),
	isActive: boolean("is_active").default(true).notNull(),
	// Google account linking. googleSub is the stable Google subject id and the
	// only key used to authenticate a Google login; googleEmail is audit/display
	// only and never trusted as an identity claim.
	googleSub: text("google_sub"),
	googleEmail: text("google_email"),
	googleLinkedAt: timestamp("google_linked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "users_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.currentBranchId],
			foreignColumns: [branches.id],
			name: "users_current_branch_id_fkey"
		}),
	unique("users_username_key").on(table.username),
	unique("users_email_key").on(table.email),
	unique("users_google_sub_key").on(table.googleSub),
]);

const categoryDiscounts = pgTable("category_discounts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	categoryId: bigint("category_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	discountId: bigint("discount_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_category_discounts_category").using("btree", table.categoryId.asc().nullsLast().op("int8_ops")),
	index("idx_category_discounts_discount").using("btree", table.discountId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "category_discounts_category_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.discountId],
			foreignColumns: [discounts.id],
			name: "category_discounts_discount_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("category_discount_unique").on(table.categoryId, table.discountId),
]);

const categories = pgTable("categories", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("categories_name_key").on(table.name),
]);

const logs = pgTable("logs", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }),
	action: text().notNull(),
	module: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	recordId: bigint("record_id", { mode: "number" }),
	description: text(),
	metadata: jsonb(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_logs_action").using("btree", table.action.asc().nullsLast().op("text_ops")),
	index("idx_logs_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_logs_module").using("btree", table.module.asc().nullsLast().op("text_ops")),
	index("idx_logs_module_record").using("btree", table.module.asc().nullsLast().op("int8_ops"), table.recordId.asc().nullsLast().op("text_ops")),
	index("idx_logs_user_id").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "logs_user_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

const refunds = pgTable("refunds", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	saleId: bigint("sale_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	branchId: bigint("branch_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	refundedBy: bigint("refunded_by", { mode: "number" }).notNull(),
	totalRefund: numeric("total_refund", { precision: 10, scale: 2, mode: "number" }).notNull(),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_refunds_branch_id").using("btree", table.branchId.asc().nullsLast().op("int8_ops")),
	index("idx_refunds_refunded_by").using("btree", table.refundedBy.asc().nullsLast().op("int8_ops")),
	index("idx_refunds_sale_id").using("btree", table.saleId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.saleId],
			foreignColumns: [sales.id],
			name: "refunds_sale_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "refunds_branch_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.refundedBy],
			foreignColumns: [users.id],
			name: "refunds_refunded_by_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

const refundItems = pgTable("refund_items", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	refundId: bigint("refund_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	saleItemId: bigint("sale_item_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	productId: bigint("product_id", { mode: "number" }).notNull(),
	quantity: integer().notNull(),
	refundAmount: numeric("refund_amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_refund_items_product_id").using("btree", table.productId.asc().nullsLast().op("int8_ops")),
	index("idx_refund_items_refund_id").using("btree", table.refundId.asc().nullsLast().op("int8_ops")),
	index("idx_refund_items_sale_item_id").using("btree", table.saleItemId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.refundId],
			foreignColumns: [refunds.id],
			name: "refund_items_refund_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.saleItemId],
			foreignColumns: [saleItems.id],
			name: "refund_items_sale_item_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "refund_items_product_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

const products = pgTable("products", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	sku: text().notNull(),
	barcode: text(),
	description: text(),
	price: numeric({ precision: 10, scale: 2, mode: "number" }).notNull(),
	cost: numeric({ precision: 10, scale: 2, mode: "number" }).notNull(),
	expiryDate: timestamp("expiry_date", { withTimezone: true, mode: 'string' }),
	brandName: text("brand_name"),
	genericName: text("generic_name"),
	dosage: text(),
	form: text(),
	requiresPrescription: boolean("requires_prescription").default(false).notNull(),
	trackInventory: boolean("track_inventory").default(true).notNull(),
	status: productStatus().default('ACTIVE').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	categoryId: bigint("category_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "products_category_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	unique("products_sku_key").on(table.sku),
	unique("products_barcode_key").on(table.barcode),
]);

const stocks = pgTable("stocks", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	branchId: bigint("branch_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	productId: bigint("product_id", { mode: "number" }).notNull(),
	transactionType: stockTransactionType("transaction_type").notNull(),
	quantity: integer().notNull(),
	quantityBefore: integer("quantity_before").notNull(),
	quantityAfter: integer("quantity_after").notNull(),
	unitCost: numeric("unit_cost", { precision: 10, scale: 2, mode: "number" }),
	totalCost: numeric("total_cost", { precision: 10, scale: 2, mode: "number" }),
	batchNumber: text("batch_number"),
	expiryDate: timestamp("expiry_date", { withTimezone: true, mode: 'string' }),
	supplier: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	referenceId: bigint("reference_id", { mode: "number" }),
	referenceType: text("reference_type"),
	reason: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	performedBy: bigint("performed_by", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_stocks_batch_number").using("btree", table.batchNumber.asc().nullsLast().op("text_ops")),
	index("idx_stocks_branch_id").using("btree", table.branchId.asc().nullsLast().op("int8_ops")),
	index("idx_stocks_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_stocks_performed_by").using("btree", table.performedBy.asc().nullsLast().op("int8_ops")),
	index("idx_stocks_product_id").using("btree", table.productId.asc().nullsLast().op("int8_ops")),
	index("idx_stocks_reference").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
	index("idx_stocks_transaction_type").using("btree", table.transactionType.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "stocks_branch_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "stocks_product_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.performedBy],
			foreignColumns: [users.id],
			name: "stocks_performed_by_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

const discounts = pgTable("discounts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	discountType: discountType("discount_type").default('PERCENTAGE').notNull(),
	discountValue: numeric("discount_value", { precision: 10, scale: 2, mode: "number" }).notNull(),
	discountCategory: discountCategory("discount_category").default('OTHER').notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	isEnabled: boolean("is_enabled").default(true).notNull(),
	requiresVerification: boolean("requires_verification").default(false).notNull(),
	applicableTo: applicableTo("applicable_to").default('ALL_PRODUCTS').notNull(),
	minimumPurchaseAmount: numeric("minimum_purchase_amount", { precision: 10, scale: 2, mode: "number" }),
	maximumDiscountAmount: numeric("maximum_discount_amount", { precision: 10, scale: 2, mode: "number" }),
	priority: integer().default(0).notNull(),
	stackable: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_discounts_category").using("btree", table.discountCategory.asc().nullsLast().op("enum_ops")),
	index("idx_discounts_dates").using("btree", table.startDate.asc().nullsLast().op("timestamptz_ops"), table.endDate.asc().nullsLast().op("timestamptz_ops")),
	index("idx_discounts_is_enabled").using("btree", table.isEnabled.asc().nullsLast().op("bool_ops")),
	index("idx_discounts_priority").using("btree", table.priority.asc().nullsLast().op("int4_ops")),
	unique("discounts_name_key").on(table.name),
]);

const productDiscounts = pgTable("product_discounts", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	productId: bigint("product_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	discountId: bigint("discount_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_product_discounts_discount").using("btree", table.discountId.asc().nullsLast().op("int8_ops")),
	index("idx_product_discounts_product").using("btree", table.productId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "product_discounts_product_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.discountId],
			foreignColumns: [discounts.id],
			name: "product_discounts_discount_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("product_discount_unique").on(table.productId, table.discountId),
]);

const branchStocks = pgTable("branch_stocks", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	productId: bigint("product_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	branchId: bigint("branch_id", { mode: "number" }).notNull(),
	currentStock: integer("current_stock").default(0).notNull(),
	minimumStock: integer("minimum_stock").default(10),
	maximumStock: integer("maximum_stock"),
	reorderPoint: integer("reorder_point").default(20),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_branch_stocks_branch_id").using("btree", table.branchId.asc().nullsLast().op("int8_ops")),
	index("idx_branch_stocks_current_stock").using("btree", table.currentStock.asc().nullsLast().op("int4_ops")),
	index("idx_branch_stocks_product_id").using("btree", table.productId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "branch_stocks_product_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "branch_stocks_branch_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("unique_product_branch").on(table.productId, table.branchId),
]);

module.exports = {
  applicableTo,
  discountCategory,
  discountType,
  productStatus,
  saleStatus,
  stockTransactionType,
  branches,
  sales,
  saleItems,
  users,
  categoryDiscounts,
  categories,
  logs,
  refunds,
  refundItems,
  products,
  stocks,
  discounts,
  productDiscounts,
  branchStocks,
};
