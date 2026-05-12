DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onchain-receipts-poller-5min') THEN
    PERFORM cron.unschedule('onchain-receipts-poller-5min');
  END IF;
END $$;

SELECT cron.schedule(
  'onchain-receipts-poller-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/onchain-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{"scheduled": true, "trigger": "cron_5min"}'::jsonb
  );
  $$
);