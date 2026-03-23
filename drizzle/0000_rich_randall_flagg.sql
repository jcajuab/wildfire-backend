CREATE TABLE `ai_credentials` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` varchar(8) NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credentials_user_provider_unique` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`occurred_at` timestamp NOT NULL DEFAULT (now()),
	`request_id` varchar(128),
	`action` varchar(160) NOT NULL,
	`route` varchar(255),
	`method` varchar(10) NOT NULL,
	`path` varchar(255) NOT NULL,
	`status` int NOT NULL,
	`actor_id` varchar(36),
	`actor_type` enum('user','display'),
	`resource_id` varchar(36),
	`resource_type` varchar(120),
	`ip_address` varchar(64),
	`user_agent` varchar(255),
	`metadata_json` text,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`family_id` varchar(36) NOT NULL,
	`current_jti` varchar(36) NOT NULL,
	`previous_jti` varchar(36),
	`previous_jti_expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_change_tokens` (
	`hashed_token` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_change_tokens_hashed_token` PRIMARY KEY(`hashed_token`),
	CONSTRAINT `email_change_tokens_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` varchar(36) NOT NULL,
	`hashed_token` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`invited_by_user_id` varchar(36) NOT NULL,
	`encrypted_token` text,
	`token_iv` text,
	`token_auth_tag` text,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_hashed_token_unique` UNIQUE(`hashed_token`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`hashed_token` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_hashed_token` PRIMARY KEY(`hashed_token`)
);
--> statement-breakpoint
CREATE TABLE `content_ingestion_jobs` (
	`id` varchar(36) NOT NULL,
	`content_id` varchar(36) NOT NULL,
	`operation` enum('UPLOAD','REPLACE') NOT NULL,
	`status` enum('QUEUED','PROCESSING','SUCCEEDED','FAILED') NOT NULL DEFAULT 'QUEUED',
	`error_message` varchar(1024),
	`owner_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`completed_at` timestamp,
	CONSTRAINT `content_ingestion_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `content` (
	`id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`type` enum('IMAGE','VIDEO','FLASH','TEXT') NOT NULL,
	`status` enum('PROCESSING','READY','FAILED') NOT NULL DEFAULT 'PROCESSING',
	`owner_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `content_assets` (
	`content_id` varchar(36) NOT NULL,
	`file_key` varchar(512) NOT NULL,
	`thumbnail_key` varchar(512),
	`checksum` varchar(128) NOT NULL,
	`mime_type` varchar(120) NOT NULL,
	`file_size` int NOT NULL,
	`width` int,
	`height` int,
	`duration` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_assets_content_id` PRIMARY KEY(`content_id`),
	CONSTRAINT `content_assets_file_key_unique` UNIQUE(`file_key`)
);
--> statement-breakpoint
CREATE TABLE `content_flash_messages` (
	`content_id` varchar(36) NOT NULL,
	`message` varchar(240) NOT NULL,
	`tone` enum('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_flash_messages_content_id` PRIMARY KEY(`content_id`)
);
--> statement-breakpoint
CREATE TABLE `content_text_content` (
	`content_id` varchar(36) NOT NULL,
	`json_content` text NOT NULL,
	`html_content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_text_content_content_id` PRIMARY KEY(`content_id`)
);
--> statement-breakpoint
CREATE TABLE `display_active_keys` (
	`display_id` varchar(36) NOT NULL,
	`key_pair_id` varchar(36) NOT NULL,
	`activated_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `display_active_keys_display_id` PRIMARY KEY(`display_id`),
	CONSTRAINT `display_active_keys_key_pair_id_unique` UNIQUE(`key_pair_id`)
);
--> statement-breakpoint
CREATE TABLE `display_key_pairs` (
	`id` varchar(36) NOT NULL,
	`display_id` varchar(36) NOT NULL,
	`algorithm` enum('ed25519') NOT NULL,
	`public_key` varchar(4096) NOT NULL,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `display_key_pairs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `display_group_members` (
	`group_id` varchar(36) NOT NULL,
	`display_id` varchar(36) NOT NULL,
	CONSTRAINT `display_group_members_group_id_display_id_pk` PRIMARY KEY(`group_id`,`display_id`)
);
--> statement-breakpoint
CREATE TABLE `display_groups` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `display_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `display_groups_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `display_runtime_states` (
	`display_id` varchar(36) NOT NULL,
	`status` enum('PROCESSING','READY','LIVE','DOWN') NOT NULL DEFAULT 'PROCESSING',
	`ip_address` varchar(128),
	`mac_address` varchar(64),
	`screen_width` int,
	`screen_height` int,
	`orientation` enum('LANDSCAPE','PORTRAIT'),
	`last_seen_at` timestamp,
	`refresh_nonce` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `display_runtime_states_display_id` PRIMARY KEY(`display_id`)
);
--> statement-breakpoint
CREATE TABLE `displays` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`name` varchar(255) NOT NULL,
	`fingerprint` varchar(255),
	`output` varchar(64) NOT NULL DEFAULT 'unknown',
	`emergency_content_id` varchar(36),
	`location` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `displays_id` PRIMARY KEY(`id`),
	CONSTRAINT `displays_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `displays_fingerprint_output_unique` UNIQUE(`fingerprint`,`output`)
);
--> statement-breakpoint
CREATE TABLE `password_hashes` (
	`user_id` varchar(36) NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_hashes_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`id` varchar(36) NOT NULL,
	`playlist_id` varchar(36) NOT NULL,
	`content_id` varchar(36) NOT NULL,
	`sequence` int NOT NULL,
	`duration` int NOT NULL,
	CONSTRAINT `playlist_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `playlist_items_playlist_id_sequence_unique` UNIQUE(`playlist_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`status` enum('DRAFT','IN_USE') NOT NULL DEFAULT 'DRAFT',
	`owner_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `playlists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` varchar(36) NOT NULL,
	`resource` varchar(120) NOT NULL,
	`action` varchar(120) NOT NULL,
	`is_admin` boolean NOT NULL DEFAULT false,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_resource_action_unique` UNIQUE(`resource`,`action`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` varchar(36) NOT NULL,
	`permission_id` varchar(36) NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_id_pk` PRIMARY KEY(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`username` varchar(120) NOT NULL,
	`email` varchar(255),
	`name` varchar(255) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`timezone` varchar(64),
	`avatar_key` varchar(255),
	`last_seen_at` timestamp,
	`invited_at` timestamp,
	`banned_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `runtime_control` (
	`id` varchar(32) NOT NULL,
	`global_emergency_active` boolean NOT NULL DEFAULT false,
	`global_emergency_started_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `runtime_control_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_content_targets` (
	`schedule_id` varchar(36) NOT NULL,
	`content_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schedule_content_targets_schedule_id` PRIMARY KEY(`schedule_id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_playlist_targets` (
	`schedule_id` varchar(36) NOT NULL,
	`playlist_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schedule_playlist_targets_schedule_id` PRIMARY KEY(`schedule_id`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`display_id` varchar(36) NOT NULL,
	`start_date` varchar(10) NOT NULL,
	`end_date` varchar(10) NOT NULL,
	`start_time` varchar(5) NOT NULL,
	`end_time` varchar(5) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_credentials` ADD CONSTRAINT `ai_credentials_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_change_tokens` ADD CONSTRAINT `email_change_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_user_id_users_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_ingestion_jobs` ADD CONSTRAINT `content_ingestion_jobs_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_ingestion_jobs` ADD CONSTRAINT `content_ingestion_jobs_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content` ADD CONSTRAINT `content_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_assets` ADD CONSTRAINT `content_assets_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_flash_messages` ADD CONSTRAINT `content_flash_messages_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `content_text_content` ADD CONSTRAINT `content_text_content_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_active_keys` ADD CONSTRAINT `display_active_keys_display_id_displays_id_fk` FOREIGN KEY (`display_id`) REFERENCES `displays`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_active_keys` ADD CONSTRAINT `display_active_keys_key_pair_id_display_key_pairs_id_fk` FOREIGN KEY (`key_pair_id`) REFERENCES `display_key_pairs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_key_pairs` ADD CONSTRAINT `display_key_pairs_display_id_displays_id_fk` FOREIGN KEY (`display_id`) REFERENCES `displays`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_group_members` ADD CONSTRAINT `display_group_members_group_id_display_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `display_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_group_members` ADD CONSTRAINT `display_group_members_display_id_displays_id_fk` FOREIGN KEY (`display_id`) REFERENCES `displays`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `display_runtime_states` ADD CONSTRAINT `display_runtime_states_display_id_displays_id_fk` FOREIGN KEY (`display_id`) REFERENCES `displays`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `displays` ADD CONSTRAINT `displays_emergency_content_id_content_id_fk` FOREIGN KEY (`emergency_content_id`) REFERENCES `content`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_hashes` ADD CONSTRAINT `password_hashes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playlist_items` ADD CONSTRAINT `playlist_items_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playlist_items` ADD CONSTRAINT `playlist_items_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `playlists` ADD CONSTRAINT `playlists_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_content_targets` ADD CONSTRAINT `schedule_content_targets_schedule_id_schedules_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_content_targets` ADD CONSTRAINT `schedule_content_targets_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_playlist_targets` ADD CONSTRAINT `schedule_playlist_targets_schedule_id_schedules_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_playlist_targets` ADD CONSTRAINT `schedule_playlist_targets_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedules` ADD CONSTRAINT `schedules_display_id_displays_id_fk` FOREIGN KEY (`display_id`) REFERENCES `displays`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedules` ADD CONSTRAINT `schedules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_credentials_user_id_idx` ON `ai_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_occurred_at_idx` ON `audit_logs` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_occurred_idx` ON `audit_logs` (`actor_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_occurred_idx` ON `audit_logs` (`action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_resource_occurred_idx` ON `audit_logs` (`resource_type`,`resource_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_status_occurred_idx` ON `audit_logs` (`status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_request_id_idx` ON `audit_logs` (`request_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_expires_at_idx` ON `auth_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_family_id_idx` ON `auth_sessions` (`family_id`);--> statement-breakpoint
CREATE INDEX `email_change_tokens_expires_at_idx` ON `email_change_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `invitations_email_created_at_idx` ON `invitations` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `invitations_accepted_at_idx` ON `invitations` (`accepted_at`);--> statement-breakpoint
CREATE INDEX `invitations_revoked_at_idx` ON `invitations` (`revoked_at`);--> statement-breakpoint
CREATE INDEX `invitations_created_at_idx` ON `invitations` (`created_at`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_expires_at_idx` ON `password_reset_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_email_idx` ON `password_reset_tokens` (`email`);--> statement-breakpoint
CREATE INDEX `content_ingestion_jobs_content_id_idx` ON `content_ingestion_jobs` (`content_id`);--> statement-breakpoint
CREATE INDEX `content_ingestion_jobs_status_idx` ON `content_ingestion_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `content_ingestion_jobs_created_at_idx` ON `content_ingestion_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `content_status_idx` ON `content` (`status`);--> statement-breakpoint
CREATE INDEX `content_type_idx` ON `content` (`type`);--> statement-breakpoint
CREATE INDEX `content_owner_id_idx` ON `content` (`owner_id`);--> statement-breakpoint
CREATE INDEX `content_created_at_idx` ON `content` (`created_at`);--> statement-breakpoint
CREATE INDEX `content_status_type_created_at_idx` ON `content` (`status`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_assets_mime_type_idx` ON `content_assets` (`mime_type`);--> statement-breakpoint
CREATE INDEX `content_assets_file_size_idx` ON `content_assets` (`file_size`);--> statement-breakpoint
CREATE INDEX `display_key_pairs_display_id_created_idx` ON `display_key_pairs` (`display_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `display_key_pairs_display_id_revoked_idx` ON `display_key_pairs` (`display_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `display_group_members_display_id_idx` ON `display_group_members` (`display_id`);--> statement-breakpoint
CREATE INDEX `display_runtime_states_status_idx` ON `display_runtime_states` (`status`);--> statement-breakpoint
CREATE INDEX `display_runtime_states_last_seen_at_idx` ON `display_runtime_states` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `display_runtime_states_updated_at_idx` ON `display_runtime_states` (`updated_at`);--> statement-breakpoint
CREATE INDEX `displays_emergency_content_id_idx` ON `displays` (`emergency_content_id`);--> statement-breakpoint
CREATE INDEX `displays_created_at_idx` ON `displays` (`created_at`);--> statement-breakpoint
CREATE INDEX `playlist_items_content_id_idx` ON `playlist_items` (`content_id`);--> statement-breakpoint
CREATE INDEX `playlists_status_idx` ON `playlists` (`status`);--> statement-breakpoint
CREATE INDEX `playlists_name_idx` ON `playlists` (`name`);--> statement-breakpoint
CREATE INDEX `playlists_owner_id_idx` ON `playlists` (`owner_id`);--> statement-breakpoint
CREATE INDEX `playlists_updated_at_idx` ON `playlists` (`updated_at`);--> statement-breakpoint
CREATE INDEX `playlists_status_updated_at_idx` ON `playlists` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `schedule_content_targets_content_id_idx` ON `schedule_content_targets` (`content_id`);--> statement-breakpoint
CREATE INDEX `schedule_playlist_targets_playlist_id_idx` ON `schedule_playlist_targets` (`playlist_id`);--> statement-breakpoint
CREATE INDEX `schedules_display_id_idx` ON `schedules` (`display_id`);--> statement-breakpoint
CREATE INDEX `schedules_display_window_idx` ON `schedules` (`display_id`,`start_date`,`end_date`);