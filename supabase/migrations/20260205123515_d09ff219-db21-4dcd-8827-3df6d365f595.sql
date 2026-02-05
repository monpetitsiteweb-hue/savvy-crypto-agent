-- Add source column to track wallet provenance (manual vs coinbase)
-- This is metadata only - attribution logic does NOT branch on this value

ALTER TABLE public.user_external_addresses
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Add constraint to enforce allowed values
ALTER TABLE public.user_external_addresses
ADD CONSTRAINT user_external_addresses_source_check 
CHECK (source IN ('manual', 'coinbase'));

COMMENT ON COLUMN public.user_external_addresses.source IS 
'Provenance of the wallet declaration. manual = user-entered, coinbase = discovered via OAuth. Used for UI display and auditability only - NOT for attribution logic branching.';