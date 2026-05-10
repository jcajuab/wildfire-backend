CREATE TEMPORARY TABLE `empty_playlist_ids` (
	`id` varchar(36) NOT NULL PRIMARY KEY
);
--> statement-breakpoint
INSERT INTO `empty_playlist_ids` (`id`)
SELECT `p`.`id`
FROM `playlists` `p`
LEFT JOIN `playlist_items` `pi` ON `pi`.`playlist_id` = `p`.`id`
GROUP BY `p`.`id`
HAVING COUNT(`pi`.`id`) = 0;
--> statement-breakpoint
DELETE `s`
FROM `schedules` `s`
INNER JOIN `schedule_playlist_targets` `spt` ON `spt`.`schedule_id` = `s`.`id`
INNER JOIN `empty_playlist_ids` `epi` ON `epi`.`id` = `spt`.`playlist_id`;
--> statement-breakpoint
DELETE `p`
FROM `playlists` `p`
INNER JOIN `empty_playlist_ids` `epi` ON `epi`.`id` = `p`.`id`;
--> statement-breakpoint
DROP TEMPORARY TABLE `empty_playlist_ids`;
