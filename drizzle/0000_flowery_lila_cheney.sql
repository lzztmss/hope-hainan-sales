CREATE TYPE "public"."payment_mode" AS ENUM('one_time', 'contract_36');--> statement-breakpoint
CREATE TYPE "public"."personnel_type" AS ENUM('unicom', 'auxiliary', 'admin');--> statement-breakpoint
CREATE TYPE "public"."print_event_type" AS ENUM('initial', 'reprint');--> statement-breakpoint
CREATE TYPE "public"."quote_line_type" AS ENUM('charge', 'component');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('confirmed', 'converted', 'expired', 'lost', 'voided');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('sales', 'store_manager', 'admin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"store_id" uuid,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"action" varchar(80) NOT NULL,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"reason" text,
	"source_ip" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name_encrypted" text NOT NULL,
	"phone_encrypted" text NOT NULL,
	"phone_lookup_hash" varchar(128) NOT NULL,
	"phone_tail" varchar(4) NOT NULL,
	"district_encrypted" text,
	"address_encrypted" text,
	"room_type" varchar(32),
	"elder_count" integer NOT NULL,
	"source" varchar(120),
	"notes_encrypted" text,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_elder_count_range" CHECK ("customers"."elder_count" BETWEEN 1 AND 20),
	CONSTRAINT "customers_version_positive" CHECK ("customers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "print_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" "print_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_type" "quote_line_type" NOT NULL,
	"sku" varchar(64) NOT NULL,
	"label" varchar(160) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"one_time_unit_fen" integer DEFAULT 0 NOT NULL,
	"monthly_unit_fen" integer DEFAULT 0 NOT NULL,
	"one_time_subtotal_fen" integer DEFAULT 0 NOT NULL,
	"monthly_subtotal_fen" integer DEFAULT 0 NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_quantity_positive" CHECK ("quote_lines"."quantity" > 0),
	CONSTRAINT "quote_lines_amounts_nonnegative" CHECK ("quote_lines"."one_time_unit_fen" >= 0 AND "quote_lines"."monthly_unit_fen" >= 0 AND "quote_lines"."one_time_subtotal_fen" >= 0 AND "quote_lines"."monthly_subtotal_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_no" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" "quote_status" NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"fttr_plan" integer NOT NULL,
	"custom_fttr_note" text,
	"fttr_monthly_fen" integer NOT NULL,
	"heart_monthly_fen" integer NOT NULL,
	"one_time_fen" integer NOT NULL,
	"monthly_total_fen" integer NOT NULL,
	"contract_36_fen" integer NOT NULL,
	"catalog_version" varchar(64) NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"quote_snapshot" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_amounts_nonnegative" CHECK ("quotes"."fttr_monthly_fen" >= 0 AND "quotes"."heart_monthly_fen" >= 0 AND "quotes"."one_time_fen" >= 0 AND "quotes"."monthly_total_fen" >= 0 AND "quotes"."contract_36_fen" >= 0),
	CONSTRAINT "quotes_version_positive" CHECK ("quotes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_no" varchar(64) NOT NULL,
	"phone_encrypted" text,
	"phone_lookup_hash" varchar(128),
	"display_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"personnel_type" "personnel_type" NOT NULL,
	"store_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_events" ADD CONSTRAINT "print_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_events" ADD CONSTRAINT "print_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_store_owner_idx" ON "customers" USING btree ("store_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "customers_phone_tail_idx" ON "customers" USING btree ("phone_tail");--> statement-breakpoint
CREATE INDEX "customers_phone_lookup_idx" ON "customers" USING btree ("phone_lookup_hash");--> statement-breakpoint
CREATE INDEX "print_events_quote_idx" ON "print_events" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_quote_no_unique" ON "quotes" USING btree ("quote_no");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_idempotency_key_unique" ON "quotes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "quotes_store_seller_idx" ON "quotes" USING btree ("store_id","seller_id");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_confirmed_at_idx" ON "quotes" USING btree ("confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_code_unique" ON "stores" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_work_no_unique" ON "users" USING btree ("work_no");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_lookup_hash_unique" ON "users" USING btree ("phone_lookup_hash") WHERE "users"."phone_lookup_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_store_idx" ON "users" USING btree ("store_id");