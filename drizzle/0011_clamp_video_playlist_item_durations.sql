UPDATE `playlist_items` `pi`
INNER JOIN `content` `c` ON `c`.`id` = `pi`.`content_id`
INNER JOIN `content_assets` `ca` ON `ca`.`content_id` = `c`.`id`
SET `pi`.`duration` = `ca`.`duration`
WHERE `c`.`type` = 'VIDEO'
  AND `ca`.`duration` IS NOT NULL
  AND `ca`.`duration` > 0
  AND `pi`.`duration` > `ca`.`duration`;
