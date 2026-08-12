CREATE TYPE "public"."commission_attribution_scope" AS ENUM('all', 'primary', 'collaborator');--> statement-breakpoint
CREATE TYPE "public"."commission_business_domain" AS ENUM('fttr', 'heartlink');--> statement-breakpoint
CREATE TYPE "public"."commission_calculation_basis" AS ENUM('per_order', 'per_unit');--> statement-breakpoint
CREATE TYPE "public"."commission_ledger_entry_type" AS ENUM('accrual', 'return_reversal', 'manual_positive', 'manual_negative', 'settlement', 'settlement_reversal');--> statement-breakpoint
CREATE TYPE "public"."commission_package_mode" AS ENUM('additive', 'fixed_override');--> statement-breakpoint
CREATE TYPE "public"."commission_payment_mode_scope" AS ENUM('all', 'one_time', 'contract_36');--> statement-breakpoint
CREATE TYPE "public"."commission_policy_status" AS ENUM('draft', 'published', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."commission_rule_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."commission_target_type" AS ENUM('product', 'package', 'fttr_plan');--> statement-breakpoint
CREATE TYPE "public"."order_attribution_role" AS ENUM('primary', 'collaborator');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'accepted', 'activated', 'completed', 'cancelled', 'return_pending', 'partially_returned', 'returned', 'voided');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'approved', 'rejected', 'completed');--> statement-breakpoint
CREATE TYPE "public"."return_type" AS ENUM('full', 'partial');--> statement-breakpoint
CREATE TYPE "public"."settlement_batch_status" AS ENUM('draft', 'approved', 'paid');--> statement-breakpoint
CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"return_id" uuid,
	"snapshot_id" uuid,
	"rule_id" uuid,
	"beneficiary_id" uuid NOT NULL,
	"store_id" uuid,
	"entry_type" "commission_ledger_entry_type" NOT NULL,
	"event_key" varchar(128) NOT NULL,
	"amount_fen" integer NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_ledger_amount_sign" CHECK ((
        "commission_ledger"."entry_type" IN ('accrual', 'manual_positive', 'settlement')
        AND "commission_ledger"."amount_fen" > 0
      ) OR (
        "commission_ledger"."entry_type" IN ('return_reversal', 'manual_negative', 'settlement_reversal')
        AND "commission_ledger"."amount_fen" < 0
      )),
	CONSTRAINT "commission_ledger_manual_reason" CHECK ("commission_ledger"."entry_type" NOT IN ('manual_positive', 'manual_negative') OR NULLIF(BTRIM("commission_ledger"."reason"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "commission_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_code" varchar(80) NOT NULL,
	"version_no" integer NOT NULL,
	"name" varchar(180) NOT NULL,
	"status" "commission_policy_status" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"stopped_by" uuid,
	"stopped_at" timestamp with time zone,
	"change_note" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_policy_version_no_positive" CHECK ("commission_policy_versions"."version_no" >= 1),
	CONSTRAINT "commission_policy_version_positive" CHECK ("commission_policy_versions"."version" >= 1),
	CONSTRAINT "commission_policy_effective_range" CHECK ("commission_policy_versions"."effective_to" IS NULL OR "commission_policy_versions"."effective_to" > "commission_policy_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"rule_code" varchar(100) NOT NULL,
	"rule_name" varchar(180) NOT NULL,
	"status" "commission_rule_status" DEFAULT 'active' NOT NULL,
	"business_domain" "commission_business_domain" NOT NULL,
	"target_type" "commission_target_type" NOT NULL,
	"target_sku" varchar(64),
	"fttr_plan" integer,
	"payment_mode_scope" "commission_payment_mode_scope" NOT NULL,
	"calculation_basis" "commission_calculation_basis" NOT NULL,
	"package_mode" "commission_package_mode" NOT NULL,
	"amount_fen" integer NOT NULL,
	"store_id" uuid,
	"personnel_type" "personnel_type",
	"salesperson_id" uuid,
	"attribution_scope" "commission_attribution_scope" DEFAULT 'all' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"mutual_exclusion_group" varchar(100),
	"stackable" boolean DEFAULT false NOT NULL,
	"allows_cross_domain" boolean DEFAULT false NOT NULL,
	"change_note" text,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_amount_nonnegative" CHECK ("commission_rules"."amount_fen" >= 0),
	CONSTRAINT "commission_rules_version_positive" CHECK ("commission_rules"."version" >= 1),
	CONSTRAINT "commission_rules_effective_range" CHECK ("commission_rules"."effective_to" IS NULL OR "commission_rules"."effective_to" > "commission_rules"."effective_from"),
	CONSTRAINT "commission_rules_target_present" CHECK (("commission_rules"."target_type" IN ('product', 'package') AND NULLIF(BTRIM("commission_rules"."target_sku"), '') IS NOT NULL) OR ("commission_rules"."target_type" = 'fttr_plan' AND ("commission_rules"."fttr_plan" BETWEEN 1 AND 9999 OR "commission_rules"."target_sku" = 'CUSTOM')))
);
--> statement-breakpoint
CREATE TABLE "order_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"attribution_role" "order_attribution_role" NOT NULL,
	"basis_points" integer NOT NULL,
	"beneficiary_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_attributions_basis_points_range" CHECK ("order_attributions"."basis_points" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "order_commission_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"event_key" varchar(128) NOT NULL,
	"total_fen" integer NOT NULL,
	"calculation_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_commission_snapshots_total_nonnegative" CHECK ("order_commission_snapshots"."total_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"quote_line_id" uuid,
	"line_type" "quote_line_type" NOT NULL,
	"sku" varchar(64) NOT NULL,
	"label" varchar(160) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"one_time_unit_fen" integer DEFAULT 0 NOT NULL,
	"monthly_unit_fen" integer DEFAULT 0 NOT NULL,
	"one_time_subtotal_fen" integer DEFAULT 0 NOT NULL,
	"monthly_subtotal_fen" integer DEFAULT 0 NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"line_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_quantity_positive" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_amounts_nonnegative" CHECK ("order_lines"."one_time_unit_fen" >= 0 AND "order_lines"."monthly_unit_fen" >= 0 AND "order_lines"."one_time_subtotal_fen" >= 0 AND "order_lines"."monthly_subtotal_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"quote_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"fttr_kind" "fttr_kind" NOT NULL,
	"fttr_plan" integer,
	"custom_fttr_note" text,
	"fttr_monthly_fen" integer NOT NULL,
	"heart_monthly_fen" integer NOT NULL,
	"one_time_fen" integer NOT NULL,
	"monthly_total_fen" integer NOT NULL,
	"contract_36_fen" integer NOT NULL,
	"refunded_fen" integer DEFAULT 0 NOT NULL,
	"catalog_version" varchar(64) NOT NULL,
	"catalog_snapshot" jsonb NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"quote_snapshot" jsonb NOT NULL,
	"store_snapshot" jsonb NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_amounts_nonnegative" CHECK ("orders"."fttr_monthly_fen" >= 0 AND "orders"."heart_monthly_fen" >= 0 AND "orders"."one_time_fen" >= 0 AND "orders"."monthly_total_fen" >= 0 AND "orders"."contract_36_fen" >= 0 AND "orders"."refunded_fen" >= 0),
	CONSTRAINT "orders_fttr_state_consistent" CHECK ((
        "orders"."fttr_kind" = 'none'
        AND "orders"."fttr_plan" IS NULL
        AND "orders"."fttr_monthly_fen" = 0
        AND "orders"."custom_fttr_note" IS NULL
      ) OR (
        "orders"."fttr_kind" = 'standard'
        AND "orders"."fttr_plan" IN (129, 159, 199, 239, 299, 399)
        AND "orders"."fttr_monthly_fen" = "orders"."fttr_plan" * 100
        AND "orders"."custom_fttr_note" IS NULL
      ) OR (
        "orders"."fttr_kind" = 'custom'
        AND "orders"."fttr_plan" BETWEEN 1 AND 9999
        AND "orders"."fttr_monthly_fen" = "orders"."fttr_plan" * 100
        AND NULLIF(BTRIM("orders"."custom_fttr_note"), '') IS NOT NULL
      )),
	CONSTRAINT "orders_version_positive" CHECK ("orders"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"order_line_quantity" integer NOT NULL,
	"sku" varchar(64) NOT NULL,
	"label" varchar(160) NOT NULL,
	"quantity" integer NOT NULL,
	"refund_fen" integer DEFAULT 0 NOT NULL,
	"item_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_quantity_range" CHECK ("return_items"."quantity" > 0 AND "return_items"."quantity" <= "return_items"."order_line_quantity"),
	CONSTRAINT "return_items_refund_nonnegative" CHECK ("return_items"."refund_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"completion_idempotency_key" varchar(128),
	"order_id" uuid NOT NULL,
	"return_type" "return_type" NOT NULL,
	"status" "return_status" NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"refund_fen" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_reason_present" CHECK (NULLIF(BTRIM("returns"."reason"), '') IS NOT NULL),
	CONSTRAINT "returns_refund_nonnegative" CHECK ("returns"."refund_fen" >= 0),
	CONSTRAINT "returns_version_positive" CHECK ("returns"."version" >= 1),
	CONSTRAINT "returns_decision_state_consistent" CHECK ((
        "returns"."status" = 'requested'
        AND "returns"."decided_by" IS NULL
        AND "returns"."decided_at" IS NULL
        AND "returns"."completed_by" IS NULL
        AND "returns"."completed_at" IS NULL
      ) OR (
        "returns"."status" IN ('approved', 'rejected')
        AND "returns"."decided_by" IS NOT NULL
        AND "returns"."decided_at" IS NOT NULL
        AND "returns"."completed_by" IS NULL
        AND "returns"."completed_at" IS NULL
      ) OR (
        "returns"."status" = 'completed'
        AND "returns"."decided_by" IS NOT NULL
        AND "returns"."decided_at" IS NOT NULL
        AND "returns"."completed_by" IS NOT NULL
        AND "returns"."completed_at" IS NOT NULL
        AND "returns"."completion_idempotency_key" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "settlement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_no" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "settlement_batch_status" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"store_id" uuid,
	"beneficiary_id" uuid,
	"total_fen" integer NOT NULL,
	"entry_count" integer NOT NULL,
	"filters_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_batches_period_range" CHECK ("settlement_batches"."period_end" > "settlement_batches"."period_start"),
	CONSTRAINT "settlement_batches_entry_count" CHECK ("settlement_batches"."entry_count" >= 0),
	CONSTRAINT "settlement_batches_version_positive" CHECK ("settlement_batches"."version" >= 1),
	CONSTRAINT "settlement_batches_status_consistent" CHECK ((
        "settlement_batches"."status" = 'draft'
        AND "settlement_batches"."approved_by" IS NULL
        AND "settlement_batches"."approved_at" IS NULL
        AND "settlement_batches"."paid_by" IS NULL
        AND "settlement_batches"."paid_at" IS NULL
      ) OR (
        "settlement_batches"."status" = 'approved'
        AND "settlement_batches"."approved_by" IS NOT NULL
        AND "settlement_batches"."approved_at" IS NOT NULL
        AND "settlement_batches"."paid_by" IS NULL
        AND "settlement_batches"."paid_at" IS NULL
      ) OR (
        "settlement_batches"."status" = 'paid'
        AND "settlement_batches"."approved_by" IS NOT NULL
        AND "settlement_batches"."approved_at" IS NOT NULL
        AND "settlement_batches"."paid_by" IS NOT NULL
        AND "settlement_batches"."paid_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"amount_fen" integer NOT NULL,
	"ledger_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_items_amount_nonzero" CHECK ("settlement_items"."amount_fen" <> 0)
);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_snapshot_id_order_commission_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."order_commission_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policy_versions" ADD CONSTRAINT "commission_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policy_versions" ADD CONSTRAINT "commission_policy_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policy_versions" ADD CONSTRAINT "commission_policy_versions_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_policy_version_id_commission_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."commission_policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_commission_snapshots" ADD CONSTRAINT "order_commission_snapshots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_commission_snapshots" ADD CONSTRAINT "order_commission_snapshots_policy_version_id_commission_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."commission_policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quote_line_id_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."quote_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_id_quantity_unique" ON "order_lines" USING btree ("id","quantity");--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_line_quantity_fk" FOREIGN KEY ("order_line_id","order_line_quantity") REFERENCES "public"."order_lines"("id","quantity") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_batch_id_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_ledger_entry_id_commission_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."commission_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_ledger_event_identity_unique" ON "commission_ledger" USING btree ("order_id","rule_id","beneficiary_id","event_key");--> statement-breakpoint
CREATE INDEX "commission_ledger_beneficiary_occurred_idx" ON "commission_ledger" USING btree ("beneficiary_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commission_ledger_store_occurred_idx" ON "commission_ledger" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commission_ledger_order_idx" ON "commission_ledger" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commission_ledger_return_idx" ON "commission_ledger" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_policy_code_version_unique" ON "commission_policy_versions" USING btree ("policy_code","version_no");--> statement-breakpoint
CREATE INDEX "commission_policy_status_effective_idx" ON "commission_policy_versions" USING btree ("status","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_policy_code_unique" ON "commission_rules" USING btree ("policy_version_id","rule_code");--> statement-breakpoint
CREATE INDEX "commission_rules_match_idx" ON "commission_rules" USING btree ("business_domain","target_type","target_sku","payment_mode_scope");--> statement-breakpoint
CREATE INDEX "commission_rules_scope_idx" ON "commission_rules" USING btree ("salesperson_id","personnel_type","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_attributions_order_beneficiary_unique" ON "order_attributions" USING btree ("order_id","beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_attributions_one_primary_unique" ON "order_attributions" USING btree ("order_id") WHERE "order_attributions"."attribution_role" = 'primary';--> statement-breakpoint
CREATE INDEX "order_attributions_beneficiary_idx" ON "order_attributions" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_commission_snapshots_order_unique" ON "order_commission_snapshots" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_commission_snapshots_event_key_unique" ON "order_commission_snapshots" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "order_commission_snapshots_policy_idx" ON "order_commission_snapshots" USING btree ("policy_version_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_sku_idx" ON "order_lines" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_no_unique" ON "orders" USING btree ("order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_unique" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_quote_id_unique" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "orders_store_seller_created_idx" ON "orders" USING btree ("store_id","seller_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_return_line_unique" ON "return_items" USING btree ("return_id","order_line_id");--> statement-breakpoint
CREATE INDEX "return_items_order_line_idx" ON "return_items" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_return_no_unique" ON "returns" USING btree ("return_no");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_idempotency_key_unique" ON "returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_completion_idempotency_key_unique" ON "returns" USING btree ("completion_idempotency_key") WHERE "returns"."completion_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "returns_order_status_idx" ON "returns" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "returns_requested_at_idx" ON "returns" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batches_batch_no_unique" ON "settlement_batches" USING btree ("batch_no");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_batches_idempotency_key_unique" ON "settlement_batches" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "settlement_batches_period_status_idx" ON "settlement_batches" USING btree ("period_start","period_end","status");--> statement-breakpoint
CREATE INDEX "settlement_batches_scope_idx" ON "settlement_batches" USING btree ("store_id","beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_items_ledger_entry_unique" ON "settlement_items" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "settlement_items_batch_idx" ON "settlement_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "settlement_items_beneficiary_idx" ON "settlement_items" USING btree ("beneficiary_id");
