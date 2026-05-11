UPDATE `playlist_items` `pi`
INNER JOIN `content` `c` ON `c`.`id` = `pi`.`content_id`
SET `pi`.`loop` = CASE WHEN `c`.`type` = 'VIDEO' THEN 1 ELSE 0 END;
