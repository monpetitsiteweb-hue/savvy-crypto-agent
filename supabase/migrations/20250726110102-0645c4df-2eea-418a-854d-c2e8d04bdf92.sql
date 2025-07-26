-- Create a security definer function to get OAuth credentials
-- This allows edge functions to read OAuth credentials without admin privileges
CREATE OR REPLACE FUNCTION public.get_active_oauth_credentials()
RETURNS TABLE(client_id_encrypted text, is_sandbox boolean)
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT client_id_encrypted, is_sandbox 
  FROM public.coinbase_oauth_credentials 
  WHERE is_active = true 
  LIMIT 1;
$$;