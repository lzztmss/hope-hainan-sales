CREATE TABLE `regional_manager_stores` (
	`regional_manager_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`regional_manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_manager_stores_store_unique` ON `regional_manager_stores` (`store_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_manager_stores_manager_store_unique` ON `regional_manager_stores` (`regional_manager_id`,`store_id`);
--> statement-breakpoint
CREATE INDEX `regional_manager_stores_manager_idx` ON `regional_manager_stores` (`regional_manager_id`);
