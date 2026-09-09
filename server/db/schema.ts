import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const sqliteEnum = <const Values extends readonly [string, ...string[]]>(
  _name: string,
  values: Values,
) => (columnName: string) => text(columnName, { enum: values });

export const userRoleEnum = sqliteEnum("user_role", [
  "sales",
  "store_manager",
  "regional_manager",
  "hr",
  "finance",
  "admin",
]);
export const personnelTypeEnum = sqliteEnum("personnel_type", [
  "unicom",
  "auxiliary",
  "admin",
]);
export const quoteStatusEnum = sqliteEnum("quote_status", [
  "confirmed",
  "converted",
  "expired",
  "lost",
  "voided",
]);
export const paymentModeEnum = sqliteEnum("payment_mode", [
  "one_time",
  "contract_36",
]);
export const salesChannelEnum = sqliteEnum("sales_channel", ["online", "offline"]);
export const fttrKindEnum = sqliteEnum("fttr_kind", [
  "none",
  "standard",
  "custom",
]);
export const quoteLineTypeEnum = sqliteEnum("quote_line_type", [
  "charge",
  "component",
]);
export const printEventTypeEnum = sqliteEnum("print_event_type", [
  "initial",
  "reprint",
]);
export const orderStatusEnum = sqliteEnum("order_status", [
  "pending",
  "accepted",
  "activated",
  "signed",
  "reconciled",
  "paid",
  "cancelled",
  "return_pending",
  "partially_returned",
  "returned",
  "voided",
]);
export const orderAttributionRoleEnum = sqliteEnum("order_attribution_role", [
  "primary",
  "collaborator",
]);
export const returnTypeEnum = sqliteEnum("return_type", ["full", "partial"]);
export const afterSalesServiceTypeEnum = sqliteEnum("after_sales_service_type", [
  "refund",
  "exchange",
]);
export const returnKindEnum = sqliteEnum("return_kind", ["normal", "special"]);
export const returnReasonCategoryEnum = sqliteEnum("return_reason_category", [
  "no_reason",
  "quality",
  "order_mismatch",
  "service_issue",
  "other",
]);
export const returnStatusEnum = sqliteEnum("return_status", [
  "requested",
  "approved",
  "rejected",
  "completed",
]);
export const commissionPolicyStatusEnum = sqliteEnum(
  "commission_policy_status",
  ["draft", "published", "stopped"],
);
export const commissionRuleStatusEnum = sqliteEnum("commission_rule_status", [
  "active",
  "inactive",
]);
export const commissionBusinessDomainEnum = sqliteEnum(
  "commission_business_domain",
  ["fttr", "heartlink"],
);
export const commissionTargetTypeEnum = sqliteEnum("commission_target_type", [
  "product",
  "package",
  "fttr_plan",
]);
export const commissionPaymentModeScopeEnum = sqliteEnum(
  "commission_payment_mode_scope",
  ["all", "one_time", "contract_36"],
);
export const commissionCalculationBasisEnum = sqliteEnum(
  "commission_calculation_basis",
  ["per_order", "per_unit"],
);
export const commissionPackageModeEnum = sqliteEnum("commission_package_mode", [
  "additive",
  "fixed_override",
]);
export const commissionAttributionScopeEnum = sqliteEnum(
  "commission_attribution_scope",
  ["all", "primary", "collaborator"],
);
export const commissionLedgerEntryTypeEnum = sqliteEnum(
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
export const settlementBatchStatusEnum = sqliteEnum("settlement_batch_status", [
  "draft",
  "approved",
  "paid",
]);
export const regionalTemplateStatusEnum = sqliteEnum("regional_template_status", [
  "draft",
  "published",
  "stopped",
]);
export const regionalPlanStatusEnum = sqliteEnum("regional_plan_status", [
  "draft",
  "active",
  "replaced",
]);
export const regionalFactStatusEnum = sqliteEnum("regional_fact_status", [
  "active",
  "returned",
  "voided",
]);
export const regionalVerificationStatusEnum = sqliteEnum("regional_verification_status", [
  "pending",
  "verified",
  "rejected",
]);
export const regionalCooperationStatusEnum = sqliteEnum("regional_cooperation_status", [
  "submitted",
  "finance_verified",
  "confirmed",
  "revoked",
]);
export const regionalStatementStatusEnum = sqliteEnum("regional_statement_status", [
  "draft",
  "confirmed",
  "paid",
]);

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .defaultNow()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .defaultNow()
    .notNull(),
};

export const stores = sqliteTable(
  "stores",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("stores_code_unique").on(table.code)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    workNo: text("work_no").notNull(),
    phoneEncrypted: text("phone_encrypted"),
    phoneLookupHash: text("phone_lookup_hash"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    personnelType: personnelTypeEnum("personnel_type").notNull(),
    storeId: text("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .default(true)
      .notNull(),
    isPrimaryStoreManager: integer("is_primary_store_manager", {
      mode: "boolean",
    })
      .default(false)
      .notNull(),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    employmentStartDate: text("employment_start_date"),
    employmentEndDate: text("employment_end_date"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_work_no_unique").on(table.workNo),
    uniqueIndex("users_phone_lookup_hash_unique")
      .on(table.phoneLookupHash)
      .where(sql`${table.phoneLookupHash} IS NOT NULL`),
    index("users_store_idx").on(table.storeId),
    uniqueIndex("users_primary_store_manager_unique")
      .on(table.storeId)
      .where(sql`${table.isPrimaryStoreManager} = 1`),
  ],
);

export const regionalManagerStores = sqliteTable(
  "regional_manager_stores",
  {
    regionalManagerId: text("regional_manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regional_manager_stores_store_unique").on(table.storeId),
    uniqueIndex("regional_manager_stores_manager_store_unique").on(
      table.regionalManagerId,
      table.storeId,
    ),
    index("regional_manager_stores_manager_idx").on(table.regionalManagerId),
  ],
);

export const regionalManagerStoreHistory = sqliteTable(
  "regional_manager_store_history",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    effectiveFrom: integer("effective_from", { mode: "timestamp_ms" }).notNull(),
    effectiveTo: integer("effective_to", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).defaultNow().notNull(),
  },
  (table) => [
    index("regional_manager_store_history_manager_period_idx").on(table.regionalManagerId, table.effectiveFrom, table.effectiveTo),
    index("regional_manager_store_history_store_period_idx").on(table.storeId, table.effectiveFrom, table.effectiveTo),
    uniqueIndex("regional_manager_store_history_active_store_unique")
      .on(table.storeId)
      .where(sql`${table.effectiveTo} IS NULL`),
    check("regional_manager_store_history_period_valid", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`),
  ],
);

export const regionalCommissionPlanTypeEnum = sqliteEnum("regional_commission_plan_type", [
  "quarter",
  "half_year",
  "year",
]);

export const regionalCommissionTargetPlans = sqliteTable(
  "regional_commission_target_plans",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    planType: regionalCommissionPlanTypeEnum("plan_type").notNull(),
    periodCount: integer("period_count").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    isPreset: integer("is_preset", { mode: "boolean" }).default(false).notNull(),
    status: regionalPlanStatusEnum("status").default("active").notNull(),
    replacedByPlanId: text("replaced_by_plan_id"),
    setBy: text("set_by").references(() => users.id, { onDelete: "restrict" }),
    changeReason: text("change_reason").default("系统创建").notNull(),
    ...timestamps,
  },
  (table) => [
    index("regional_commission_target_plans_manager_idx").on(table.regionalManagerId, table.startsOn),
    uniqueIndex("regional_commission_target_plans_manager_preset_unique")
      .on(table.regionalManagerId)
      .where(sql`${table.isPreset} = 1`),
    check("regional_commission_target_plans_type_periods_valid", sql`(${table.planType} = 'quarter' AND ${table.periodCount} = 3) OR (${table.planType} = 'half_year' AND ${table.periodCount} = 6) OR (${table.planType} = 'year' AND ${table.periodCount} = 12)`),
    check("regional_commission_target_plans_date_order_valid", sql`${table.endsOn} >= ${table.startsOn}`),
  ],
);

export const regionalCommissionTargetPeriods = sqliteTable(
  "regional_commission_target_periods",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => regionalCommissionTargetPlans.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    targetOrderCount: integer("target_order_count").notNull(),
    cumulativeTargetOrderCount: integer("cumulative_target_order_count").notNull(),
  },
  (table) => [
    uniqueIndex("regional_commission_target_periods_plan_sequence_unique").on(table.planId, table.sequence),
    index("regional_commission_target_periods_plan_idx").on(table.planId, table.startsOn),
    check("regional_commission_target_periods_target_positive", sql`${table.targetOrderCount} > 0`),
    check("regional_commission_target_periods_date_order_valid", sql`${table.endsOn} >= ${table.startsOn}`),
  ],
);

export const regionalCommissionTemplateVersions = sqliteTable(
  "regional_commission_template_versions",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    templateCode: text("template_code").notNull(),
    versionNo: integer("version_no").notNull(),
    name: text("name").notNull(),
    status: regionalTemplateStatusEnum("status").default("draft").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    sourceVersionId: text("source_version_id"),
    rulesSnapshot: text("rules_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "restrict" }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    stoppedBy: text("stopped_by").references(() => users.id, { onDelete: "restrict" }),
    stoppedAt: integer("stopped_at", { mode: "timestamp_ms" }),
    changeReason: text("change_reason").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regional_template_code_version_unique").on(table.templateCode, table.versionNo),
    index("regional_template_status_dates_idx").on(table.status, table.effectiveFrom, table.effectiveTo),
    check("regional_template_version_positive", sql`${table.versionNo} > 0 AND ${table.version} > 0`),
    check("regional_template_dates_valid", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  ],
);

export const regionalCommissionTemplateAssignments = sqliteTable(
  "regional_commission_template_assignments",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    templateVersionId: text("template_version_id").notNull().references(() => regionalCommissionTemplateVersions.id, { onDelete: "restrict" }),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    assignedBy: text("assigned_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    ...timestamps,
  },
  (table) => [
    index("regional_template_assignments_manager_dates_idx").on(table.regionalManagerId, table.effectiveFrom, table.effectiveTo),
    uniqueIndex("regional_template_assignments_active_manager_unique")
      .on(table.regionalManagerId)
      .where(sql`${table.effectiveTo} IS NULL`),
    check("regional_template_assignment_dates_valid", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  ],
);

export const regionalPersonalChannelOrders = sqliteTable(
  "regional_personal_channel_orders",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderNo: text("order_no").notNull(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    channel: text("channel").notNull(),
    orderCount: integer("order_count").default(1).notNull(),
    businessDate: text("business_date").notNull(),
    signedOn: text("signed_on").notNull(),
    effectiveOn: text("effective_on").notNull(),
    evidenceNo: text("evidence_no").notNull(),
    note: text("note"),
    status: regionalFactStatusEnum("status").default("active").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    voidedBy: text("voided_by").references(() => users.id, { onDelete: "restrict" }),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidReason: text("void_reason"),
    returnedOn: text("returned_on"),
    returnReason: text("return_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regional_personal_orders_no_unique").on(table.orderNo),
    index("regional_personal_orders_manager_effective_idx").on(table.regionalManagerId, table.effectiveOn),
    check("regional_personal_orders_count_positive", sql`${table.orderCount} > 0`),
  ],
);

export const regionalPersonalChannelOrderLines = sqliteTable(
  "regional_personal_channel_order_lines",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderId: text("order_id").notNull().references(() => regionalPersonalChannelOrders.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    unitCommissionFen: integer("unit_commission_fen").notNull(),
    subtotalFen: integer("subtotal_fen").notNull(),
    returnedQuantity: integer("returned_quantity").default(0).notNull(),
  },
  (table) => [
    index("regional_personal_order_lines_order_idx").on(table.orderId),
    check("regional_personal_order_lines_values_valid", sql`${table.quantity} > 0 AND ${table.returnedQuantity} BETWEEN 0 AND ${table.quantity} AND ${table.unitCommissionFen} >= 0 AND ${table.subtotalFen} >= 0`),
  ],
);

export const regionalNetReceipts = sqliteTable(
  "regional_net_receipts",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    month: text("month").notNull(),
    netReceiptFen: integer("net_receipt_fen").notNull(),
    evidenceNo: text("evidence_no").notNull(),
    note: text("note"),
    verificationStatus: regionalVerificationStatusEnum("verification_status").default("pending").notNull(),
    enteredBy: text("entered_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    verifiedBy: text("verified_by").references(() => users.id, { onDelete: "restrict" }),
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    verificationReason: text("verification_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regional_net_receipts_manager_month_unique").on(table.regionalManagerId, table.month),
    index("regional_net_receipts_month_status_idx").on(table.month, table.verificationStatus),
  ],
);

export const regionalCooperationStages = sqliteTable(
  "regional_cooperation_stages",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    stageCode: text("stage_code").notNull(),
    stageLabel: text("stage_label").notNull(),
    amountFen: integer("amount_fen").notNull(),
    achievedOn: text("achieved_on").notNull(),
    evidenceNo: text("evidence_no").notNull(),
    note: text("note"),
    status: regionalCooperationStatusEnum("status").default("submitted").notNull(),
    submittedBy: text("submitted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    financeVerifiedBy: text("finance_verified_by").references(() => users.id, { onDelete: "restrict" }),
    financeVerifiedAt: integer("finance_verified_at", { mode: "timestamp_ms" }),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "restrict" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by").references(() => users.id, { onDelete: "restrict" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokeReason: text("revoke_reason"),
    ...timestamps,
  },
  (table) => [
    index("regional_cooperation_manager_stage_date_idx").on(table.regionalManagerId, table.stageCode, table.achievedOn),
    uniqueIndex("regional_cooperation_manager_stage_confirmed_unique")
      .on(table.regionalManagerId, table.stageCode)
      .where(sql`${table.status} = 'confirmed'`),
    check("regional_cooperation_amount_positive", sql`${table.amountFen} > 0`),
  ],
);

export const regionalCommissionStatements = sqliteTable(
  "regional_commission_statements",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    settlementMonth: text("settlement_month").notNull(),
    templateVersionId: text("template_version_id").notNull().references(() => regionalCommissionTemplateVersions.id, { onDelete: "restrict" }),
    targetPlanId: text("target_plan_id").references(() => regionalCommissionTargetPlans.id, { onDelete: "restrict" }),
    status: regionalStatementStatusEnum("status").default("draft").notNull(),
    totalFen: integer("total_fen").notNull(),
    calculationSnapshot: text("calculation_snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    calculatedBy: text("calculated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "restrict" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    paidBy: text("paid_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regional_statements_manager_month_unique").on(table.regionalManagerId, table.settlementMonth),
    index("regional_statements_month_status_idx").on(table.settlementMonth, table.status),
  ],
);

export const regionalCommissionLedger = sqliteTable(
  "regional_commission_ledger",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    regionalManagerId: text("regional_manager_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    statementId: text("statement_id").references(() => regionalCommissionStatements.id, { onDelete: "restrict" }),
    eventKey: text("event_key").notNull(),
    category: text("category").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    amountFen: integer("amount_fen").notNull(),
    occurredOn: text("occurred_on").notNull(),
    settlementMonth: text("settlement_month").notNull(),
    detailSnapshot: text("detail_snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regional_ledger_event_key_unique").on(table.eventKey),
    index("regional_ledger_manager_month_idx").on(table.regionalManagerId, table.settlementMonth),
    index("regional_ledger_source_idx").on(table.sourceType, table.sourceId),
    check("regional_ledger_nonzero", sql`${table.amountFen} <> 0`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    nameEncrypted: text("name_encrypted").notNull(),
    phoneEncrypted: text("phone_encrypted").notNull(),
    phoneLookupHash: text("phone_lookup_hash").notNull(),
    phoneTail: text("phone_tail").notNull(),
    districtEncrypted: text("district_encrypted"),
    addressEncrypted: text("address_encrypted"),
    roomType: text("room_type"),
    elderCount: integer("elder_count").notNull(),
    source: text("source"),
    notesEncrypted: text("notes_encrypted"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    quoteNo: text("quote_no").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    sellerId: text("seller_id")
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
    catalogVersion: text("catalog_version").notNull(),
    customerSnapshot: text("customer_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    quoteSnapshot: text("quote_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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
        AND NULLIF(TRIM(${table.customFttrNote}), '') IS NOT NULL
      )`,
    ),
    check("quotes_version_positive", sql`${table.version} >= 1`),
  ],
);

export const quoteLines = sqliteTable(
  "quote_lines",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    lineType: quoteLineTypeEnum("line_type").notNull(),
    sku: text("sku").notNull(),
    label: text("label").notNull(),
    unit: text("unit").notNull(),
    quantity: integer("quantity").notNull(),
    oneTimeUnitFen: integer("one_time_unit_fen").default(0).notNull(),
    monthlyUnitFen: integer("monthly_unit_fen").default(0).notNull(),
    oneTimeSubtotalFen: integer("one_time_subtotal_fen").default(0).notNull(),
    monthlySubtotalFen: integer("monthly_subtotal_fen").default(0).notNull(),
    locations: text("locations", { mode: "json" }).$type<string[]>().default([]).notNull(),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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

export const printEvents = sqliteTable(
  "print_events",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: printEventTypeEnum("event_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("print_events_quote_idx").on(table.quoteId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    storeId: text("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    beforeSnapshot: text("before_snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
    afterSnapshot: text("after_snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
    reason: text("reason"),
    sourceIp: text("source_ip"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderNo: text("order_no").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "restrict" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull(),
    salesChannel: salesChannelEnum("sales_channel").default("offline").notNull(),
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
    catalogVersion: text("catalog_version").notNull(),
    catalogSnapshot: text("catalog_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    customerSnapshot: text("customer_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    quoteSnapshot: text("quote_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    storeSnapshot: text("store_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    sellerSnapshot: text("seller_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }),
    signedBy: text("signed_by").references(() => users.id, { onDelete: "restrict" }),
    reconciledAt: integer("reconciled_at", { mode: "timestamp_ms" }),
    reconciledBy: text("reconciled_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    paidBy: text("paid_by").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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
        AND NULLIF(TRIM(${table.customFttrNote}), '') IS NOT NULL
      )`,
    ),
    check("orders_version_positive", sql`${table.version} >= 1`),
  ],
);

export const orderLines = sqliteTable(
  "order_lines",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    quoteLineId: text("quote_line_id").references(() => quoteLines.id, {
      onDelete: "restrict",
    }),
    lineType: quoteLineTypeEnum("line_type").notNull(),
    sku: text("sku").notNull(),
    label: text("label").notNull(),
    unit: text("unit").notNull(),
    quantity: integer("quantity").notNull(),
    oneTimeUnitFen: integer("one_time_unit_fen").default(0).notNull(),
    monthlyUnitFen: integer("monthly_unit_fen").default(0).notNull(),
    oneTimeSubtotalFen: integer("one_time_subtotal_fen").default(0).notNull(),
    monthlySubtotalFen: integer("monthly_subtotal_fen").default(0).notNull(),
    locations: text("locations", { mode: "json" }).$type<string[]>().default([]).notNull(),
    reason: text("reason"),
    lineSnapshot: text("line_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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

export const orderAttributions = sqliteTable(
  "order_attributions",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    beneficiaryId: text("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    attributionRole: orderAttributionRoleEnum("attribution_role").notNull(),
    basisPoints: integer("basis_points").notNull(),
    beneficiarySnapshot: text("beneficiary_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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

export const returns = sqliteTable(
  "returns",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    returnNo: text("return_no").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    completionIdempotencyKey: text("completion_idempotency_key"),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    serviceType: afterSalesServiceTypeEnum("service_type").default("refund").notNull(),
    returnType: returnTypeEnum("return_type").notNull(),
    returnKind: returnKindEnum("return_kind").default("normal").notNull(),
    reasonCategory: returnReasonCategoryEnum("reason_category").default("other").notNull(),
    orderStatusBefore: orderStatusEnum("order_status_before"),
    status: returnStatusEnum("status").notNull(),
    reason: text("reason").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    decisionNote: text("decision_note"),
    completedBy: text("completed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    requestedRefundFen: integer("requested_refund_fen").default(0).notNull(),
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
    check("returns_reason_present", sql`NULLIF(TRIM(${table.reason}), '') IS NOT NULL`),
    check("returns_refund_nonnegative", sql`${table.refundFen} >= 0`),
    check("returns_requested_refund_nonnegative", sql`${table.requestedRefundFen} >= 0`),
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

export const returnItems = sqliteTable(
  "return_items",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    returnId: text("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    orderLineId: text("order_line_id").notNull(),
    orderLineQuantity: integer("order_line_quantity").notNull(),
    sku: text("sku").notNull(),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    refundFen: integer("refund_fen").default(0).notNull(),
    itemSnapshot: text("item_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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

export const commissionPolicyVersions = sqliteTable(
  "commission_policy_versions",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    policyCode: text("policy_code").notNull(),
    versionNo: integer("version_no").notNull(),
    name: text("name").notNull(),
    status: commissionPolicyStatusEnum("status").notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp_ms" }).notNull(),
    effectiveTo: integer("effective_to", { mode: "timestamp_ms" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    stoppedBy: text("stopped_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    stoppedAt: integer("stopped_at", { mode: "timestamp_ms" }),
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

export const commissionRules = sqliteTable(
  "commission_rules",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    policyVersionId: text("policy_version_id")
      .notNull()
      .references(() => commissionPolicyVersions.id, { onDelete: "restrict" }),
    ruleCode: text("rule_code").notNull(),
    ruleName: text("rule_name").notNull(),
    status: commissionRuleStatusEnum("status").default("active").notNull(),
    businessDomain: commissionBusinessDomainEnum("business_domain").notNull(),
    targetType: commissionTargetTypeEnum("target_type").notNull(),
    targetSku: text("target_sku"),
    fttrPlan: integer("fttr_plan"),
    paymentModeScope: commissionPaymentModeScopeEnum("payment_mode_scope")
      .notNull(),
    calculationBasis: commissionCalculationBasisEnum("calculation_basis")
      .notNull(),
    packageMode: commissionPackageModeEnum("package_mode").notNull(),
    amountFen: integer("amount_fen").notNull(),
    storeId: text("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    personnelType: personnelTypeEnum("personnel_type"),
    salespersonId: text("salesperson_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    attributionScope: commissionAttributionScopeEnum("attribution_scope")
      .default("all")
      .notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp_ms" }).notNull(),
    effectiveTo: integer("effective_to", { mode: "timestamp_ms" }),
    mutualExclusionGroup: text("mutual_exclusion_group"),
    stackable: integer("stackable", { mode: "boolean" }).default(false).notNull(),
    allowsCrossDomain: integer("allows_cross_domain", { mode: "boolean" }).default(false).notNull(),
    changeNote: text("change_note"),
    createdBy: text("created_by")
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
      sql`(${table.targetType} IN ('product', 'package') AND NULLIF(TRIM(${table.targetSku}), '') IS NOT NULL) OR (${table.targetType} = 'fttr_plan' AND (${table.fttrPlan} BETWEEN 1 AND 9999 OR ${table.targetSku} = 'CUSTOM'))`,
    ),
  ],
);

export const orderCommissionSnapshots = sqliteTable(
  "order_commission_snapshots",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    policyVersionId: text("policy_version_id")
      .notNull()
      .references(() => commissionPolicyVersions.id, { onDelete: "restrict" }),
    eventKey: text("event_key").notNull(),
    totalFen: integer("total_fen").notNull(),
    calculationSnapshot: text("calculation_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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

export const commissionLedger = sqliteTable(
  "commission_ledger",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    returnId: text("return_id").references(() => returns.id, {
      onDelete: "restrict",
    }),
    snapshotId: text("snapshot_id").references(
      () => orderCommissionSnapshots.id,
      { onDelete: "restrict" },
    ),
    ruleId: text("rule_id").references(() => commissionRules.id, {
      onDelete: "restrict",
    }),
    beneficiaryId: text("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storeId: text("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    entryType: commissionLedgerEntryTypeEnum("entry_type").notNull(),
    eventKey: text("event_key").notNull(),
    amountFen: integer("amount_fen").notNull(),
    reason: text("reason"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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
      sql`${table.entryType} NOT IN ('manual_positive', 'manual_negative') OR NULLIF(TRIM(${table.reason}), '') IS NOT NULL`,
    ),
  ],
);

export const settlementBatches = sqliteTable(
  "settlement_batches",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    batchNo: text("batch_no").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: settlementBatchStatusEnum("status").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    storeId: text("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    beneficiaryId: text("beneficiary_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    totalFen: integer("total_fen").notNull(),
    entryCount: integer("entry_count").notNull(),
    filtersSnapshot: text("filters_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    paidBy: text("paid_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
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

export const settlementItems = sqliteTable(
  "settlement_items",
  {
    id: text("id").$defaultFn(() => randomUUID()).primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => settlementBatches.id, { onDelete: "restrict" }),
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => commissionLedger.id, { onDelete: "restrict" }),
    beneficiaryId: text("beneficiary_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountFen: integer("amount_fen").notNull(),
    ledgerSnapshot: text("ledger_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
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
