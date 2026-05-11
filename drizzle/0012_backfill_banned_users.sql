UPDATE users
SET banned_at = COALESCE(banned_at, CURRENT_TIMESTAMP)
WHERE is_active = false AND banned_at IS NULL;
