CREATE TABLE `uploaded_audio_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`action_id` text NOT NULL,
	`action_type` text NOT NULL,
	`asset_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "uploaded_audio_actions_type_ck" CHECK("uploaded_audio_actions"."action_type" in ('upload', 'transcribe', 'delete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_actions_session_action_uq` ON `uploaded_audio_actions` (`analysis_session_id`,`action_id`);--> statement-breakpoint
CREATE INDEX `uploaded_audio_actions_session_asset_idx` ON `uploaded_audio_actions` (`analysis_session_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `uploaded_audio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`speaker_role` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`relative_path` text NOT NULL,
	`status` text NOT NULL,
	`provider_label` text,
	`transcript_segment_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`completed_at` integer,
	`failed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`analysis_session_id`) REFERENCES `analysis_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "uploaded_audio_assets_byte_size_ck" CHECK("uploaded_audio_assets"."byte_size" > 0),
	CONSTRAINT "uploaded_audio_assets_speaker_role_ck" CHECK("uploaded_audio_assets"."speaker_role" in ('interviewer', 'candidate')),
	CONSTRAINT "uploaded_audio_assets_status_ck" CHECK("uploaded_audio_assets"."status" in ('uploaded', 'transcribing', 'completed', 'failed', 'deleting')),
	CONSTRAINT "uploaded_audio_assets_segment_count_ck" CHECK("uploaded_audio_assets"."transcript_segment_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `uploaded_audio_assets_session_created_idx` ON `uploaded_audio_assets` (`analysis_session_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_assets_relative_path_uq` ON `uploaded_audio_assets` (`relative_path`);--> statement-breakpoint
CREATE TABLE `uploaded_audio_deletion_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_session_id` text NOT NULL,
	`action_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_asset_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "uploaded_audio_deletion_batches_scope_ck" CHECK("uploaded_audio_deletion_batches"."scope" in ('asset', 'session')),
	CONSTRAINT "uploaded_audio_deletion_batches_status_ck" CHECK("uploaded_audio_deletion_batches"."status" in ('planned', 'metadata_deleted', 'completed')),
	CONSTRAINT "uploaded_audio_deletion_batches_target_ck" CHECK(("uploaded_audio_deletion_batches"."scope" = 'asset' and "uploaded_audio_deletion_batches"."target_asset_id" is not null) or ("uploaded_audio_deletion_batches"."scope" = 'session' and "uploaded_audio_deletion_batches"."target_asset_id" is null)),
	CONSTRAINT "uploaded_audio_deletion_batches_error_ck" CHECK("uploaded_audio_deletion_batches"."error_code" is null or length("uploaded_audio_deletion_batches"."error_code") <= 80),
	CONSTRAINT "uploaded_audio_deletion_batches_completed_ck" CHECK(("uploaded_audio_deletion_batches"."status" = 'completed' and "uploaded_audio_deletion_batches"."completed_at" is not null) or ("uploaded_audio_deletion_batches"."status" <> 'completed' and "uploaded_audio_deletion_batches"."completed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_deletion_batches_session_action_uq` ON `uploaded_audio_deletion_batches` (`analysis_session_id`,`action_id`);--> statement-breakpoint
CREATE INDEX `uploaded_audio_deletion_batches_session_status_idx` ON `uploaded_audio_deletion_batches` (`analysis_session_id`,`status`);--> statement-breakpoint
CREATE TABLE `uploaded_audio_deletion_files` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`original_relative_path` text NOT NULL,
	`tombstone_relative_path` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `uploaded_audio_deletion_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "uploaded_audio_deletion_files_status_ck" CHECK("uploaded_audio_deletion_files"."status" in ('planned', 'metadata_deleted', 'completed')),
	CONSTRAINT "uploaded_audio_deletion_files_paths_ck" CHECK(length("uploaded_audio_deletion_files"."original_relative_path") between 1 and 255 and length("uploaded_audio_deletion_files"."tombstone_relative_path") between 1 and 255 and "uploaded_audio_deletion_files"."original_relative_path" <> "uploaded_audio_deletion_files"."tombstone_relative_path"),
	CONSTRAINT "uploaded_audio_deletion_files_error_ck" CHECK("uploaded_audio_deletion_files"."error_code" is null or length("uploaded_audio_deletion_files"."error_code") <= 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_deletion_files_batch_asset_uq` ON `uploaded_audio_deletion_files` (`batch_id`,`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_audio_deletion_files_tombstone_uq` ON `uploaded_audio_deletion_files` (`tombstone_relative_path`);--> statement-breakpoint
ALTER TABLE `transcript_segments` ADD `source_uploaded_audio_asset_id` text REFERENCES uploaded_audio_assets(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `transcript_segments_uploaded_audio_asset_idx` ON `transcript_segments` (`source_uploaded_audio_asset_id`);
