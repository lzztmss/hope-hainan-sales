UPDATE `return_items`
SET `item_snapshot` = json_set(
  `item_snapshot`,
  '$.maxRefundFen',
  (
    SELECT `order_lines`.`monthly_unit_fen` * `return_items`.`quantity`
    FROM `order_lines`
    INNER JOIN `orders` ON `orders`.`id` = `order_lines`.`order_id`
    WHERE `order_lines`.`id` = `return_items`.`order_line_id`
      AND `orders`.`payment_mode` = 'contract_36'
      AND `order_lines`.`monthly_unit_fen` > 0
  )
)
WHERE EXISTS (
  SELECT 1
  FROM `returns`
  INNER JOIN `order_lines` ON `order_lines`.`id` = `return_items`.`order_line_id`
  INNER JOIN `orders` ON `orders`.`id` = `order_lines`.`order_id`
  WHERE `returns`.`id` = `return_items`.`return_id`
    AND `returns`.`status` IN ('requested', 'approved')
    AND `orders`.`payment_mode` = 'contract_36'
    AND `order_lines`.`monthly_unit_fen` > 0
    AND COALESCE(
      CAST(json_extract(`return_items`.`item_snapshot`, '$.maxRefundFen') AS INTEGER),
      0
    ) = 0
);
