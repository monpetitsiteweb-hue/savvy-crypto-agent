-- Fix cron job parameters to match what each function expects

-- 1. Update crypto-news-collector cron with proper symbols
SELECT cron.unschedule('crypto-news-collection');
SELECT cron.schedule(
  'crypto-news-collection',
  '*/3 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/crypto-news-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_latest_news", "symbols": ["BTC", "ETH", "SOL", "XRP"], "hours": 24, "schedule_type": "intraday"}'::jsonb
    ) as request_id;
  $$
);

-- 2. Update bigquery-collector cron with proper date ranges
SELECT cron.unschedule('bigquery-weekly-collection');
SELECT cron.schedule(
  'bigquery-weekly-collection',
  '0 2 * * 0',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/bigquery-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_historical_data", "symbols": ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"], "startDate": "2024-01-01", "endDate": "2025-07-24", "schedule_type": "weekly"}'::jsonb
    ) as request_id;
  $$
);

-- 3. Add daily BigQuery sync for recent data
SELECT cron.schedule(
  'bigquery-daily-sync',
  '0 6 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/bigquery-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "sync_daily_data", "symbols": ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"], "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);

-- 4. Add Whale Alert data source configuration (without conflict clause since no unique constraint exists)
INSERT INTO ai_data_sources (
  source_name,
  source_type,
  user_id,
  webhook_url,
  threshold_amount,
  configuration,
  is_active,
  category_id
) VALUES (
  'whale_alert',
  'webhook',
  (SELECT id FROM profiles LIMIT 1),
  'https://fuieplftlcxdfkxyqzlt.functions.supabase.co/whale-alert-webhook',
  50000,
  '{"api_key": "demo_key", "min_amount_usd": 50000, "blockchain_filter": ["ethereum", "bitcoin"]}'::jsonb,
  true,
  NULL
);