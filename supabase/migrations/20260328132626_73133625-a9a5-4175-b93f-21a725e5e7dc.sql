-- pg_cron: 5m OHLCV live ingest (every 5 minutes)
SELECT cron.schedule(
  'ohlcv-live-ingest-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/ohlcv-live-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{"symbols":["BTC-EUR","ETH-EUR","XRP-EUR","ADA-EUR","SOL-EUR","AVAX-EUR","DOT-EUR","LINK-EUR","LTC-EUR","BCH-EUR"],"granularities":["5m"]}'::jsonb
  );
  $$
);

-- pg_cron: 5m features refresh (every 5 minutes, offset by 1 minute)
SELECT cron.schedule(
  'features-refresh-5m',
  '1-59/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/features-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{"symbols":["BTC-EUR","ETH-EUR","XRP-EUR","ADA-EUR","SOL-EUR","AVAX-EUR","DOT-EUR","LINK-EUR","LTC-EUR","BCH-EUR"],"granularities":["5m"],"lookback_days":8}'::jsonb
  );
  $$
);