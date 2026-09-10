DROP INDEX `regional_cooperation_manager_stage_unique`;--> statement-breakpoint
CREATE INDEX `regional_cooperation_manager_stage_date_idx` ON `regional_cooperation_stages` (`regional_manager_id`,`stage_code`,`achieved_on`);
