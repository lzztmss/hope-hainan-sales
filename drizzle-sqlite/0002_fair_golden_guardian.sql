WITH `active_assignment_rank` AS (
  SELECT
    `id`,
    `regional_manager_id`,
    `effective_from`,
    ROW_NUMBER() OVER (
      PARTITION BY `regional_manager_id`
      ORDER BY `effective_from` DESC, `created_at` DESC, `id` DESC
    ) AS `rank_no`
  FROM `regional_commission_template_assignments`
  WHERE `effective_to` IS NULL
)
UPDATE `regional_commission_template_assignments`
SET `effective_to` = CASE
  WHEN `effective_from` >= (
    SELECT `keeper`.`effective_from`
    FROM `active_assignment_rank` AS `keeper`
    WHERE `keeper`.`regional_manager_id` = `regional_commission_template_assignments`.`regional_manager_id`
      AND `keeper`.`rank_no` = 1
  ) THEN `effective_from`
  ELSE date((
    SELECT `keeper`.`effective_from`
    FROM `active_assignment_rank` AS `keeper`
    WHERE `keeper`.`regional_manager_id` = `regional_commission_template_assignments`.`regional_manager_id`
      AND `keeper`.`rank_no` = 1
  ), '-1 day')
END
WHERE `id` IN (
  SELECT `id`
  FROM `active_assignment_rank`
  WHERE `rank_no` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `regional_template_assignments_active_manager_unique` ON `regional_commission_template_assignments` (`regional_manager_id`) WHERE "regional_commission_template_assignments"."effective_to" IS NULL;
