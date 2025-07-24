-- Enable pg_cron extension for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule automated price data collection every 2 minutes
SELECT cron.schedule(
  'real-time-price-collection',
  '*/2 * * * *', -- Every 2 minutes
  $$
  SELECT
    net.http_get(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/real-time-market-data',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule crypto news collection every 3 minutes  
SELECT cron.schedule(
  'crypto-news-collection',
  '*/3 * * * *', -- Every 3 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/crypto-news-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_latest_news", "schedule_type": "intraday"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule EODHD intraday data collection every 5 minutes
SELECT cron.schedule(
  'eodhd-intraday-collection',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/eodhd-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_intraday_data", "schedule_type": "intraday"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule daily EODHD historical data collection at 6 PM UTC (after markets close)
SELECT cron.schedule(
  'eodhd-daily-collection',
  '0 18 * * *', -- Daily at 6 PM UTC
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/eodhd-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_historical_data", "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule weekly BigQuery data collection on Sundays at 2 AM UTC
SELECT cron.schedule(
  'bigquery-weekly-collection',
  '0 2 * * 0', -- Weekly on Sunday at 2 AM UTC
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/bigquery-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "sync_weekly_data", "schedule_type": "weekly"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule daily knowledge aggregation at 1 AM UTC
SELECT cron.schedule(
  'knowledge-daily-aggregation',
  '0 1 * * *', -- Daily at 1 AM UTC
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/knowledge-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "aggregate_daily_insights", "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);

-- View all scheduled jobs
SELECT * FROM cron.job;