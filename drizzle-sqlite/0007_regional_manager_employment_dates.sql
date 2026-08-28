ALTER TABLE `users` ADD `employment_start_date` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `employment_end_date` text;
--> statement-breakpoint
UPDATE `users`
SET `employment_start_date` = date(`created_at` / 1000, 'unixepoch', '+8 hours')
WHERE `role` = 'regional_manager' AND `employment_start_date` IS NULL;
