CREATE UNIQUE INDEX `regional_cooperation_manager_stage_confirmed_unique` ON `regional_cooperation_stages` (`regional_manager_id`,`stage_code`) WHERE `status` = 'confirmed';
