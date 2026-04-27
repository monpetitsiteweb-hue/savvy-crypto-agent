DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Take ownership / drop existing job 27 if accessible
  PERFORM cron.unschedule(27);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not unschedule 27: %', SQLERRM;
END $$;

SELECT cron.schedule(
  'backend-shadow-engine-loop',
  '*/5 * * * *',
  $cmd$
  SELECT net.http_post(
      url:='https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/backend-shadow-engine',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
      body:='{"trigger": "cron_5min", "allUsers": true}'::jsonb
  ) as request_id;
  $cmd$
);