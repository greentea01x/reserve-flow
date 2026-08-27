SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"weekday" smallint PRIMARY KEY NOT NULL,
	"is_open" boolean NOT NULL,
	"open_time" time,
	"close_time" time,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_hours_weekday_range" CHECK ("business_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "business_hours_valid" CHECK (NOT "business_hours"."is_open" OR ("business_hours"."open_time" IS NOT NULL AND "business_hours"."close_time" IS NOT NULL AND "business_hours"."open_time" < "business_hours"."close_time"))
);
--> statement-breakpoint
CREATE TABLE "features" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	CONSTRAINT "features_key_format" CHECK ("features"."key" ~ '^[a-z_]{2,32}$')
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"day" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_features" (
	"room_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_features_room_id_feature_key_pk" PRIMARY KEY("room_id","feature_key"),
	CONSTRAINT "room_features_quantity_positive" CHECK ("room_features"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"floor" text,
	"location" text,
	"description" text,
	"capacity" integer NOT NULL,
	"photo" "bytea",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code"),
	CONSTRAINT "rooms_code_format" CHECK ("rooms"."code" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "rooms_name_length" CHECK (length("rooms"."name") BETWEEN 1 AND 80),
	CONSTRAINT "rooms_description_length" CHECK (length("rooms"."description") <= 1000),
	CONSTRAINT "rooms_capacity_range" CHECK ("rooms"."capacity" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_format" CHECK ("settings"."key" ~ '^[a-z_]{3,48}$')
);
--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_features" ADD CONSTRAINT "room_features_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_features" ADD CONSTRAINT "room_features_feature_key_features_key_fk" FOREIGN KEY ("feature_key") REFERENCES "public"."features"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();