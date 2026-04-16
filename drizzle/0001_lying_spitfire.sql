ALTER TABLE `auth_sessions` MODIFY COLUMN `current_jti` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_sessions` MODIFY COLUMN `previous_jti` varchar(64);