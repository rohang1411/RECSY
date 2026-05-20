CREATE TABLE "exchange_rates" (
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(14, 8) NOT NULL,
	"source" text DEFAULT 'open.er-api.com' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_regional_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"price" numeric(12, 2),
	"currency" text NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"official_url" text,
	"price_source" text DEFAULT 'catalog_pipeline' NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"exchange_rate_used" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_regional_details" ADD CONSTRAINT "phone_regional_details_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_pair_uniq" ON "exchange_rates" USING btree ("base_currency","quote_currency");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_regional_details_phone_country_uniq" ON "phone_regional_details" USING btree ("phone_id","country_code");--> statement-breakpoint
CREATE INDEX "phone_regional_details_country_available_idx" ON "phone_regional_details" USING btree ("country_code","is_available");--> statement-breakpoint
CREATE INDEX "phone_regional_details_phone_idx" ON "phone_regional_details" USING btree ("phone_id");