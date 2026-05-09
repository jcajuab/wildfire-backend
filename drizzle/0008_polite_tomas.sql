SET @playlist_show_counter_exists = (
	SELECT COUNT(*)
	FROM INFORMATION_SCHEMA.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'playlists'
		AND COLUMN_NAME = 'show_counter'
);
--> statement-breakpoint
SET @playlist_show_counter_statement = IF(
	@playlist_show_counter_exists = 0,
	'ALTER TABLE `playlists` ADD `show_counter` boolean DEFAULT false NOT NULL',
	'SELECT 1'
);
--> statement-breakpoint
PREPARE playlist_show_counter_statement FROM @playlist_show_counter_statement;
--> statement-breakpoint
EXECUTE playlist_show_counter_statement;
--> statement-breakpoint
DEALLOCATE PREPARE playlist_show_counter_statement;
