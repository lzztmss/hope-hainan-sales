CREATE TYPE "public"."fttr_kind" AS ENUM('none', 'standard', 'custom');--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "fttr_plan" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "fttr_kind" "fttr_kind";--> statement-breakpoint
UPDATE "quotes"
SET "fttr_kind" = CASE
  WHEN "fttr_monthly_fen" = 0 THEN 'none'::"fttr_kind"
  WHEN "fttr_plan" IN (129, 159, 199, 239, 299, 399)
    AND "fttr_monthly_fen" = "fttr_plan" * 100
    AND "custom_fttr_note" IS NULL
    THEN 'standard'::"fttr_kind"
  ELSE 'custom'::"fttr_kind"
END;--> statement-breakpoint
UPDATE "quotes"
SET
  "fttr_plan" = NULL,
  "custom_fttr_note" = NULL
WHERE "fttr_kind" = 'none';--> statement-breakpoint
UPDATE "quotes"
SET
  "custom_fttr_note" = COALESCE(
    NULLIF(BTRIM("custom_fttr_note"), ''),
    '历史自定义 FTTR 报价'
  )
WHERE "fttr_kind" = 'custom';--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "fttr_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_fttr_state_consistent" CHECK ((
        "quotes"."fttr_kind" = 'none'
        AND "quotes"."fttr_plan" IS NULL
        AND "quotes"."fttr_monthly_fen" = 0
        AND "quotes"."custom_fttr_note" IS NULL
      ) OR (
        "quotes"."fttr_kind" = 'standard'
        AND "quotes"."fttr_plan" IN (129, 159, 199, 239, 299, 399)
        AND "quotes"."fttr_monthly_fen" = "quotes"."fttr_plan" * 100
        AND "quotes"."custom_fttr_note" IS NULL
      ) OR (
        "quotes"."fttr_kind" = 'custom'
        AND "quotes"."fttr_plan" BETWEEN 1 AND 9999
        AND "quotes"."fttr_monthly_fen" = "quotes"."fttr_plan" * 100
        AND NULLIF(BTRIM("quotes"."custom_fttr_note"), '') IS NOT NULL
      ));
