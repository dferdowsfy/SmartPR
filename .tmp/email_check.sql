SELECT tool_name, created_at, success, error_code, email_sent
FROM voice_tool_calls
WHERE tool_name IN ('email_my_summary', 'verify_voice_pin')
ORDER BY created_at DESC
LIMIT 8;
