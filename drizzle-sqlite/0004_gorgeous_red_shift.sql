CREATE TABLE `subscription_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`product_sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscription_plan_items_quantity_positive" CHECK("subscription_plan_items"."quantity" > 0 AND "subscription_plan_items"."quantity" <= 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_plan_items_plan_sku_unique` ON `subscription_plan_items` (`plan_id`,`product_sku`);--> statement-breakpoint
CREATE INDEX `subscription_plan_items_plan_idx` ON `subscription_plan_items` (`plan_id`);--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`monthly_fen` integer NOT NULL,
	`contract_months` integer DEFAULT 36 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "subscription_plans_code_present" CHECK(NULLIF(TRIM("subscription_plans"."code"), '') IS NOT NULL),
	CONSTRAINT "subscription_plans_name_present" CHECK(NULLIF(TRIM("subscription_plans"."name"), '') IS NOT NULL),
	CONSTRAINT "subscription_plans_monthly_positive" CHECK("subscription_plans"."monthly_fen" > 0),
	CONSTRAINT "subscription_plans_contract_36" CHECK("subscription_plans"."contract_months" = 36),
	CONSTRAINT "subscription_plans_version_positive" CHECK("subscription_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_plans_code_unique` ON `subscription_plans` (`code`);--> statement-breakpoint
CREATE INDEX `subscription_plans_active_name_idx` ON `subscription_plans` (`active`,`name`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TEMP TABLE `__invalid_commission_snapshots` (`id` text PRIMARY KEY);--> statement-breakpoint
INSERT INTO `__invalid_commission_snapshots` (`id`)
SELECT DISTINCT cl.snapshot_id
FROM commission_ledger cl
JOIN commission_rules cr ON cr.id = cl.rule_id
WHERE cl.snapshot_id IS NOT NULL
  AND (cr.target_type != 'product' OR cr.target_sku NOT IN ('WATCH', 'MATTRESS', 'GATEWAY', 'MOTION', 'DOOR', 'PORTABLE_BUTTON', 'WALL_BUTTON'));--> statement-breakpoint
DELETE FROM commission_ledger WHERE snapshot_id IN (SELECT id FROM `__invalid_commission_snapshots`);--> statement-breakpoint
DELETE FROM order_commission_snapshots WHERE id IN (SELECT id FROM `__invalid_commission_snapshots`);--> statement-breakpoint
DROP TABLE `__invalid_commission_snapshots`;--> statement-breakpoint
UPDATE commission_policy_versions SET policy_code = 'HAINAN_DEVICE_COMMISSION' WHERE policy_code = 'HAINAN_FTTR_HEARTLINK';--> statement-breakpoint
CREATE TABLE `__new_commission_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_version_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`rule_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`business_domain` text NOT NULL,
	`target_type` text NOT NULL,
	`target_sku` text,
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
	CONSTRAINT "commission_rules_amount_nonnegative" CHECK("__new_commission_rules"."amount_fen" >= 0),
	CONSTRAINT "commission_rules_version_positive" CHECK("__new_commission_rules"."version" >= 1),
	CONSTRAINT "commission_rules_effective_range" CHECK("__new_commission_rules"."effective_to" IS NULL OR "__new_commission_rules"."effective_to" >= "__new_commission_rules"."effective_from"),
	CONSTRAINT "commission_rules_target_present" CHECK("__new_commission_rules"."target_type" = 'product' AND "__new_commission_rules"."target_sku" IN ('WATCH', 'MATTRESS', 'GATEWAY', 'MOTION', 'DOOR', 'PORTABLE_BUTTON', 'WALL_BUTTON'))
);
--> statement-breakpoint
INSERT INTO `__new_commission_rules`("id", "policy_version_id", "rule_code", "rule_name", "status", "business_domain", "target_type", "target_sku", "payment_mode_scope", "calculation_basis", "package_mode", "amount_fen", "store_id", "personnel_type", "salesperson_id", "attribution_scope", "effective_from", "effective_to", "mutual_exclusion_group", "stackable", "allows_cross_domain", "change_note", "created_by", "version", "created_at", "updated_at") SELECT "id", "policy_version_id", "rule_code", "rule_name", "status", 'heartlink', 'product', "target_sku", "payment_mode_scope", 'per_unit', 'additive', "amount_fen", "store_id", "personnel_type", "salesperson_id", "attribution_scope", "effective_from", "effective_to", NULL, false, false, "change_note", "created_by", "version", "created_at", "updated_at" FROM `commission_rules` WHERE "target_type" = 'product' AND "target_sku" IN ('WATCH', 'MATTRESS', 'GATEWAY', 'MOTION', 'DOOR', 'PORTABLE_BUTTON', 'WALL_BUTTON');--> statement-breakpoint
DROP TABLE `commission_rules`;--> statement-breakpoint
ALTER TABLE `__new_commission_rules` RENAME TO `commission_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `commission_rules_policy_code_unique` ON `commission_rules` (`policy_version_id`,`rule_code`);--> statement-breakpoint
CREATE INDEX `commission_rules_match_idx` ON `commission_rules` (`business_domain`,`target_type`,`target_sku`,`payment_mode_scope`);--> statement-breakpoint
CREATE INDEX `commission_rules_scope_idx` ON `commission_rules` (`salesperson_id`,`personnel_type`,`store_id`);--> statement-breakpoint
CREATE TABLE `__new_orders` (
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
	`subscription_plan_id` text,
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
	FOREIGN KEY (`subscription_plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`signed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reconciled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_amounts_nonnegative" CHECK("__new_orders"."one_time_fen" >= 0 AND "__new_orders"."monthly_total_fen" >= 0 AND "__new_orders"."contract_36_fen" >= 0 AND "__new_orders"."refunded_fen" >= 0),
	CONSTRAINT "orders_payment_state_consistent" CHECK(("__new_orders"."payment_mode" = 'one_time' AND "__new_orders"."subscription_plan_id" IS NULL AND "__new_orders"."monthly_total_fen" = 0 AND "__new_orders"."contract_36_fen" = 0) OR ("__new_orders"."payment_mode" = 'contract_36' AND "__new_orders"."subscription_plan_id" IS NULL) OR ("__new_orders"."payment_mode" = 'contract_36' AND "__new_orders"."subscription_plan_id" IS NOT NULL AND "__new_orders"."one_time_fen" = 0 AND "__new_orders"."monthly_total_fen" > 0 AND "__new_orders"."contract_36_fen" = "__new_orders"."monthly_total_fen" * 36)),
	CONSTRAINT "orders_version_positive" CHECK("__new_orders"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "order_no", "idempotency_key", "quote_id", "customer_id", "store_id", "seller_id", "status", "sales_channel", "payment_mode", "subscription_plan_id", "one_time_fen", "monthly_total_fen", "contract_36_fen", "refunded_fen", "catalog_version", "catalog_snapshot", "customer_snapshot", "quote_snapshot", "store_snapshot", "seller_snapshot", "created_by", "accepted_at", "activated_at", "signed_at", "signed_by", "reconciled_at", "reconciled_by", "paid_at", "paid_by", "cancelled_at", "deleted_at", "version", "created_at", "updated_at") SELECT "id", "order_no", "idempotency_key", "quote_id", "customer_id", "store_id", "seller_id", "status", "sales_channel", "payment_mode", NULL, "one_time_fen", "monthly_total_fen", "contract_36_fen", "refunded_fen", "catalog_version", "catalog_snapshot", "customer_snapshot", "quote_snapshot", "store_snapshot", "seller_snapshot", "created_by", "accepted_at", "activated_at", "signed_at", "signed_by", "reconciled_at", "reconciled_by", "paid_at", "paid_by", "cancelled_at", "deleted_at", "version", "created_at", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_quote_id_unique` ON `orders` (`quote_id`);--> statement-breakpoint
CREATE INDEX `orders_store_seller_created_idx` ON `orders` (`store_id`,`seller_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_no` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text NOT NULL,
	`payment_mode` text NOT NULL,
	`subscription_plan_id` text,
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
	FOREIGN KEY (`subscription_plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quotes_amounts_nonnegative" CHECK("__new_quotes"."one_time_fen" >= 0 AND "__new_quotes"."monthly_total_fen" >= 0 AND "__new_quotes"."contract_36_fen" >= 0),
	CONSTRAINT "quotes_payment_state_consistent" CHECK(("__new_quotes"."payment_mode" = 'one_time' AND "__new_quotes"."subscription_plan_id" IS NULL AND "__new_quotes"."monthly_total_fen" = 0 AND "__new_quotes"."contract_36_fen" = 0) OR ("__new_quotes"."payment_mode" = 'contract_36' AND "__new_quotes"."subscription_plan_id" IS NULL) OR ("__new_quotes"."payment_mode" = 'contract_36' AND "__new_quotes"."subscription_plan_id" IS NOT NULL AND "__new_quotes"."one_time_fen" = 0 AND "__new_quotes"."monthly_total_fen" > 0 AND "__new_quotes"."contract_36_fen" = "__new_quotes"."monthly_total_fen" * 36)),
	CONSTRAINT "quotes_version_positive" CHECK("__new_quotes"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_quotes`("id", "quote_no", "idempotency_key", "customer_id", "store_id", "seller_id", "status", "payment_mode", "subscription_plan_id", "one_time_fen", "monthly_total_fen", "contract_36_fen", "catalog_version", "customer_snapshot", "quote_snapshot", "confirmed_at", "deleted_at", "version", "created_at", "updated_at") SELECT "id", "quote_no", "idempotency_key", "customer_id", "store_id", "seller_id", "status", "payment_mode", NULL, "one_time_fen", "monthly_total_fen", "contract_36_fen", "catalog_version", "customer_snapshot", "quote_snapshot", "confirmed_at", "deleted_at", "version", "created_at", "updated_at" FROM `quotes`;--> statement-breakpoint
DROP TABLE `quotes`;--> statement-breakpoint
ALTER TABLE `__new_quotes` RENAME TO `quotes`;--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_quote_no_unique` ON `quotes` (`quote_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_idempotency_key_unique` ON `quotes` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quotes_store_seller_idx` ON `quotes` (`store_id`,`seller_id`);--> statement-breakpoint
CREATE INDEX `quotes_customer_idx` ON `quotes` (`customer_id`);--> statement-breakpoint
CREATE INDEX `quotes_confirmed_at_idx` ON `quotes` (`confirmed_at`);--> statement-breakpoint
ALTER TABLE `order_lines` ADD `hardware_numbers` text DEFAULT '[]' NOT NULL;
