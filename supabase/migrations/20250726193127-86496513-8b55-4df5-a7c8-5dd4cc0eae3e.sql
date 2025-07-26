-- Schedule additional data source syncing jobs

-- Schedule Fear & Greed Index sync every hour
SELECT cron.schedule(
  'fear-greed-index-sync',
  '0 * * * *', -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/external-data-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "sync_source", "sourceId": "dc54fbfe-a23b-4559-b15f-6d15b719a797", "userId": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule whale alert sync every 30 minutes
SELECT cron.schedule(
  'whale-alert-sync',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/external-data-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "sync_source", "sourceId": "b9b7d5e8-4f2a-4c8e-9d1a-2b3c4d5e6f7a", "userId": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule Coinbase institutional flow sync every 2 hours
SELECT cron.schedule(
  'coinbase-institutional-sync',
  '0 */2 * * *', -- Every 2 hours
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/external-data-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "sync_source", "sourceId": "a8b9c0d1-2e3f-4a5b-6c7d-8e9f0a1b2c3d", "userId": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule QuickNode webhook test every 4 hours
SELECT cron.schedule(
  'quicknode-sync',
  '0 */4 * * *', -- Every 4 hours
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/external-data-collector',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"}'::jsonb,
        body:='{"action": "sync_source", "sourceId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f", "userId": "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"}'::jsonb
    ) as request_id;
  $$
);