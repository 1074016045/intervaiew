WITH `migration_clock`(`now_ms`) AS (
	VALUES (CAST(unixepoch('subsec') * 1000 AS integer))
)
UPDATE `uploaded_audio_assets`
SET `status` = 'failed',
	`error_code` = 'UPLOADED_AUDIO_TRANSCRIPTION_INTERRUPTED',
	`failed_at` = (SELECT `now_ms` FROM `migration_clock`),
	`updated_at` = (SELECT `now_ms` FROM `migration_clock`)
WHERE `status` = 'transcribing';
--> statement-breakpoint
CREATE TABLE `uploaded_audio_transcription_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`action_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`maximum_attempts` integer NOT NULL,
	`available_at` integer NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`failed_at` integer,
	`cancelled_at` integer,
	`safe_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `uploaded_audio_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`analysis_session_id`,`action_id`,`asset_id`) REFERENCES `uploaded_audio_actions`(`analysis_session_id`,`action_id`,`asset_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "uploaded_audio_transcription_jobs_status_ck" CHECK("uploaded_audio_transcription_jobs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "uploaded_audio_transcription_jobs_attempt_count_ck" CHECK("uploaded_audio_transcription_jobs"."attempt_count" >= 0),
	CONSTRAINT "uploaded_audio_transcription_jobs_maximum_attempts_ck" CHECK("uploaded_audio_transcription_jobs"."maximum_attempts" between 1 and 5),
	CONSTRAINT "uploaded_audio_transcription_jobs_attempt_limit_ck" CHECK("uploaded_audio_transcription_jobs"."attempt_count" <= "uploaded_audio_transcription_jobs"."maximum_attempts"),
	CONSTRAINT "uploaded_audio_transcription_jobs_safe_error_ck" CHECK("uploaded_audio_transcription_jobs"."safe_error_code" is null or length("uploaded_audio_transcription_jobs"."safe_error_code") <= 80),
	CONSTRAINT "uploaded_audio_transcription_jobs_updated_ck" CHECK("uploaded_audio_transcription_jobs"."updated_at" >= "uploaded_audio_transcription_jobs"."created_at"),
	CONSTRAINT "uploaded_audio_transcription_jobs_running_ck" CHECK(("uploaded_audio_transcription_jobs"."status" = 'running' and "uploaded_audio_transcription_jobs"."lease_token" is not null and "uploaded_audio_transcription_jobs"."lease_expires_at" is not null and "uploaded_audio_transcription_jobs"."started_at" is not null and "uploaded_audio_transcription_jobs"."attempt_count" >= 1) or ("uploaded_audio_transcription_jobs"."status" <> 'running' and "uploaded_audio_transcription_jobs"."lease_token" is null and "uploaded_audio_transcription_jobs"."lease_expires_at" is null)),
	CONSTRAINT "uploaded_audio_transcription_jobs_terminal_timestamps_ck" CHECK(("uploaded_audio_transcription_jobs"."status" = 'completed' and "uploaded_audio_transcription_jobs"."completed_at" is not null and "uploaded_audio_transcription_jobs"."failed_at" is null and "uploaded_audio_transcription_jobs"."cancelled_at" is null) or ("uploaded_audio_transcription_jobs"."status" = 'failed' and "uploaded_audio_transcription_jobs"."completed_at" is null and "uploaded_audio_transcription_jobs"."failed_at" is not null and "uploaded_audio_transcription_jobs"."cancelled_at" is null) or ("uploaded_audio_transcription_jobs"."status" = 'cancelled' and "uploaded_audio_transcription_jobs"."completed_at" is null and "uploaded_audio_transcription_jobs"."failed_at" is null and "uploaded_audio_transcription_jobs"."cancelled_at" is not null) or ("uploaded_audio_transcription_jobs"."status" in ('queued', 'running') and "uploaded_audio_transcription_jobs"."completed_at" is null and "uploaded_audio_transcription_jobs"."failed_at" is null and "uploaded_audio_transcription_jobs"."cancelled_at" is null)),
	CONSTRAINT "uploaded_audio_transcription_jobs_completed_error_ck" CHECK("uploaded_audio_transcription_jobs"."status" <> 'completed' or "uploaded_audio_transcription_jobs"."safe_error_code" is null),
	CONSTRAINT "uploaded_audio_transcription_jobs_failed_error_ck" CHECK("uploaded_audio_transcription_jobs"."status" <> 'failed' or "uploaded_audio_transcription_jobs"."safe_error_code" is not null),
	CONSTRAINT "uploaded_audio_transcription_jobs_queued_terminal_ck" CHECK("uploaded_audio_transcription_jobs"."status" <> 'queued' or ("uploaded_audio_transcription_jobs"."completed_at" is null and "uploaded_audio_transcription_jobs"."failed_at" is null and "uploaded_audio_transcription_jobs"."cancelled_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_transcription_jobs_session_action_uq` ON `uploaded_audio_transcription_jobs` (`analysis_session_id`,`action_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_transcription_jobs_active_asset_uq` ON `uploaded_audio_transcription_jobs` (`asset_id`) WHERE "uploaded_audio_transcription_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `uploaded_audio_transcription_jobs_claim_idx` ON `uploaded_audio_transcription_jobs` (`status`,`available_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `uploaded_audio_transcription_jobs_expired_lease_idx` ON `uploaded_audio_transcription_jobs` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `uploaded_audio_transcription_jobs_session_asset_latest_idx` ON `uploaded_audio_transcription_jobs` (`analysis_session_id`,`asset_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_transcription_jobs_lease_token_uq` ON `uploaded_audio_transcription_jobs` (`lease_token`) WHERE "uploaded_audio_transcription_jobs"."lease_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_actions_session_action_asset_uq` ON `uploaded_audio_actions` (`analysis_session_id`,`action_id`,`asset_id`);
