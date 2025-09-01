-- Remove SECURITY DEFINER from remaining functions that don't need it
-- Keep only critical auth/admin functions with SECURITY DEFINER

-- Remove SECURITY DEFINER from connection functions that can rely on RLS
CREATE OR REPLACE FUNCTION public.get_user_connection_status(connection_id uuid)
RETURNS TABLE(id uuid, is_active boolean, connected_at timestamp with time zone, last_sync timestamp with time zone, expires_at timestamp with time zone, connection_type text, has_credentials boolean)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
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
$function$;

-- Remove SECURITY DEFINER from admin connection function
CREATE OR REPLACE FUNCTION public.admin_get_connection_name(connection_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  decrypted_name text;
BEGIN  
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
$function$;

-- Remove SECURITY DEFINER from log connection access (can rely on RLS)
CREATE OR REPLACE FUNCTION public.log_connection_access(connection_id uuid, access_type text DEFAULT 'VIEW'::text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
$function$;

-- Remove SECURITY DEFINER from strategy performance update (can rely on RLS)
CREATE OR REPLACE FUNCTION public.update_strategy_performance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- This will be called when mock trades are inserted/updated
  -- to automatically update strategy performance metrics
  INSERT INTO public.strategy_performance (
    strategy_id,
    user_id,
    execution_date,
    total_trades,
    winning_trades,
    losing_trades,
    total_profit_loss,
    total_fees,
    win_rate,
    is_test_mode
  )
  SELECT 
    NEW.strategy_id,
    NEW.user_id,
    CURRENT_DATE,
    COUNT(*),
    COUNT(*) FILTER (WHERE profit_loss > 0),
    COUNT(*) FILTER (WHERE profit_loss < 0),
    SUM(profit_loss),
    SUM(fees),
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE profit_loss > 0))::NUMERIC / COUNT(*) * 100, 2)
      ELSE 0 
    END,
    NEW.is_test_mode
  FROM public.mock_trades 
  WHERE strategy_id = NEW.strategy_id 
    AND user_id = NEW.user_id
    AND DATE(executed_at) = CURRENT_DATE
  ON CONFLICT (strategy_id, execution_date) 
  DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    winning_trades = EXCLUDED.winning_trades,
    losing_trades = EXCLUDED.losing_trades,
    total_profit_loss = EXCLUDED.total_profit_loss,
    total_fees = EXCLUDED.total_fees,
    win_rate = EXCLUDED.win_rate,
    updated_at = now();
    
  RETURN NEW;
END;
$function$;