CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`store_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`action` text NOT NULL,
	`before_snapshot` text,
	`after_snapshot` text,
	`reason` text,
	`source_ip` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `commission_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`return_id` text,
	`snapshot_id` text,
	`rule_id` text,
	`beneficiary_id` text NOT NULL,
	`store_id` text,
	`entry_type` text NOT NULL,
	`event_key` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`reason` text,
	`occurred_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`snapshot_id`) REFERENCES `order_commission_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_id`) REFERENCES `commission_rules`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "commission_ledger_amount_sign" CHECK((
        "commission_ledger"."entry_type" IN ('accrual', 'manual_positive', 'settlement')
        AND "commission_ledger"."amount_fen" > 0
      ) OR (
        "commission_ledger"."entry_type" IN ('return_reversal', 'manual_negative', 'settlement_reversal')
        AND "commission_ledger"."amount_fen" < 0
      )),
	CONSTRAINT "commission_ledger_manual_reason" CHECK("commission_ledger"."entry_type" NOT IN ('manual_positive', 'manual_negative') OR NULLIF(TRIM("commission_ledger"."reason"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_ledger_event_identity_unique` ON `commission_ledger` (`order_id`,`rule_id`,`beneficiary_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `commission_ledger_beneficiary_occurred_idx` ON `commission_ledger` (`beneficiary_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `commission_ledger_store_occurred_idx` ON `commission_ledger` (`store_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `commission_ledger_order_idx` ON `commission_ledger` (`order_id`);--> statement-breakpoint
CREATE INDEX `commission_ledger_return_idx` ON `commission_ledger` (`return_id`);--> statement-breakpoint
CREATE TABLE `commission_policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_code` text NOT NULL,
	`version_no` integer NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`created_by` text NOT NULL,
	`published_by` text,
	`published_at` integer,
	`stopped_by` text,
	`stopped_at` integer,
	`change_note` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stopped_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "commission_policy_version_no_positive" CHECK("commission_policy_versions"."version_no" >= 1),
	CONSTRAINT "commission_policy_version_positive" CHECK("commission_policy_versions"."version" >= 1),
	CONSTRAINT "commission_policy_effective_range" CHECK("commission_policy_versions"."effective_to" IS NULL OR "commission_policy_versions"."effective_to" > "commission_policy_versions"."effective_from" OR ("commission_policy_versions"."status" = 'stopped' AND "commission_policy_versions"."effective_to" = "commission_policy_versions"."effective_from"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_policy_code_version_unique` ON `commission_policy_versions` (`policy_code`,`version_no`);--> statement-breakpoint
CREATE INDEX `commission_policy_status_effective_idx` ON `commission_policy_versions` (`status`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE TABLE `commission_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_version_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`rule_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`business_domain` text NOT NULL,
	`target_type` text NOT NULL,
	`target_sku` text,
	`fttr_plan` integer,
	`payment_mode_scope` text NOT NULL,
	`calculation_basis` text NOT NULL,
	`package_mode` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`store_id` text,
	`personnel_type` text,
	`salesperson_id` text,
	`attribution_scope` text DEFAULT 'all' NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`mutual_exclusion_group` text,
	`stackable` integer DEFAULT false NOT NULL,
	`allows_cross_domain` integer DEFAULT false NOT NULL,
	`change_note` text,
	`created_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`policy_version_id`) REFERENCES `commission_policy_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`salesperson_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "commission_rules_amount_nonnegative" CHECK("commission_rules"."amount_fen" >= 0),
	CONSTRAINT "commission_rules_version_positive" CHECK("commission_rules"."version" >= 1),
	CONSTRAINT "commission_rules_effective_range" CHECK("commission_rules"."effective_to" IS NULL OR "commission_rules"."effective_to" >= "commission_rules"."effective_from"),
	CONSTRAINT "commission_rules_target_present" CHECK(("commission_rules"."target_type" IN ('product', 'package') AND NULLIF(TRIM("commission_rules"."target_sku"), '') IS NOT NULL) OR ("commission_rules"."target_type" = 'fttr_plan' AND ("commission_rules"."fttr_plan" BETWEEN 1 AND 9999 OR "commission_rules"."target_sku" = 'CUSTOM')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_rules_policy_code_unique` ON `commission_rules` (`policy_version_id`,`rule_code`);--> statement-breakpoint
CREATE INDEX `commission_rules_match_idx` ON `commission_rules` (`business_domain`,`target_type`,`target_sku`,`payment_mode_scope`);--> statement-breakpoint
CREATE INDEX `commission_rules_scope_idx` ON `commission_rules` (`salesperson_id`,`personnel_type`,`store_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name_encrypted` text NOT NULL,
	`phone_encrypted` text NOT NULL,
	`phone_lookup_hash` text NOT NULL,
	`phone_tail` text NOT NULL,
	`district_encrypted` text,
	`address_encrypted` text,
	`room_type` text,
	`elder_count` integer NOT NULL,
	`source` text,
	`notes_encrypted` text,
	`created_by` text NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "customers_elder_count_range" CHECK("customers"."elder_count" BETWEEN 1 AND 20),
	CONSTRAINT "customers_version_positive" CHECK("customers"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `customers_store_owner_idx` ON `customers` (`store_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `customers_phone_tail_idx` ON `customers` (`phone_tail`);--> statement-breakpoint
CREATE INDEX `customers_phone_lookup_idx` ON `customers` (`phone_lookup_hash`);--> statement-breakpoint
CREATE TABLE `order_attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`beneficiary_id` text NOT NULL,
	`attribution_role` text NOT NULL,
	`basis_points` integer NOT NULL,
	`beneficiary_snapshot` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_attributions_basis_points_range" CHECK("order_attributions"."basis_points" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_attributions_order_beneficiary_unique` ON `order_attributions` (`order_id`,`beneficiary_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_attributions_one_primary_unique` ON `order_attributions` (`order_id`) WHERE "order_attributions"."attribution_role" = 'primary';--> statement-breakpoint
CREATE INDEX `order_attributions_beneficiary_idx` ON `order_attributions` (`beneficiary_id`);--> statement-breakpoint
CREATE TABLE `order_commission_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`event_key` text NOT NULL,
	`total_fen` integer NOT NULL,
	`calculation_snapshot` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_version_id`) REFERENCES `commission_policy_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_commission_snapshots_total_nonnegative" CHECK("order_commission_snapshots"."total_fen" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_commission_snapshots_order_unique` ON `order_commission_snapshots` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_commission_snapshots_event_key_unique` ON `order_commission_snapshots` (`event_key`);--> statement-breakpoint
CREATE INDEX `order_commission_snapshots_policy_idx` ON `order_commission_snapshots` (`policy_version_id`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`quote_line_id` text,
	`line_type` text NOT NULL,
	`sku` text NOT NULL,
	`label` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`one_time_unit_fen` integer DEFAULT 0 NOT NULL,
	`monthly_unit_fen` integer DEFAULT 0 NOT NULL,
	`one_time_subtotal_fen` integer DEFAULT 0 NOT NULL,
	`monthly_subtotal_fen` integer DEFAULT 0 NOT NULL,
	`locations` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`line_snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_line_id`) REFERENCES `quote_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_lines_quantity_positive" CHECK("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_amounts_nonnegative" CHECK("order_lines"."one_time_unit_fen" >= 0 AND "order_lines"."monthly_unit_fen" >= 0 AND "order_lines"."one_time_subtotal_fen" >= 0 AND "order_lines"."monthly_subtotal_fen" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_sku_idx` ON `order_lines` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_lines_id_quantity_unique` ON `order_lines` (`id`,`quantity`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`quote_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text NOT NULL,
	`sales_channel` text DEFAULT 'offline' NOT NULL,
	`payment_mode` text NOT NULL,
	`fttr_kind` text NOT NULL,
	`fttr_plan` integer,
	`custom_fttr_note` text,
	`fttr_monthly_fen` integer NOT NULL,
	`heart_monthly_fen` integer NOT NULL,
	`one_time_fen` integer NOT NULL,
	`monthly_total_fen` integer NOT NULL,
	`contract_36_fen` integer NOT NULL,
	`refunded_fen` integer DEFAULT 0 NOT NULL,
	`catalog_version` text NOT NULL,
	`catalog_snapshot` text NOT NULL,
	`customer_snapshot` text NOT NULL,
	`quote_snapshot` text NOT NULL,
	`store_snapshot` text NOT NULL,
	`seller_snapshot` text NOT NULL,
	`created_by` text NOT NULL,
	`accepted_at` integer,
	`activated_at` integer,
	`signed_at` integer,
	`signed_by` text,
	`reconciled_at` integer,
	`reconciled_by` text,
	`paid_at` integer,
	`paid_by` text,
	`cancelled_at` integer,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`signed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reconciled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_amounts_nonnegative" CHECK("orders"."fttr_monthly_fen" >= 0 AND "orders"."heart_monthly_fen" >= 0 AND "orders"."one_time_fen" >= 0 AND "orders"."monthly_total_fen" >= 0 AND "orders"."contract_36_fen" >= 0 AND "orders"."refunded_fen" >= 0),
	CONSTRAINT "orders_fttr_state_consistent" CHECK((
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
        AND NULLIF(TRIM("orders"."custom_fttr_note"), '') IS NOT NULL
      )),
	CONSTRAINT "orders_version_positive" CHECK("orders"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_quote_id_unique` ON `orders` (`quote_id`);--> statement-breakpoint
CREATE INDEX `orders_store_seller_created_idx` ON `orders` (`store_id`,`seller_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `print_events` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `print_events_quote_idx` ON `print_events` (`quote_id`);--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`line_type` text NOT NULL,
	`sku` text NOT NULL,
	`label` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`one_time_unit_fen` integer DEFAULT 0 NOT NULL,
	`monthly_unit_fen` integer DEFAULT 0 NOT NULL,
	`one_time_subtotal_fen` integer DEFAULT 0 NOT NULL,
	`monthly_subtotal_fen` integer DEFAULT 0 NOT NULL,
	`locations` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quote_lines_quantity_positive" CHECK("quote_lines"."quantity" > 0),
	CONSTRAINT "quote_lines_amounts_nonnegative" CHECK("quote_lines"."one_time_unit_fen" >= 0 AND "quote_lines"."monthly_unit_fen" >= 0 AND "quote_lines"."one_time_subtotal_fen" >= 0 AND "quote_lines"."monthly_subtotal_fen" >= 0)
);
--> statement-breakpoint
CREATE INDEX `quote_lines_quote_idx` ON `quote_lines` (`quote_id`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_no` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text NOT NULL,
	`payment_mode` text NOT NULL,
	`fttr_kind` text NOT NULL,
	`fttr_plan` integer,
	`custom_fttr_note` text,
	`fttr_monthly_fen` integer NOT NULL,
	`heart_monthly_fen` integer NOT NULL,
	`one_time_fen` integer NOT NULL,
	`monthly_total_fen` integer NOT NULL,
	`contract_36_fen` integer NOT NULL,
	`catalog_version` text NOT NULL,
	`customer_snapshot` text NOT NULL,
	`quote_snapshot` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quotes_amounts_nonnegative" CHECK("quotes"."fttr_monthly_fen" >= 0 AND "quotes"."heart_monthly_fen" >= 0 AND "quotes"."one_time_fen" >= 0 AND "quotes"."monthly_total_fen" >= 0 AND "quotes"."contract_36_fen" >= 0),
	CONSTRAINT "quotes_fttr_state_consistent" CHECK((
        "quotes"."fttr_kind" = 'none'
        AND "quotes"."fttr_plan" IS NULL
        AND "quotes"."fttr_monthly_fen" = 0
        AND "quotes"."custom_fttr_note" IS NULL
      ) OR (
        "quotes"."fttr_kind" = 'standard'
        AND "quotes"."fttr_plan" IN (129, 159, 199, 239, 299, 399)
        AND "quotes"."fttr_monthly_fen" = "quotes"."fttr_plan" * 100
        AND "quotes"."custom_fttr_note" IS NULL
      ) OR (
        "quotes"."fttr_kind" = 'custom'
        AND "quotes"."fttr_plan" BETWEEN 1 AND 9999
        AND "quotes"."fttr_monthly_fen" = "quotes"."fttr_plan" * 100
        AND NULLIF(TRIM("quotes"."custom_fttr_note"), '') IS NOT NULL
      )),
	CONSTRAINT "quotes_version_positive" CHECK("quotes"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_quote_no_unique` ON `quotes` (`quote_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_idempotency_key_unique` ON `quotes` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quotes_store_seller_idx` ON `quotes` (`store_id`,`seller_id`);--> statement-breakpoint
CREATE INDEX `quotes_customer_idx` ON `quotes` (`customer_id`);--> statement-breakpoint
CREATE INDEX `quotes_confirmed_at_idx` ON `quotes` (`confirmed_at`);--> statement-breakpoint
CREATE TABLE `regional_commission_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`statement_id` text,
	`event_key` text NOT NULL,
	`category` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`amount_fen` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`settlement_month` text NOT NULL,
	`detail_snapshot` text NOT NULL,
	`created_by` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`statement_id`) REFERENCES `regional_commission_statements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_ledger_nonzero" CHECK("regional_commission_ledger"."amount_fen" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_ledger_event_key_unique` ON `regional_commission_ledger` (`event_key`);--> statement-breakpoint
CREATE INDEX `regional_ledger_manager_month_idx` ON `regional_commission_ledger` (`regional_manager_id`,`settlement_month`);--> statement-breakpoint
CREATE INDEX `regional_ledger_source_idx` ON `regional_commission_ledger` (`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `regional_commission_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`settlement_month` text NOT NULL,
	`template_version_id` text NOT NULL,
	`target_plan_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`total_fen` integer NOT NULL,
	`calculation_snapshot` text NOT NULL,
	`calculated_by` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` integer,
	`paid_by` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_version_id`) REFERENCES `regional_commission_template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_plan_id`) REFERENCES `regional_commission_target_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`calculated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_statements_manager_month_unique` ON `regional_commission_statements` (`regional_manager_id`,`settlement_month`);--> statement-breakpoint
CREATE INDEX `regional_statements_month_status_idx` ON `regional_commission_statements` (`settlement_month`,`status`);--> statement-breakpoint
CREATE TABLE `regional_commission_target_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`target_order_count` integer NOT NULL,
	`cumulative_target_order_count` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `regional_commission_target_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "regional_commission_target_periods_target_positive" CHECK("regional_commission_target_periods"."target_order_count" > 0),
	CONSTRAINT "regional_commission_target_periods_date_order_valid" CHECK("regional_commission_target_periods"."ends_on" >= "regional_commission_target_periods"."starts_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_commission_target_periods_plan_sequence_unique` ON `regional_commission_target_periods` (`plan_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `regional_commission_target_periods_plan_idx` ON `regional_commission_target_periods` (`plan_id`,`starts_on`);--> statement-breakpoint
CREATE TABLE `regional_commission_target_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`plan_type` text NOT NULL,
	`period_count` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`is_preset` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`replaced_by_plan_id` text,
	`set_by` text,
	`change_reason` text DEFAULT '系统创建' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_commission_target_plans_type_periods_valid" CHECK(("regional_commission_target_plans"."plan_type" = 'quarter' AND "regional_commission_target_plans"."period_count" = 3) OR ("regional_commission_target_plans"."plan_type" = 'half_year' AND "regional_commission_target_plans"."period_count" = 6) OR ("regional_commission_target_plans"."plan_type" = 'year' AND "regional_commission_target_plans"."period_count" = 12)),
	CONSTRAINT "regional_commission_target_plans_date_order_valid" CHECK("regional_commission_target_plans"."ends_on" >= "regional_commission_target_plans"."starts_on")
);
--> statement-breakpoint
CREATE INDEX `regional_commission_target_plans_manager_idx` ON `regional_commission_target_plans` (`regional_manager_id`,`starts_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `regional_commission_target_plans_manager_preset_unique` ON `regional_commission_target_plans` (`regional_manager_id`) WHERE "regional_commission_target_plans"."is_preset" = 1;--> statement-breakpoint
CREATE TABLE `regional_commission_template_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`assigned_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_version_id`) REFERENCES `regional_commission_template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_template_assignment_dates_valid" CHECK("regional_commission_template_assignments"."effective_to" IS NULL OR "regional_commission_template_assignments"."effective_to" >= "regional_commission_template_assignments"."effective_from")
);
--> statement-breakpoint
CREATE INDEX `regional_template_assignments_manager_dates_idx` ON `regional_commission_template_assignments` (`regional_manager_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE TABLE `regional_commission_template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_code` text NOT NULL,
	`version_no` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_version_id` text,
	`rules_snapshot` text NOT NULL,
	`created_by` text NOT NULL,
	`published_by` text,
	`published_at` integer,
	`stopped_by` text,
	`stopped_at` integer,
	`change_reason` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stopped_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_template_version_positive" CHECK("regional_commission_template_versions"."version_no" > 0 AND "regional_commission_template_versions"."version" > 0),
	CONSTRAINT "regional_template_dates_valid" CHECK("regional_commission_template_versions"."effective_to" IS NULL OR "regional_commission_template_versions"."effective_to" >= "regional_commission_template_versions"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_template_code_version_unique` ON `regional_commission_template_versions` (`template_code`,`version_no`);--> statement-breakpoint
CREATE INDEX `regional_template_status_dates_idx` ON `regional_commission_template_versions` (`status`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE TABLE `regional_cooperation_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`stage_code` text NOT NULL,
	`stage_label` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`achieved_on` text NOT NULL,
	`evidence_no` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_by` text NOT NULL,
	`finance_verified_by` text,
	`finance_verified_at` integer,
	`confirmed_by` text,
	`confirmed_at` integer,
	`revoked_by` text,
	`revoked_at` integer,
	`revoke_reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`finance_verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_cooperation_amount_positive" CHECK("regional_cooperation_stages"."amount_fen" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_cooperation_manager_stage_unique` ON `regional_cooperation_stages` (`regional_manager_id`,`stage_code`);--> statement-breakpoint
CREATE TABLE `regional_manager_store_history` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`store_id` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_manager_store_history_period_valid" CHECK("regional_manager_store_history"."effective_to" IS NULL OR "regional_manager_store_history"."effective_to" > "regional_manager_store_history"."effective_from")
);
--> statement-breakpoint
CREATE INDEX `regional_manager_store_history_manager_period_idx` ON `regional_manager_store_history` (`regional_manager_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE INDEX `regional_manager_store_history_store_period_idx` ON `regional_manager_store_history` (`store_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE UNIQUE INDEX `regional_manager_store_history_active_store_unique` ON `regional_manager_store_history` (`store_id`) WHERE "regional_manager_store_history"."effective_to" IS NULL;--> statement-breakpoint
CREATE TABLE `regional_manager_stores` (
	`regional_manager_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_manager_stores_store_unique` ON `regional_manager_stores` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `regional_manager_stores_manager_store_unique` ON `regional_manager_stores` (`regional_manager_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `regional_manager_stores_manager_idx` ON `regional_manager_stores` (`regional_manager_id`);--> statement-breakpoint
CREATE TABLE `regional_net_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`regional_manager_id` text NOT NULL,
	`month` text NOT NULL,
	`net_receipt_fen` integer NOT NULL,
	`evidence_no` text NOT NULL,
	`note` text,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`entered_by` text NOT NULL,
	`verified_by` text,
	`verified_at` integer,
	`verification_reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`entered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_net_receipts_manager_month_unique` ON `regional_net_receipts` (`regional_manager_id`,`month`);--> statement-breakpoint
CREATE INDEX `regional_net_receipts_month_status_idx` ON `regional_net_receipts` (`month`,`verification_status`);--> statement-breakpoint
CREATE TABLE `regional_personal_channel_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`sku` text NOT NULL,
	`label` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_commission_fen` integer NOT NULL,
	`subtotal_fen` integer NOT NULL,
	`returned_quantity` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `regional_personal_channel_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "regional_personal_order_lines_values_valid" CHECK("regional_personal_channel_order_lines"."quantity" > 0 AND "regional_personal_channel_order_lines"."returned_quantity" BETWEEN 0 AND "regional_personal_channel_order_lines"."quantity" AND "regional_personal_channel_order_lines"."unit_commission_fen" >= 0 AND "regional_personal_channel_order_lines"."subtotal_fen" >= 0)
);
--> statement-breakpoint
CREATE INDEX `regional_personal_order_lines_order_idx` ON `regional_personal_channel_order_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `regional_personal_channel_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`regional_manager_id` text NOT NULL,
	`channel` text NOT NULL,
	`order_count` integer DEFAULT 1 NOT NULL,
	`business_date` text NOT NULL,
	`signed_on` text NOT NULL,
	`effective_on` text NOT NULL,
	`evidence_no` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`voided_by` text,
	`voided_at` integer,
	`void_reason` text,
	`returned_on` text,
	`return_reason` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regional_personal_orders_count_positive" CHECK("regional_personal_channel_orders"."order_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_personal_orders_no_unique` ON `regional_personal_channel_orders` (`order_no`);--> statement-breakpoint
CREATE INDEX `regional_personal_orders_manager_effective_idx` ON `regional_personal_channel_orders` (`regional_manager_id`,`effective_on`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`order_line_quantity` integer NOT NULL,
	`sku` text NOT NULL,
	`label` text NOT NULL,
	`quantity` integer NOT NULL,
	`refund_fen` integer DEFAULT 0 NOT NULL,
	`item_snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_line_id`,`order_line_quantity`) REFERENCES `order_lines`(`id`,`quantity`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "return_items_quantity_range" CHECK("return_items"."quantity" > 0 AND "return_items"."quantity" <= "return_items"."order_line_quantity"),
	CONSTRAINT "return_items_refund_nonnegative" CHECK("return_items"."refund_fen" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `return_items_return_line_unique` ON `return_items` (`return_id`,`order_line_id`);--> statement-breakpoint
CREATE INDEX `return_items_order_line_idx` ON `return_items` (`order_line_id`);--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`return_no` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`completion_idempotency_key` text,
	`order_id` text NOT NULL,
	`service_type` text DEFAULT 'refund' NOT NULL,
	`return_type` text NOT NULL,
	`return_kind` text DEFAULT 'normal' NOT NULL,
	`reason_category` text DEFAULT 'other' NOT NULL,
	`order_status_before` text,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`completed_by` text,
	`completed_at` integer,
	`requested_refund_fen` integer DEFAULT 0 NOT NULL,
	`refund_fen` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "returns_reason_present" CHECK(NULLIF(TRIM("returns"."reason"), '') IS NOT NULL),
	CONSTRAINT "returns_refund_nonnegative" CHECK("returns"."refund_fen" >= 0),
	CONSTRAINT "returns_requested_refund_nonnegative" CHECK("returns"."requested_refund_fen" >= 0),
	CONSTRAINT "returns_version_positive" CHECK("returns"."version" >= 1),
	CONSTRAINT "returns_decision_state_consistent" CHECK((
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
CREATE UNIQUE INDEX `returns_return_no_unique` ON `returns` (`return_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `returns_idempotency_key_unique` ON `returns` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `returns_completion_idempotency_key_unique` ON `returns` (`completion_idempotency_key`) WHERE "returns"."completion_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `returns_order_status_idx` ON `returns` (`order_id`,`status`);--> statement-breakpoint
CREATE INDEX `returns_requested_at_idx` ON `returns` (`requested_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settlement_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_no` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`store_id` text,
	`beneficiary_id` text,
	`total_fen` integer NOT NULL,
	`entry_count` integer NOT NULL,
	`filters_snapshot` text NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`paid_by` text,
	`paid_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "settlement_batches_period_range" CHECK("settlement_batches"."period_end" > "settlement_batches"."period_start"),
	CONSTRAINT "settlement_batches_entry_count" CHECK("settlement_batches"."entry_count" >= 0),
	CONSTRAINT "settlement_batches_version_positive" CHECK("settlement_batches"."version" >= 1),
	CONSTRAINT "settlement_batches_status_consistent" CHECK((
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
CREATE UNIQUE INDEX `settlement_batches_batch_no_unique` ON `settlement_batches` (`batch_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_batches_idempotency_key_unique` ON `settlement_batches` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `settlement_batches_period_status_idx` ON `settlement_batches` (`period_start`,`period_end`,`status`);--> statement-breakpoint
CREATE INDEX `settlement_batches_scope_idx` ON `settlement_batches` (`store_id`,`beneficiary_id`);--> statement-breakpoint
CREATE TABLE `settlement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`ledger_entry_id` text NOT NULL,
	`beneficiary_id` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`ledger_snapshot` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `settlement_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `commission_ledger`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "settlement_items_amount_nonzero" CHECK("settlement_items"."amount_fen" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_items_ledger_entry_unique` ON `settlement_items` (`ledger_entry_id`);--> statement-breakpoint
CREATE INDEX `settlement_items_batch_idx` ON `settlement_items` (`batch_id`);--> statement-breakpoint
CREATE INDEX `settlement_items_beneficiary_idx` ON `settlement_items` (`beneficiary_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_code_unique` ON `stores` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`work_no` text NOT NULL,
	`phone_encrypted` text,
	`phone_lookup_hash` text,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`personnel_type` text NOT NULL,
	`store_id` text,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`is_primary_store_manager` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`employment_start_date` text,
	`employment_end_date` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_work_no_unique` ON `users` (`work_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_lookup_hash_unique` ON `users` (`phone_lookup_hash`) WHERE "users"."phone_lookup_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `users_store_idx` ON `users` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_primary_store_manager_unique` ON `users` (`store_id`) WHERE "users"."is_primary_store_manager" = 1;