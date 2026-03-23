DROP INDEX `content_flash_messages_tone_idx` ON `content_flash_messages`;--> statement-breakpoint
DROP INDEX `display_active_keys_key_pair_id_idx` ON `display_active_keys`;--> statement-breakpoint
CREATE INDEX `content_owner_id_idx` ON `content` (`owner_id`);--> statement-breakpoint
CREATE INDEX `display_group_members_display_id_idx` ON `display_group_members` (`display_id`);--> statement-breakpoint
CREATE INDEX `playlist_items_content_id_idx` ON `playlist_items` (`content_id`);--> statement-breakpoint
CREATE INDEX `playlists_owner_id_idx` ON `playlists` (`owner_id`);