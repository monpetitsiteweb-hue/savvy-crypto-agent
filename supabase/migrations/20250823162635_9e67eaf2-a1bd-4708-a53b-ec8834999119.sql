-- Create advisory lock wrapper functions for the coordinator
CREATE OR REPLACE FUNCTION public.pg_try_advisory_lock(key BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_try_advisory_lock(key);
$$;

CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(key BIGINT)
RETURNS BOOLEAN  
LANGUAGE SQL
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_advisory_unlock(key);
$$;