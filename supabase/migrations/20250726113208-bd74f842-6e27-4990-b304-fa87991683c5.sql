-- Enable cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create scheduler execution log table for tracking
CREATE TABLE public.scheduler_execution_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name TEXT NOT NULL,
  execution_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  response_data JSONB,
  error_message TEXT,
  execution_duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on scheduler execution log
ALTER TABLE public.scheduler_execution_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for scheduler execution log
CREATE POLICY "Admins can view all scheduler logs" 
ON public.scheduler_execution_log 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert scheduler logs" 
ON public.scheduler_execution_log 
FOR INSERT 
WITH CHECK (true);

-- Create a cron job that runs the trading scheduler every 5 minutes
SELECT cron.schedule(
  'automated-trading-pipeline',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/functions/v1/trading-scheduler',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"action": "automated_check"}'::jsonb
    ) as request_id;
  $$
);

-- Also create a market data collection job that runs every minute
SELECT cron.schedule(
  'market-data-collection',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
        url:='https://fuieplftlcxdfkxyqzlt.functions.supabase.co/functions/v1/real-time-market-data',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjIyODc5NCwiZXhwIjoyMDY3ODA0Nzk0fQ.KRbYParYoBFTfa_rYgEw8_NXeZRlDJxOZiM_C_VfgjM"}'::jsonb,
        body:='{"symbols": ["BTC-EUR", "ETH-EUR", "XRP-EUR"], "action": "get_current"}'::jsonb
    ) as request_id;
  $$
);