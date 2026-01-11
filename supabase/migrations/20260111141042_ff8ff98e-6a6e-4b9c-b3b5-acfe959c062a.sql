-- 1) Fix onboarding step constraint to allow app's 'active' state
ALTER TABLE public.user_onboarding_status
  DROP CONSTRAINT IF EXISTS user_onboarding_status_current_step_check;

ALTER TABLE public.user_onboarding_status
  ADD CONSTRAINT user_onboarding_status_current_step_check
  CHECK (
    current_step = ANY (
      ARRAY[
        'welcome'::text,
        'active'::text,
        'coinbase_connect'::text,
        'capital_allocation'::text,
        'wallet_creation'::text,
        'funding'::text,
        'rules_confirmation'::text,
        'complete'::text
      ]
    )
  );

-- 2) Canonical, non-leaky Coinbase connection status RPC
-- Returns TRUE only when the user has an ACTIVE connection AND it is NOT expired.
-- (Per requirements: is_active = true AND expires_at > now())
CREATE OR REPLACE FUNCTION public.get_coinbase_connection_status()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_valid boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_coinbase_connections c
    WHERE c.user_id = auth.uid()
      AND c.is_active = true
      AND c.expires_at IS NOT NULL
      AND c.expires_at > now()
  )
  INTO v_has_valid;

  RETURN COALESCE(v_has_valid, false);
END;
$$;

-- Lock down function execution to authenticated users only
REVOKE ALL ON FUNCTION public.get_coinbase_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coinbase_connection_status() TO authenticated;