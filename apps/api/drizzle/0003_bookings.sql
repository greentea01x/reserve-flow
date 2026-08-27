SET lock_timeout = '5s'; SET statement_timeout = '60s';
--> statement-breakpoint
CREATE TABLE "booking_attendees" (
	"booking_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"name" text,
	CONSTRAINT "booking_attendees_booking_id_email_pk" PRIMARY KEY("booking_id","email"),
	CONSTRAINT "booking_attendees_email_format" CHECK ("booking_attendees"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"special_request" text,
	"headcount" integer,
	"is_private" boolean DEFAULT false NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"slot" "tstzrange" GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reason_code" text,
	"reason" text,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	"checkin_method" text,
	"auto_released_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_idem_unique" UNIQUE("created_by","idempotency_key"),
	CONSTRAINT "bookings_title_length" CHECK (length("bookings"."title") BETWEEN 1 AND 200),
	CONSTRAINT "bookings_description_length" CHECK (length("bookings"."description") <= 2000),
	CONSTRAINT "bookings_special_request_length" CHECK (length("bookings"."special_request") <= 1000),
	CONSTRAINT "bookings_headcount_positive" CHECK ("bookings"."headcount" >= 1),
	CONSTRAINT "bookings_status_valid" CHECK ("bookings"."status" IN ('CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','AUTO_RELEASED')),
	CONSTRAINT "bookings_reason_code_valid" CHECK ("bookings"."reason_code" IN ('OWNER_CANCELLED','ADMIN_CANCELLED','OWNER_DISABLED','NO_SHOW')),
	CONSTRAINT "bookings_checkin_method_valid" CHECK ("bookings"."checkin_method" IN ('SELF','QR','ADMIN')),
	CONSTRAINT "bookings_time_order" CHECK ("bookings"."end_at" > "bookings"."start_at"),
	CONSTRAINT "bookings_15min_grid" CHECK (extract(epoch FROM "bookings"."start_at")::bigint % 900 = 0 AND extract(epoch FROM "bookings"."end_at")::bigint % 900 = 0),
	CONSTRAINT "bookings_hard_max" CHECK ("bookings"."end_at" - "bookings"."start_at" <= interval '12 hours'),
	CONSTRAINT "bookings_confirm_ok" CHECK ("bookings"."status" NOT IN ('CONFIRMED','CHECKED_IN','COMPLETED') OR "bookings"."confirmed_at" IS NOT NULL),
	CONSTRAINT "bookings_checkin_ok" CHECK ("bookings"."status" <> 'CHECKED_IN' OR ("bookings"."checked_in_at" IS NOT NULL AND "bookings"."checkin_method" IS NOT NULL)),
	CONSTRAINT "bookings_cancel_ok" CHECK ("bookings"."status" <> 'CANCELLED' OR ("bookings"."cancelled_at" IS NOT NULL AND "bookings"."cancelled_by" IS NOT NULL)),
	CONSTRAINT "bookings_release_ok" CHECK ("bookings"."status" <> 'AUTO_RELEASED' OR "bookings"."auto_released_at" IS NOT NULL),
	CONSTRAINT "bookings_terminal_why" CHECK ("bookings"."status" NOT IN ('CANCELLED','AUTO_RELEASED') OR "bookings"."reason_code" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "booking_attendees" ADD CONSTRAINT "booking_attendees_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_attendees_email_idx" ON "booking_attendees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "bookings_room_start_idx" ON "bookings" USING btree ("room_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_owner_idx" ON "bookings" USING btree ("owner_id","start_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_live_idx" ON "bookings" USING btree ("start_at","end_at") WHERE status IN ('CONFIRMED','CHECKED_IN');--> statement-breakpoint
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();