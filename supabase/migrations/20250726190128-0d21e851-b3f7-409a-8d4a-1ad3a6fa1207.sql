-- Schedule technical signal generator to run every 5 minutes
SELECT cron.schedule(
  'technical-signal-generator',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/technical-signal-generator',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"symbols": ["BTC-EUR", "ETH-EUR", "XRP-EUR"], "action": "generate_signals"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule crypto news collector to run every 10 minutes  
SELECT cron.schedule(
  'crypto-news-collector',
  '*/10 * * * *', -- Every 10 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/crypto-news-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "fetch_latest_news", "symbols": ["BTC", "ETH", "SOL", "XRP"], "hours": 24}'::jsonb
    ) as request_id;
  $$
);