CREATE TABLE `password_hashes` (
	`user_id` varchar(36) NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_hashes_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
DROP INDEX `schedules_display_active_window_idx` ON `schedules`;--> statement-breakpoint
ALTER TABLE `invitations` ADD `encrypted_token` text;--> statement-breakpoint
ALTER TABLE `invitations` ADD `token_iv` text;--> statement-breakpoint
ALTER TABLE `invitations` ADD `token_auth_tag` text;--> statement-breakpoint
ALTER TABLE `password_hashes` ADD CONSTRAINT `password_hashes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `schedules_display_window_idx` ON `schedules` (`display_id`,`start_date`,`end_date`);--> statement-breakpoint
ALTER TABLE `schedules` DROP COLUMN `is_active`;