SELECT tool_name, created_at, success, error_code
FROM voice_tool_calls
WHERE created_at > NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 20;
