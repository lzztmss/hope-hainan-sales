PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_commission_ledger` (
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
        "__new_commission_ledger"."entry_type" IN ('accrual', 'manual_positive', 'settlement')
        AND "__new_commission_ledger"."amount_fen" > 0
      ) OR (
        "__new_commission_ledger"."entry_type" IN ('return_reversal', 'manual_negative', 'settlement_reversal')
        AND "__new_commission_ledger"."amount_fen" < 0
      )),
	CONSTRAINT "commission_ledger_manual_reason" CHECK("__new_commission_ledger"."entry_type" NOT IN ('manual_positive', 'manual_negative') OR NULLIF(TRIM("__new_commission_ledger"."reason"), '') IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_commission_ledger`("id", "order_id", "return_id", "snapshot_id", "rule_id", "beneficiary_id", "store_id", "entry_type", "event_key", "amount_fen", "reason", "occurred_at", "created_by", "created_at") SELECT "id", "order_id", "return_id", "snapshot_id", "rule_id", "beneficiary_id", "store_id", "entry_type", "event_key", "amount_fen", "reason", "occurred_at", "created_by", "created_at" FROM `commission_ledger`;--> statement-breakpoint
DROP TABLE `commission_ledger`;--> statement-breakpoint
ALTER TABLE `__new_commission_ledger` RENAME TO `commission_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `commission_ledger_event_identity_unique` ON `commission_ledger` (`order_id`,`rule_id`,`beneficiary_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `commission_ledger_beneficiary_occurred_idx` ON `commission_ledger` (`beneficiary_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `commission_ledger_store_occurred_idx` ON `commission_ledger` (`store_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `commission_ledger_order_idx` ON `commission_ledger` (`order_id`);--> statement-breakpoint
CREATE INDEX `commission_ledger_return_idx` ON `commission_ledger` (`return_id`);--> statement-breakpoint
CREATE TABLE `__new_commission_rules` (
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
	CONSTRAINT "commission_rules_amount_nonnegative" CHECK("__new_commission_rules"."amount_fen" >= 0),
	CONSTRAINT "commission_rules_version_positive" CHECK("__new_commission_rules"."version" >= 1),
	CONSTRAINT "commission_rules_effective_range" CHECK("__new_commission_rules"."effective_to" IS NULL OR "__new_commission_rules"."effective_to" >= "__new_commission_rules"."effective_from"),
	CONSTRAINT "commission_rules_target_present" CHECK(("__new_commission_rules"."target_type" IN ('product', 'package') AND NULLIF(TRIM("__new_commission_rules"."target_sku"), '') IS NOT NULL) OR ("__new_commission_rules"."target_type" = 'fttr_plan' AND ("__new_commission_rules"."fttr_plan" BETWEEN 1 AND 9999 OR "__new_commission_rules"."target_sku" = 'CUSTOM')))
);
--> statement-breakpoint
INSERT INTO `__new_commission_rules`("id", "policy_version_id", "rule_code", "rule_name", "status", "business_domain", "target_type", "target_sku", "fttr_plan", "payment_mode_scope", "calculation_basis", "package_mode", "amount_fen", "store_id", "personnel_type", "salesperson_id", "attribution_scope", "effective_from", "effective_to", "mutual_exclusion_group", "stackable", "allows_cross_domain", "change_note", "created_by", "version", "created_at", "updated_at") SELECT "id", "policy_version_id", "rule_code", "rule_name", "status", "business_domain", "target_type", "target_sku", "fttr_plan", "payment_mode_scope", "calculation_basis", "package_mode", "amount_fen", "store_id", "personnel_type", "salesperson_id", "attribution_scope", "effective_from", "effective_to", "mutual_exclusion_group", "stackable", "allows_cross_domain", "change_note", "created_by", "version", "created_at", "updated_at" FROM `commission_rules`;--> statement-breakpoint
DROP TABLE `commission_rules`;--> statement-breakpoint
ALTER TABLE `__new_commission_rules` RENAME TO `commission_rules`;--> statement-breakpoint
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
	`completed_at` integer,
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
	CONSTRAINT "orders_amounts_nonnegative" CHECK("__new_orders"."fttr_monthly_fen" >= 0 AND "__new_orders"."heart_monthly_fen" >= 0 AND "__new_orders"."one_time_fen" >= 0 AND "__new_orders"."monthly_total_fen" >= 0 AND "__new_orders"."contract_36_fen" >= 0 AND "__new_orders"."refunded_fen" >= 0),
	CONSTRAINT "orders_fttr_state_consistent" CHECK((
        "__new_orders"."fttr_kind" = 'none'
        AND "__new_orders"."fttr_plan" IS NULL
        AND "__new_orders"."fttr_monthly_fen" = 0
        AND "__new_orders"."custom_fttr_note" IS NULL
      ) OR (
        "__new_orders"."fttr_kind" = 'standard'
        AND "__new_orders"."fttr_plan" IN (129, 159, 199, 239, 299, 399)
        AND "__new_orders"."fttr_monthly_fen" = "__new_orders"."fttr_plan" * 100
        AND "__new_orders"."custom_fttr_note" IS NULL
      ) OR (
        "__new_orders"."fttr_kind" = 'custom'
        AND "__new_orders"."fttr_plan" BETWEEN 1 AND 9999
        AND "__new_orders"."fttr_monthly_fen" = "__new_orders"."fttr_plan" * 100
        AND NULLIF(TRIM("__new_orders"."custom_fttr_note"), '') IS NOT NULL
      )),
	CONSTRAINT "orders_version_positive" CHECK("__new_orders"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "order_no", "idempotency_key", "quote_id", "customer_id", "store_id", "seller_id", "status", "payment_mode", "fttr_kind", "fttr_plan", "custom_fttr_note", "fttr_monthly_fen", "heart_monthly_fen", "one_time_fen", "monthly_total_fen", "contract_36_fen", "refunded_fen", "catalog_version", "catalog_snapshot", "customer_snapshot", "quote_snapshot", "store_snapshot", "seller_snapshot", "created_by", "accepted_at", "activated_at", "completed_at", "cancelled_at", "deleted_at", "version", "created_at", "updated_at") SELECT "id", "order_no", "idempotency_key", "quote_id", "customer_id", "store_id", "seller_id", "status", "payment_mode", "fttr_kind", "fttr_plan", "custom_fttr_note", "fttr_monthly_fen", "heart_monthly_fen", "one_time_fen", "monthly_total_fen", "contract_36_fen", "refunded_fen", "catalog_version", "catalog_snapshot", "customer_snapshot", "quote_snapshot", "store_snapshot", "seller_snapshot", "created_by", "accepted_at", "activated_at", "completed_at", "cancelled_at", "deleted_at", "version", "created_at", "updated_at" FROM `orders`;--> statement-breakpoint
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
	CONSTRAINT "quotes_amounts_nonnegative" CHECK("__new_quotes"."fttr_monthly_fen" >= 0 AND "__new_quotes"."heart_monthly_fen" >= 0 AND "__new_quotes"."one_time_fen" >= 0 AND "__new_quotes"."monthly_total_fen" >= 0 AND "__new_quotes"."contract_36_fen" >= 0),
	CONSTRAINT "quotes_fttr_state_consistent" CHECK((
        "__new_quotes"."fttr_kind" = 'none'
        AND "__new_quotes"."fttr_plan" IS NULL
        AND "__new_quotes"."fttr_monthly_fen" = 0
        AND "__new_quotes"."custom_fttr_note" IS NULL
      ) OR (
        "__new_quotes"."fttr_kind" = 'standard'
        AND "__new_quotes"."fttr_plan" IN (129, 159, 199, 239, 299, 399)
        AND "__new_quotes"."fttr_monthly_fen" = "__new_quotes"."fttr_plan" * 100
        AND "__new_quotes"."custom_fttr_note" IS NULL
      ) OR (
        "__new_quotes"."fttr_kind" = 'custom'
        AND "__new_quotes"."fttr_plan" BETWEEN 1 AND 9999
        AND "__new_quotes"."fttr_monthly_fen" = "__new_quotes"."fttr_plan" * 100
        AND NULLIF(TRIM("__new_quotes"."custom_fttr_note"), '') IS NOT NULL
      )),
	CONSTRAINT "quotes_version_positive" CHECK("__new_quotes"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_quotes`("id", "quote_no", "idempotency_key", "customer_id", "store_id", "seller_id", "status", "payment_mode", "fttr_kind", "fttr_plan", "custom_fttr_note", "fttr_monthly_fen", "heart_monthly_fen", "one_time_fen", "monthly_total_fen", "contract_36_fen", "catalog_version", "customer_snapshot", "quote_snapshot", "confirmed_at", "deleted_at", "version", "created_at", "updated_at") SELECT "id", "quote_no", "idempotency_key", "customer_id", "store_id", "seller_id", "status", "payment_mode", "fttr_kind", "fttr_plan", "custom_fttr_note", "fttr_monthly_fen", "heart_monthly_fen", "one_time_fen", "monthly_total_fen", "contract_36_fen", "catalog_version", "customer_snapshot", "quote_snapshot", "confirmed_at", "deleted_at", "version", "created_at", "updated_at" FROM `quotes`;--> statement-breakpoint
DROP TABLE `quotes`;--> statement-breakpoint
ALTER TABLE `__new_quotes` RENAME TO `quotes`;--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_quote_no_unique` ON `quotes` (`quote_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_idempotency_key_unique` ON `quotes` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quotes_store_seller_idx` ON `quotes` (`store_id`,`seller_id`);--> statement-breakpoint
CREATE INDEX `quotes_customer_idx` ON `quotes` (`customer_id`);--> statement-breakpoint
CREATE INDEX `quotes_confirmed_at_idx` ON `quotes` (`confirmed_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_primary_store_manager` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_primary_store_manager_unique` ON `users` (`store_id`) WHERE "users"."is_primary_store_manager" = 1;