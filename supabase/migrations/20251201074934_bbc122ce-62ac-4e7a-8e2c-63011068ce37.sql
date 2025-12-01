-- Fix live_signals RLS: existing SELECT policy is RESTRICTIVE which blocks all access
-- Drop the restrictive policy and recreate as PERMISSIVE

-- Drop existing restrictive SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view live signals" ON public.live_signals;

-- Create PERMISSIVE SELECT policy for authenticated users (dev/test mode)
-- This allows all authenticated users to read live_signals for intelligent engine
CREATE POLICY "live_signals_read_authenticated_dev"
ON public.live_signals
FOR SELECT
TO authenticated
USING (true);

-- Also allow anon to read live_signals (in case client uses anon before auth)
CREATE POLICY "live_signals_read_anon_dev"
ON public.live_signals
FOR SELECT
TO anon
USING (true);

-- Note: These are dev/test policies. Tighten by adding user_id checks for production.