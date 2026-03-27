
-- ============================================================
-- Cron jobs: market-data ingestion (10 symbols) + lifecycle
-- Uses vault.decrypted_secrets for secure credential lookup
-- ============================================================

-- 1. Remove existing market-data cron job if present
SELECT cron.unschedule('market-data-unified')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'market-data-unified'
);

-- 2. Schedule market data ingestion every 2 minutes, 10 EUR symbols
SELECT cron.schedule(
  'market-data-unified',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/real-time-market-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{"action":"get_current","symbols":["BTC-EUR","ETH-EUR","XRP-EUR","SOL-EUR","AVAX-EUR","LTC-EUR","ADA-EUR","DOT-EUR","LINK-EUR","BCH-EUR"]}'::jsonb
  ) AS request_id;
  $$
);

-- 3. Schedule price-data-lifecycle daily at 03:00 UTC
SELECT cron.schedule(
  'price-data-lifecycle-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/price-data-lifecycle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{"action":"run_lifecycle"}'::jsonb
  ) AS request_id;
  $$
);
