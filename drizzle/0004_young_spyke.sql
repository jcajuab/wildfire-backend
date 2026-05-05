CREATE TABLE `emergency_slots` (
	`slot_index` tinyint NOT NULL,
	`label` varchar(64) NOT NULL,
	`content_id` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emergency_slots_slot_index` PRIMARY KEY(`slot_index`)
);
--> statement-breakpoint
ALTER TABLE `displays` DROP FOREIGN KEY `displays_emergency_content_id_content_id_fk`;
--> statement-breakpoint
DROP INDEX `displays_emergency_content_id_idx` ON `displays`;--> statement-breakpoint
ALTER TABLE `runtime_control` ADD `active_slot_index` tinyint;--> statement-breakpoint
ALTER TABLE `emergency_slots` ADD CONSTRAINT `emergency_slots_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `emergency_slots_content_id_idx` ON `emergency_slots` (`content_id`);--> statement-breakpoint
ALTER TABLE `displays` DROP COLUMN `emergency_content_id`;