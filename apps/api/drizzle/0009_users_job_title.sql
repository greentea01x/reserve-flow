SET lock_timeout = '5s'; SET statement_timeout = '60s';
ALTER TABLE "users" ADD COLUMN "job_title" text DEFAULT 'พนักงาน' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_job_title_length" CHECK (length("users"."job_title") BETWEEN 1 AND 100);
