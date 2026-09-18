SELECT email, (pin_uid IS NOT NULL) AS has_pin_uid, updated_at
FROM voice_access
ORDER BY updated_at DESC
LIMIT 10;
