ALTER TABLE `orders` ADD `signed_at` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `signed_by` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `orders` ADD `reconciled_at` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `reconciled_by` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_at` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_by` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
UPDATE `orders`
SET `status` = 'signed',
    `signed_at` = COALESCE(`completed_at`, `activated_at`, `updated_at`)
WHERE `status` = 'completed';
--> statement-breakpoint
ALTER TABLE `returns` ADD `return_kind` text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE `returns` ADD `reason_category` text DEFAULT 'other' NOT NULL;
--> statement-breakpoint
ALTER TABLE `returns` ADD `order_status_before` text;
