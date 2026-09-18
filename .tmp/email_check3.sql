SELECT tool_name, created_at, success, error_code, latency_ms
FROM voice_tool_calls
WHERE created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC
LIMIT 15;
