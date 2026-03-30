
-- Unschedule redundant/auxiliary jobs by ID
SELECT cron.unschedule(29);  -- eodhd-intraday-collection (redundant with GitHub Action)
SELECT cron.unschedule(21);  -- bigquery-signal-generation (not in decision pipeline)
SELECT cron.unschedule(31);  -- knowledge-daily-aggregation (auxiliary)
SELECT cron.unschedule(32);  -- bigquery-weekly-collection (auxiliary)
SELECT cron.unschedule(33);  -- bigquery-daily-sync (auxiliary)

-- Reduce crypto-news-collector frequency from */2 to */15
SELECT cron.alter_job(
  job_id := 26,
  schedule := '*/15 * * * *'
);
