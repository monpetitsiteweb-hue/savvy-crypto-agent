-- PHASE 1.1: Disable deprecated automated-trading-pipeline (job 13)
-- This cron fires every 5 min to a DOUBLE-PATH URL that likely 404s
-- It was deprecated in favor of backend-shadow-engine
SELECT cron.unschedule(13);

-- PHASE 1.2: Remove duplicate market data crons
-- Job 1 (real-time-price-collection): */2, OLD URL format (*.functions.supabase.co)
-- Job 14 (market-data-collection): EVERY MINUTE, DOUBLE PATH URL
-- Both target the same real-time-market-data endpoint
SELECT cron.unschedule(1);
SELECT cron.unschedule(14);

-- PHASE 1.2b: Create single consolidated market data job with correct URL
-- Schedule: every 2 minutes (preserves data freshness from job 1, halves load vs job 14)
SELECT cron.schedule(
  'market-data-unified',
  '*/2 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/real-time-market-data',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"symbols": ["BTC-EUR", "ETH-EUR", "XRP-EUR"]}'::jsonb
    ) as request_id;
  $$
);

-- PHASE 1.3: Fix old URLs on remaining cron jobs
-- Jobs 3, 4, 6, 11, 12 use deprecated *.functions.supabase.co format
-- Replace with correct *.supabase.co/functions/v1/ format

-- Job 3: eodhd-intraday-collection (*/5)
SELECT cron.unschedule(3);
SELECT cron.schedule(
  'eodhd-intraday-collection',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/eodhd-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_intraday_data", "schedule_type": "intraday"}'::jsonb
    ) as request_id;
  $$
);

-- Job 4: eodhd-daily-collection (0 18 * * *)
SELECT cron.unschedule(4);
SELECT cron.schedule(
  'eodhd-daily-collection',
  '0 18 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/eodhd-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_historical_data", "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);

-- Job 6: knowledge-daily-aggregation (0 1 * * *)
SELECT cron.unschedule(6);
SELECT cron.schedule(
  'knowledge-daily-aggregation',
  '0 1 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/knowledge-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "aggregate_daily_insights", "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);

-- Job 11: bigquery-weekly-collection (0 2 * * 0)
SELECT cron.unschedule(11);
SELECT cron.schedule(
  'bigquery-weekly-collection',
  '0 2 * * 0',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/bigquery-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "fetch_historical_data", "symbols": ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"], "startDate": "2024-01-01", "endDate": "2025-07-24", "schedule_type": "weekly"}'::jsonb
    ) as request_id;
  $$
);

-- Job 12: bigquery-daily-sync (0 6 * * *)
SELECT cron.unschedule(12);
SELECT cron.schedule(
  'bigquery-daily-sync',
  '0 6 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/bigquery-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "sync_daily_data", "symbols": ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"], "schedule_type": "daily"}'::jsonb
    ) as request_id;
  $$
);