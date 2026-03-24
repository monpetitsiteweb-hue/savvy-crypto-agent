SELECT cron.alter_job(
  28,
  command := $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/real-time-market-data',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"symbols": ["BTC-EUR", "ETH-EUR", "XRP-EUR"], "action": "get_current"}'::jsonb
    ) as request_id;
  $$
);