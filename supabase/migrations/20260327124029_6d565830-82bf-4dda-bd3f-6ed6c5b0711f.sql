
-- 1. Create price_data_archive_log table
CREATE TABLE public.price_data_archive_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  archive_date DATE NOT NULL,
  file_path TEXT NOT NULL,
  cutoff_timestamp TIMESTAMPTZ NOT NULL,
  row_count_exported INT NOT NULL DEFAULT 0,
  row_count_deleted INT NOT NULL DEFAULT 0,
  per_symbol_counts JSONB,
  earliest_timestamp TIMESTAMPTZ,
  latest_timestamp TIMESTAMPTZ,
  file_checksum TEXT,
  prune_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable RLS on archive log
ALTER TABLE public.price_data_archive_log ENABLE ROW LEVEL SECURITY;

-- 3. RLS policy: service_role only
CREATE POLICY "service_role_full_access"
ON public.price_data_archive_log
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- 4. Create prune_price_data_batch RPC function
CREATE OR REPLACE FUNCTION public.prune_price_data_batch(
  p_symbol TEXT,
  p_cutoff TIMESTAMPTZ,
  p_batch_size INT DEFAULT 500
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM price_data
  WHERE id IN (
    SELECT id FROM price_data
    WHERE symbol = p_symbol
      AND "timestamp" < p_cutoff
    ORDER BY "timestamp"
    LIMIT p_batch_size
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 5. Create storage bucket for archives
INSERT INTO storage.buckets (id, name, public)
VALUES ('price-data-archives', 'price-data-archives', false)
ON CONFLICT (id) DO NOTHING;
