ALTER TABLE `returns` ADD `service_type` text DEFAULT 'refund' NOT NULL;
--> statement-breakpoint
ALTER TABLE `returns` ADD `requested_refund_fen` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `returns`
SET `requested_refund_fen` = CASE
  WHEN `status` = 'completed' THEN `refund_fen`
  ELSE COALESCE((
    SELECT SUM(CAST(json_extract(`return_items`.`item_snapshot`, '$.maxRefundFen') AS INTEGER))
    FROM `return_items`
    WHERE `return_items`.`return_id` = `returns`.`id`
  ), 0)
END;
