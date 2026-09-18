SELECT tool_name, created_at, success, error_code
FROM voice_tool_calls
WHERE tool_name LIKE '%email%'
ORDER BY created_at DESC
LIMIT 10;
