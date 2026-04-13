
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule Fear & Greed collector every hour at minute 30
SELECT cron.schedule(
  'fear-greed-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/external-data-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{"action": "sync_source", "sourceId": "dc54fbfe-a23b-4559-b15f-6d15b719a797"}'::jsonb
  ) AS request_id;
  $$
);
