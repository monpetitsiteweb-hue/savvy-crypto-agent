-- Add cron job for BigQuery signal generation
SELECT cron.schedule(
  'bigquery-signal-generation',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/bigquery-signal-generator',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"symbols": ["BTC", "ETH", "XRP"], "action": "generate_signals"}'::jsonb
    ) as request_id;
  $$
);