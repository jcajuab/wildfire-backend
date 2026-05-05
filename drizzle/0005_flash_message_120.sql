-- Ensure no flash message row exceeds 120 chars before migrating (truncate or edit first).
ALTER TABLE `content_flash_messages` MODIFY `message` varchar(120) NOT NULL;
