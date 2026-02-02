-- =============================================================================
-- SYSTEM EXECUTION IDENTITY INVARIANT
-- One-time data fix + NOT NULL constraint
-- =============================================================================

-- 1) BACKFILL: Set SYSTEM_USER_ID for the 7 NULL rows in real_trades
UPDATE real_trades
SET user_id = '00000000-0000-0000-0000-000000000001'
WHERE is_system_operator = true
  AND user_id IS NULL;

-- 2) CONSTRAINT: Enforce user_id is NEVER NULL
ALTER TABLE real_trades ALTER COLUMN user_id SET NOT NULL;

-- 3) RLS FIX: Drop permissive policy, add admin-only read for system trades
DROP POLICY IF EXISTS "Allow read system operator trades" ON real_trades;

CREATE POLICY "Admins can read system operator trades"
ON real_trades FOR SELECT
USING (
  is_system_operator = true 
  AND has_role(auth.uid(), 'admin'::app_role)
);