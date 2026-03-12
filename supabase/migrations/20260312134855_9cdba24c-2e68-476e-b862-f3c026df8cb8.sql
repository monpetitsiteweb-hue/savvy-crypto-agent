-- Remove both existing crypto news cron jobs
SELECT cron.unschedule('crypto-news-collection');
SELECT cron.unschedule('crypto-news-collector');

-- Reschedule at every 2 minutes (~21,600 calls/month, within 30K quota)
SELECT cron.schedule(
  'crypto-news-collector',
  '*/2 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/crypto-news-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "fetch_latest_news", "symbols": ["BTC", "ETH", "SOL", "XRP"], "hours": 24}'::jsonb
    ) as request_id;
  $$
);