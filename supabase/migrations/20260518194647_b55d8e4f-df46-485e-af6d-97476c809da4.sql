DO $$
DECLARE
  v_req_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/reconcile-portfolio-capital',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'manual_smoke_test')
  ) INTO v_req_id;
  RAISE NOTICE 'reconcile smoke test dispatched, request_id=%', v_req_id;
END $$;