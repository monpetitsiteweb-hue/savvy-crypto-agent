-- Create dedicated execution locks table for atomic operations
-- Replaces advisory locks which don't work with connection pooling

CREATE TABLE public.execution_locks (
  lock_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  request_id TEXT,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 seconds')
);

-- Index for expiry cleanup
CREATE INDEX idx_execution_locks_expires_at ON public.execution_locks(expires_at);

-- Enable RLS
ALTER TABLE public.execution_locks ENABLE ROW LEVEL SECURITY;

-- Service role can manage all locks
CREATE POLICY "Service role manages execution locks" ON public.execution_locks
  FOR ALL USING (true) WITH CHECK (true);

-- Function to acquire lock (returns true if acquired, false if busy)
CREATE OR REPLACE FUNCTION public.acquire_execution_lock(
  p_lock_key TEXT,
  p_user_id UUID,
  p_strategy_id UUID,
  p_symbol TEXT,
  p_request_id TEXT DEFAULT NULL,
  p_ttl_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acquired BOOLEAN := FALSE;
BEGIN
  -- First, clean up any expired locks for this key
  DELETE FROM public.execution_locks 
  WHERE lock_key = p_lock_key AND expires_at < now();
  
  -- Try to insert new lock
  INSERT INTO public.execution_locks (lock_key, user_id, strategy_id, symbol, request_id, expires_at)
  VALUES (p_lock_key, p_user_id, p_strategy_id, p_symbol, p_request_id, now() + (p_ttl_seconds || ' seconds')::interval)
  ON CONFLICT (lock_key) DO NOTHING;
  
  -- Check if we got it
  IF FOUND THEN
    v_acquired := TRUE;
  END IF;
  
  RETURN v_acquired;
END;
$$;

-- Function to release lock
CREATE OR REPLACE FUNCTION public.release_execution_lock(
  p_lock_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.execution_locks WHERE lock_key = p_lock_key;
  RETURN FOUND;
END;
$$;

-- Grant execute to authenticated users (service role will use these)
GRANT EXECUTE ON FUNCTION public.acquire_execution_lock TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_execution_lock TO authenticated;

-- Comment
COMMENT ON TABLE public.execution_locks IS 'Row-based locking for coordinator atomic sections. Replaces broken advisory locks with connection pooling.';
