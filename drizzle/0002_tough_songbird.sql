ALTER TABLE "quotes" DROP CONSTRAINT "quotes_fttr_state_consistent";--> statement-breakpoint
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