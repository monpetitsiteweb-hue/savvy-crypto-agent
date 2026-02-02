-- Add RLS policy to allow all authenticated users to read system operator trades
-- This is additive - does NOT replace existing user policy
CREATE POLICY "Allow read system operator trades"
ON public.real_trades
FOR SELECT
USING (is_system_operator = TRUE);