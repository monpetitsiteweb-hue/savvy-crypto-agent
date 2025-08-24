-- Security Fix: Protect encrypted API keys in user_coinbase_connections
-- Issue: Users can SELECT their encrypted credentials, which poses security risks

-- Step 1: Create a secure view for users that excludes sensitive encrypted fields
CREATE OR REPLACE VIEW public.user_connections_safe AS
SELECT 
  id,
  user_id,
  connected_at,
  last_sync,
  is_active,
  expires_at,
  coinbase_user_id,
  -- Exclude all encrypted fields:
  -- access_token_encrypted, refresh_token_encrypted, 
  -- api_name_encrypted, api_identifier_encrypted, api_private_key_encrypted
  
  -- Add a computed field to show if connection has credentials
  CASE 
    WHEN access_token_encrypted IS NOT NULL OR api_private_key_encrypted IS NOT NULL 
    THEN true 
    ELSE false 
  END as has_credentials,
  
  -- Add a display name that's safe to show
  CASE 
    WHEN api_name_encrypted IS NOT NULL 
    THEN 'Coinbase Connection'
    ELSE 'OAuth Connection'
  END as connection_type

FROM public.user_coinbase_connections;

-- Step 2: Create a security definer function for safe connection operations
CREATE OR REPLACE FUNCTION public.get_user_connection_status(connection_id uuid)
RETURNS TABLE(
  id uuid,
  is_active boolean,
  connected_at timestamp with time zone,
  last_sync timestamp with time zone,
  expires_at timestamp with time zone,
  connection_type text,
  has_credentials boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.is_active,
    c.connected_at,
    c.last_sync,
    c.expires_at,
    CASE 
      WHEN c.api_name_encrypted IS NOT NULL 
      THEN 'API Key Connection'
      ELSE 'OAuth Connection'
    END as connection_type,
    CASE 
      WHEN c.access_token_encrypted IS NOT NULL OR c.api_private_key_encrypted IS NOT NULL 
      THEN true 
      ELSE false 
    END as has_credentials
  FROM public.user_coinbase_connections c
  WHERE c.id = connection_id 
    AND c.user_id = auth.uid();
$$;

-- Step 3: Create a function for admins to safely access encrypted connection names
CREATE OR REPLACE FUNCTION public.admin_get_connection_name(connection_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  decrypted_name text;
BEGIN
  -- Only admins can call this function
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Return a safe display name without decrypting
  SELECT 
    CASE 
      WHEN api_name_encrypted IS NOT NULL 
      THEN 'Coinbase API Connection'
      ELSE 'Coinbase OAuth Connection'
    END
  INTO decrypted_name
  FROM public.user_coinbase_connections
  WHERE id = connection_id;
  
  RETURN COALESCE(decrypted_name, 'Unknown Connection');
END;
$$;

-- Step 4: Drop ALL existing policies on user_coinbase_connections
DROP POLICY IF EXISTS "Admins can view all connections" ON public.user_coinbase_connections;
DROP POLICY IF EXISTS "Users can view their own connections" ON public.user_coinbase_connections;
DROP POLICY IF EXISTS "Users can insert their own connections" ON public.user_coinbase_connections;
DROP POLICY IF EXISTS "Users can update their own connections" ON public.user_coinbase_connections;
DROP POLICY IF EXISTS "Users can delete their own connections" ON public.user_coinbase_connections;

-- Step 5: Create new secure restrictive policies
-- Block direct SELECT access for regular users
CREATE POLICY "Users cannot directly SELECT encrypted credentials"
ON public.user_coinbase_connections
FOR SELECT
TO authenticated
USING (false); -- Block all direct SELECT access for regular users

-- Admins retain full SELECT access
CREATE POLICY "Admins have full SELECT access to connections"
ON public.user_coinbase_connections
FOR SELECT 
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can still INSERT/UPDATE/DELETE their own connections
CREATE POLICY "Users can insert own connections securely"
ON public.user_coinbase_connections
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own connections securely"
ON public.user_coinbase_connections
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own connections securely"
ON public.user_coinbase_connections
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Step 6: Grant appropriate permissions
GRANT SELECT ON public.user_connections_safe TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_connection_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_connection_name(uuid) TO authenticated;

-- Step 7: Add security audit logging function for manual use
CREATE OR REPLACE FUNCTION public.log_connection_access(
  connection_id uuid, 
  access_type text DEFAULT 'VIEW'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log sensitive credential access attempts
  INSERT INTO public.security_audit_log (
    user_id, 
    action_type, 
    table_name, 
    record_id,
    metadata
  ) VALUES (
    auth.uid(), 
    'ENCRYPTED_CREDENTIALS_ACCESS', 
    'user_coinbase_connections',
    connection_id,
    jsonb_build_object(
      'access_type', access_type,
      'timestamp', now(),
      'user_role', (SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1)
    )
  );
END;
$$;