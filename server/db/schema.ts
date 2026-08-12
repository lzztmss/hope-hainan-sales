import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "sales",
  "store_manager",
  "admin",
]);
export const personnelTypeEnum = pgEnum("personnel_type", [
  "unicom",
  "auxiliary",
  "admin",
]);
export const quoteStatusEnum = pgEnum("quote_status", [
  "confirmed",
  "converted",
  "expired",
  "lost",
  "voided",
]);
export const paymentModeEnum = pgEnum("payment_mode", [
  "one_time",
  "contract_36",
]);
export const fttrKindEnum = pgEnum("fttr_kind", [
  "none",
  "standard",
  "custom",
]);
export const quoteLineTypeEnum = pgEnum("quote_line_type", [
  "charge",
  "component",
]);
export const printEventTypeEnum = pgEnum("print_event_type", [
  "initial",
  "reprint",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "accepted",
  "activated",
  "completed",
  "cancelled",
  "return_pending",
  "partially_returned",
  "returned",
  "voided",
]);
export const orderAttributionRoleEnum = pgEnum("order_attribution_role", [
  "primary",
  "collaborator",
]);
export const returnTypeEnum = pgEnum("return_type", ["full", "partial"]);
export const returnStatusEnum = pgEnum("return_status", [
  "requested",
  "approved",
  "rejected",
  "completed",
]);
export const commissionPolicyStatusEnum = pgEnum(
  "commission_policy_status",
  ["draft", "published", "stopped"],
);
export const commissionRuleStatusEnum = pgEnum("commission_rule_status", [
  "active",
  "inactive",
]);
export const commissionBusinessDomainEnum = pgEnum(
  "commission_business_domain",
  ["fttr", "heartlink"],
);
export const commissionTargetTypeEnum = pgEnum("commission_target_type", [
  "product",
  "package",
  "fttr_plan",
]);
export const commissionPaymentModeScopeEnum = pgEnum(
  "commission_payment_mode_scope",
  ["all", "one_time", "contract_36"],
);
export const commissionCalculationBasisEnum = pgEnum(
  "commission_calculation_basis",
  ["per_order", "per_unit"],
);
export const commissionPackageModeEnum = pgEnum("commission_package_mode", [
  "additive",
  "fixed_override",
]);
export const commissionAttributionScopeEnum = pgEnum(
  "commission_attribution_scope",
  ["all", "primary", "collaborator"],
);
export const commissionLedgerEntryTypeEnum = pgEnum(
  "commission_ledger_entry_type",
  [
    "accrual",
    "return_reversal",
    "manual_positive",
    "manual_negative",
    "settlement",
    "settlement_reversal",
  ],
);
export const settlementBatchStatusEnum = pgEnum("settlement_batch_status", [
  "draft",
  "approved",
  "paid",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("stores_code_unique").on(table.code)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workNo: varchar("work_no", { length: 64 }).notNull(),
    phoneEncrypted: text("phone_encrypted"),
    phoneLookupHash: varchar("phone_lookup_hash", { length: 128 }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    personnelType: personnelTypeEnum("personnel_type").notNull(),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    active: boolean("active").default(true).notNull(),
    mustChangePassword: boolean("must_change_password")
      .default(true)
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_work_no_unique").on(table.workNo),
    uniqueIndex("users_phone_lookup_hash_unique")
      .on(table.phoneLookupHash)
      .where(sql`${table.phoneLookupHash} IS NOT NULL`),
    index("users_store_idx").on(table.storeId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    nameEncrypted: text("name_encrypted").notNull(),
    phoneEncrypted: text("phone_encrypted").notNull(),
    phoneLookupHash: varchar("phone_lookup_hash", { length: 128 }).notNull(),
    phoneTail: varchar("phone_tail", { length: 4 }).notNull(),
    districtEncrypted: text("district_encrypted"),
    addressEncrypted: text("address_encrypted"),
    roomType: varchar("room_type", { length: 32 }),
    elderCount: integer("elder_count").notNull(),
    source: varchar("source", { length: 120 }),
    notesEncrypted: text("notes_encrypted"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("customers_store_owner_idx").on(table.storeId, table.ownerUserId),
    index("customers_phone_tail_idx").on(table.phoneTail),
    index("customers_phone_lookup_idx").on(table.phoneLookupHash),
    check(
      "customers_elder_count_range",
      sql`${table.elderCount} BETWEEN 1 AND 20`,
    ),
    check("customers_version_positive", sql`${table.version} >= 1`),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteNo: varchar("quote_no", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: quoteStatusEnum("status").notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    fttrKind: fttrKindEnum("fttr_kind").notNull(),
    fttrPlan: integer("fttr_plan"),
    customFttrNote: text("custom_fttr_note"),
    fttrMonthlyFen: integer("fttr_monthly_fen").notNull(),
    heartMonthlyFen: integer("heart_monthly_fen").notNull(),
    oneTimeFen: integer("one_time_fen").notNull(),
    monthlyTotalFen: integer("monthly_total_fen").notNull(),
    contract36Fen: integer("contract_36_fen").notNull(),
    catalogVersion: varchar("catalog_version", { length: 64 }).notNull(),
    customerSnapshot: jsonb("customer_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    quoteSnapshot: jsonb("quote_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quotes_quote_no_unique").on(table.quoteNo),
    uniqueIndex("quotes_idempotency_key_unique").on(table.idempotencyKey),
    index("quotes_store_seller_idx").on(table.storeId, table.sellerId),
    index("quotes_customer_idx").on(table.customerId),
    index("quotes_confirmed_at_idx").on(table.confirmedAt),
    check(
      "quotes_amounts_nonnegative",
      sql`${table.fttrMonthlyFen} >= 0 AND ${table.heartMonthlyFen} >= 0 AND ${table.oneTimeFen} >= 0 AND ${table.monthlyTotalFen} >= 0 AND ${table.contract36Fen} >= 0`,
    ),
    check(
      "quotes_fttr_state_consistent",
      sql`(
        ${table.fttrKind} = 'none'
        AND ${table.fttrPlan} IS NULL
        AND ${table.fttrMonthlyFen} = 0
        AND ${table.customFttrNote} IS NULL
      ) OR (
        ${table.fttrKind} = 'standard'
        AND ${table.fttrPlan} IN (129, 159, 199, 239, 299, 399)
        AND ${table.fttrMonthlyFen} = ${table.fttrPlan} * 100
        AND ${table.customFttrNote} IS NULL
      ) OR (
        ${table.fttrKind} = 'custom'
        AND ${table.fttrPlan} BETWEEN 1 AND 9999
        AND ${table.fttrMonthlyFen} = ${table.fttrPlan} * 100
        AND NULLIF(BTRIM(${table.customFttrNote}), '') IS NOT NULL
      )`,
    ),
    check("quotes_version_positive", sql`${table.version} >= 1`),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    lineType: quoteLineTypeEnum("line_type").notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    quantity: integer("quantity").notNull(),
    oneTimeUnitFen: integer("one_time_unit_fen").default(0).notNull(),
    monthlyUnitFen: integer("monthly_unit_fen").default(0).notNull(),
    oneTimeSubtotalFen: integer("one_time_subtotal_fen").default(0).notNull(),
    monthlySubtotalFen: integer("monthly_subtotal_fen").default(0).notNull(),
    locations: jsonb("locations").$type<string[]>().default([]).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quote_lines_quote_idx").on(table.quoteId),
    check("quote_lines_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "quote_lines_amounts_nonnegative",
      sql`${table.oneTimeUnitFen} >= 0 AND ${table.monthlyUnitFen} >= 0 AND ${table.oneTimeSubtotalFen} >= 0 AND ${table.monthlySubtotalFen} >= 0`,
    ),
  ],
);

export const printEvents = pgTable(
  "print_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: printEventTypeEnum("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("print_events_quote_idx").on(table.quoteId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id"),
    action: varchar("action", { length: 80 }).notNull(),
    beforeSnapshot: jsonb("before_snapshot").$type<Record<string, unknown>>(),
    afterSnapshot: jsonb("after_snapshot").$type<Record<string, unknown>>(),
    reason: text("reason"),
    sourceIp: varchar("source_ip", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNo: varchar("order_no", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    fttrKind: fttrKindEnum("fttr_kind").notNull(),
    fttrPlan: integer("fttr_plan"),
    customFttrNote: text("custom_fttr_note"),
    fttrMonthlyFen: integer("fttr_monthly_fen").notNull(),
    heartMonthlyFen: integer("heart_monthly_fen").notNull(),
    oneTimeFen: integer("one_time_fen").notNull(),
    monthlyTotalFen: integer("monthly_total_fen").notNull(),
    contract36Fen: integer("contract_36_fen").notNull(),
    refundedFen: integer("refunded_fen").default(0).notNull(),
    catalogVersion: varchar("catalog_version", { length: 64 }).notNull(),
    catalogSnapshot: jsonb("catalog_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    customerSnapshot: jsonb("customer_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    quoteSnapshot: jsonb("quote_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    storeSnapshot: jsonb("store_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    sellerSnapshot: jsonb("seller_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("orders_order_no_unique").on(table.orderNo),
    uniqueIndex("orders_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("orders_quote_id_unique").on(table.quoteId),
    index("orders_store_seller_created_idx").on(
      table.storeId,
      table.sellerId,
      table.createdAt,
    ),
    index("orders_customer_idx").on(table.customerId),
    index("orders_status_created_idx").on(table.status, table.createdAt),
    check(
      "orders_amounts_nonnegative",
      sql`${table.fttrMonthlyFen} >= 0 AND ${table.heartMonthlyFen} >= 0 AND ${table.oneTimeFen} >= 0 AND ${table.monthlyTotalFen} >= 0 AND ${table.contract36Fen} >= 0 AND ${table.refundedFen} >= 0`,
    ),
    check(
      "orders_fttr_state_consistent",
      sql`(
        ${table.fttrKind} = 'none'
        AND ${table.fttrPlan} IS NULL
        AND ${table.fttrMonthlyFen} = 0
        AND ${table.customFttrNote} IS NULL
      ) OR (
        ${table.fttrKind} = 'standard'
        AND ${table.fttrPlan} IN (129, 159, 199, 239, 299, 399)
        AND ${table.fttrMonthlyFen} = ${table.fttrPlan} * 100
        AND ${table.customFttrNote} IS NULL
      ) OR (
        ${table.fttrKind} = 'custom'
        AND ${table.fttrPlan} BETWEEN 1 AND 9999
        AND ${table.fttrMonthlyFen} = ${table.fttrPlan} * 100
        AND NULLIF(BTRIM(${table.customFttrNote}), '') IS NOT NULL
      )`,
    ),
    check("orders_version_positive", sql`${table.version} >= 1`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    quoteLineId: uuid("quote_line_id").references(() => quoteLines.id, {
      onDelete: "restrict",
    }),
    lineType: quoteLineTypeEnum("line_type").notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    quantity: integer("quantity").notNull(),
    oneTimeUnitFen: integer("one_time_unit_fen").default(0).notNull(),
    monthlyUnitFen: integer("monthly_unit_fen").default(0).notNull(),
    oneTimeSubtotalFen: integer("one_time_subtotal_fen").default(0).notNull(),
    monthlySubtotalFen: integer("monthly_subtotal_fen").default(0).notNull(),
    locations: jsonb("locations").$type<string[]>().default([]).notNull(),
    reason: text("reason"),
    lineSnapshot: jsonb("line_snapshot")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("order_lines_order_idx").on(table.orderId),
    index("order_lines_sku_idx").on(table.sku),
    uniqueIndex("order_lines_id_quantity_unique").on(table.id, table.quantity),
    check("order_lines_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "order_lines_amounts_nonnegative",
      sql`${table.oneTimeUnitFen} >= 0 AND ${table.monthlyUnitFen} >= 0 AND ${table.oneTimeSubtotalFen} >= 0 AND ${table.monthlySubtotalFen} >= 0`,
    ),
  ],
);

export const orderAttributions = pgTable(
  "order_attributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    attributionRole: orderAttributionRoleEnum("attribution_role").notNull(),
    basisPoints: integer("basis_points").notNull(),
    beneficiarySnapshot: jsonb("beneficiary_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_attributions_order_beneficiary_unique").on(
      table.orderId,
      table.beneficiaryId,
    ),
    uniqueIndex("order_attributions_one_primary_unique")
      .on(table.orderId)
      .where(sql`${table.attributionRole} = 'primary'`),
    index("order_attributions_beneficiary_idx").on(table.beneficiaryId),
    check(
      "order_attributions_basis_points_range",
      sql`${table.basisPoints} BETWEEN 1 AND 10000`,
    ),
  ],
);

export const returns = pgTable(
  "returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnNo: varchar("return_no", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    completionIdempotencyKey: varchar("completion_idempotency_key", {
      length: 128,
    }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    returnType: returnTypeEnum("return_type").notNull(),
    status: returnStatusEnum("status").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    completedBy: uuid("completed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    refundFen: integer("refund_fen").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("returns_return_no_unique").on(table.returnNo),
    uniqueIndex("returns_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("returns_completion_idempotency_key_unique")
      .on(table.completionIdempotencyKey)
      .where(sql`${table.completionIdempotencyKey} IS NOT NULL`),
    index("returns_order_status_idx").on(table.orderId, table.status),
    index("returns_requested_at_idx").on(table.requestedAt),
    check("returns_reason_present", sql`NULLIF(BTRIM(${table.reason}), '') IS NOT NULL`),
    check("returns_refund_nonnegative", sql`${table.refundFen} >= 0`),
    check("returns_version_positive", sql`${table.version} >= 1`),
    check(
      "returns_decision_state_consistent",
      sql`(
        ${table.status} = 'requested'
        AND ${table.decidedBy} IS NULL
        AND ${table.decidedAt} IS NULL
        AND ${table.completedBy} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.status} IN ('approved', 'rejected')
        AND ${table.decidedBy} IS NOT NULL
        AND ${table.decidedAt} IS NOT NULL
        AND ${table.completedBy} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.status} = 'completed'
        AND ${table.decidedBy} IS NOT NULL
        AND ${table.decidedAt} IS NOT NULL
        AND ${table.completedBy} IS NOT NULL
        AND ${table.completedAt} IS NOT NULL
        AND ${table.completionIdempotencyKey} IS NOT NULL
      )`,
    ),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id").notNull(),
    orderLineQuantity: integer("order_line_quantity").notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    quantity: integer("quantity").notNull(),
    refundFen: integer("refund_fen").default(0).notNull(),
    itemSnapshot: jsonb("item_snapshot")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("return_items_return_line_unique").on(
      table.returnId,
      table.orderLineId,
    ),
    index("return_items_order_line_idx").on(table.orderLineId),
    foreignKey({
      name: "return_items_order_line_quantity_fk",
      columns: [table.orderLineId, table.orderLineQuantity],
      foreignColumns: [orderLines.id, orderLines.quantity],
    }).onDelete("restrict"),
    check(
      "return_items_quantity_range",
      sql`${table.quantity} > 0 AND ${table.quantity} <= ${table.orderLineQuantity}`,
    ),
    check("return_items_refund_nonnegative", sql`${table.refundFen} >= 0`),
  ],
);

export const commissionPolicyVersions = pgTable(
  "commission_policy_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyCode: varchar("policy_code", { length: 80 }).notNull(),
    versionNo: integer("version_no").notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    status: commissionPolicyStatusEnum("status").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedBy: uuid("published_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    stoppedBy: uuid("stopped_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    changeNote: text("change_note").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commission_policy_code_version_unique").on(
      table.policyCode,
      table.versionNo,
    ),
    index("commission_policy_status_effective_idx").on(
      table.status,
      table.effectiveFrom,
      table.effectiveTo,
    ),
    check("commission_policy_version_no_positive", sql`${table.versionNo} >= 1`),
    check("commission_policy_version_positive", sql`${table.version} >= 1`),
    check(
      "commission_policy_effective_range",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom} OR (${table.status} = 'stopped' AND ${table.effectiveTo} = ${table.effectiveFrom})`,
    ),
  ],
);

export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => commissionPolicyVersions.id, { onDelete: "restrict" }),
    ruleCode: varchar("rule_code", { length: 100 }).notNull(),
    ruleName: varchar("rule_name", { length: 180 }).notNull(),
    status: commissionRuleStatusEnum("status").default("active").notNull(),
    businessDomain: commissionBusinessDomainEnum("business_domain").notNull(),
    targetType: commissionTargetTypeEnum("target_type").notNull(),
    targetSku: varchar("target_sku", { length: 64 }),
    fttrPlan: integer("fttr_plan"),
    paymentModeScope: commissionPaymentModeScopeEnum("payment_mode_scope")
      .notNull(),
    calculationBasis: commissionCalculationBasisEnum("calculation_basis")
      .notNull(),
    packageMode: commissionPackageModeEnum("package_mode").notNull(),
    amountFen: integer("amount_fen").notNull(),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    personnelType: personnelTypeEnum("personnel_type"),
    salespersonId: uuid("salesperson_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    attributionScope: commissionAttributionScopeEnum("attribution_scope")
      .default("all")
      .notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    mutualExclusionGroup: varchar("mutual_exclusion_group", { length: 100 }),
    stackable: boolean("stackable").default(false).notNull(),
    allowsCrossDomain: boolean("allows_cross_domain").default(false).notNull(),
    changeNote: text("change_note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commission_rules_policy_code_unique").on(
      table.policyVersionId,
      table.ruleCode,
    ),
    index("commission_rules_match_idx").on(
      table.businessDomain,
      table.targetType,
      table.targetSku,
      table.paymentModeScope,
    ),
    index("commission_rules_scope_idx").on(
      table.salespersonId,
      table.personnelType,
      table.storeId,
    ),
    check("commission_rules_amount_nonnegative", sql`${table.amountFen} >= 0`),
    check("commission_rules_version_positive", sql`${table.version} >= 1`),
    check(
      "commission_rules_effective_range",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
      "commission_rules_target_present",
      sql`(${table.targetType} IN ('product', 'package') AND NULLIF(BTRIM(${table.targetSku}), '') IS NOT NULL) OR (${table.targetType} = 'fttr_plan' AND (${table.fttrPlan} BETWEEN 1 AND 9999 OR ${table.targetSku} = 'CUSTOM'))`,
    ),
  ],
);

export const orderCommissionSnapshots = pgTable(
  "order_commission_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => commissionPolicyVersions.id, { onDelete: "restrict" }),
    eventKey: varchar("event_key", { length: 128 }).notNull(),
    totalFen: integer("total_fen").notNull(),
    calculationSnapshot: jsonb("calculation_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_commission_snapshots_order_unique").on(table.orderId),
    uniqueIndex("order_commission_snapshots_event_key_unique").on(
      table.eventKey,
    ),
    index("order_commission_snapshots_policy_idx").on(table.policyVersionId),
    check(
      "order_commission_snapshots_total_nonnegative",
      sql`${table.totalFen} >= 0`,
    ),
  ],
);

export const commissionLedger = pgTable(
  "commission_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    returnId: uuid("return_id").references(() => returns.id, {
      onDelete: "restrict",
    }),
    snapshotId: uuid("snapshot_id").references(
      () => orderCommissionSnapshots.id,
      { onDelete: "restrict" },
    ),
    ruleId: uuid("rule_id").references(() => commissionRules.id, {
      onDelete: "restrict",
    }),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    entryType: commissionLedgerEntryTypeEnum("entry_type").notNull(),
    eventKey: varchar("event_key", { length: 128 }).notNull(),
    amountFen: integer("amount_fen").notNull(),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("commission_ledger_event_identity_unique").on(
      table.orderId,
      table.ruleId,
      table.beneficiaryId,
      table.eventKey,
    ),
    index("commission_ledger_beneficiary_occurred_idx").on(
      table.beneficiaryId,
      table.occurredAt,
    ),
    index("commission_ledger_store_occurred_idx").on(
      table.storeId,
      table.occurredAt,
    ),
    index("commission_ledger_order_idx").on(table.orderId),
    index("commission_ledger_return_idx").on(table.returnId),
    check(
      "commission_ledger_amount_sign",
      sql`(
        ${table.entryType} IN ('accrual', 'manual_positive', 'settlement')
        AND ${table.amountFen} > 0
      ) OR (
        ${table.entryType} IN ('return_reversal', 'manual_negative', 'settlement_reversal')
        AND ${table.amountFen} < 0
      )`,
    ),
    check(
      "commission_ledger_manual_reason",
      sql`${table.entryType} NOT IN ('manual_positive', 'manual_negative') OR NULLIF(BTRIM(${table.reason}), '') IS NOT NULL`,
    ),
  ],
);

export const settlementBatches = pgTable(
  "settlement_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchNo: varchar("batch_no", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    status: settlementBatchStatusEnum("status").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    beneficiaryId: uuid("beneficiary_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    totalFen: integer("total_fen").notNull(),
    entryCount: integer("entry_count").notNull(),
    filtersSnapshot: jsonb("filters_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidBy: uuid("paid_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("settlement_batches_batch_no_unique").on(table.batchNo),
    uniqueIndex("settlement_batches_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("settlement_batches_period_status_idx").on(
      table.periodStart,
      table.periodEnd,
      table.status,
    ),
    index("settlement_batches_scope_idx").on(table.storeId, table.beneficiaryId),
    check(
      "settlement_batches_period_range",
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
    check("settlement_batches_entry_count", sql`${table.entryCount} >= 0`),
    check("settlement_batches_version_positive", sql`${table.version} >= 1`),
    check(
      "settlement_batches_status_consistent",
      sql`(
        ${table.status} = 'draft'
        AND ${table.approvedBy} IS NULL
        AND ${table.approvedAt} IS NULL
        AND ${table.paidBy} IS NULL
        AND ${table.paidAt} IS NULL
      ) OR (
        ${table.status} = 'approved'
        AND ${table.approvedBy} IS NOT NULL
        AND ${table.approvedAt} IS NOT NULL
        AND ${table.paidBy} IS NULL
        AND ${table.paidAt} IS NULL
      ) OR (
        ${table.status} = 'paid'
        AND ${table.approvedBy} IS NOT NULL
        AND ${table.approvedAt} IS NOT NULL
        AND ${table.paidBy} IS NOT NULL
        AND ${table.paidAt} IS NOT NULL
      )`,
    ),
  ],
);

export const settlementItems = pgTable(
  "settlement_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => settlementBatches.id, { onDelete: "restrict" }),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => commissionLedger.id, { onDelete: "restrict" }),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountFen: integer("amount_fen").notNull(),
    ledgerSnapshot: jsonb("ledger_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("settlement_items_ledger_entry_unique").on(table.ledgerEntryId),
    index("settlement_items_batch_idx").on(table.batchId),
    index("settlement_items_beneficiary_idx").on(table.beneficiaryId),
    check("settlement_items_amount_nonzero", sql`${table.amountFen} <> 0`),
  ],
);
