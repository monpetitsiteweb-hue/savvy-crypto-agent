-- Fix unnecessary SECURITY DEFINER functions
-- Keep SECURITY DEFINER only for functions that truly need elevated permissions

-- Functions that should keep SECURITY DEFINER (for proper RLS and auth):
-- - has_role (needs to check user roles)
-- - handle_new_user (needs to create profiles/roles)  
-- - handle_new_user_role (needs to assign roles)
-- - audit_* functions (need elevated permissions for security auditing)
-- - pg_try_advisory_lock/pg_advisory_unlock (system functions)

-- Remove SECURITY DEFINER from functions that don't need it:

-- Update data source functions - these can rely on RLS
CREATE OR REPLACE FUNCTION public.update_data_sources_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_coinbase_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.last_sync = now();
  RETURN NEW;
END;
$function$;

-- Update price calculation function - can rely on RLS
CREATE OR REPLACE FUNCTION public.calculate_price_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Add price change calculations to metadata
  IF TG_OP = 'INSERT' THEN
    -- Calculate percentage change from open to close
    NEW.metadata = NEW.metadata || jsonb_build_object(
      'price_change_pct', 
      CASE 
        WHEN NEW.open_price > 0 THEN 
          ROUND(((NEW.close_price - NEW.open_price) / NEW.open_price * 100)::numeric, 2)
        ELSE 0 
      END,
      'price_range_pct',
      CASE 
        WHEN NEW.low_price > 0 THEN 
          ROUND(((NEW.high_price - NEW.low_price) / NEW.low_price * 100)::numeric, 2)
        ELSE 0 
      END
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Update cryptocurrency validation - can rely on RLS  
CREATE OR REPLACE FUNCTION public.validate_cryptocurrency_symbol()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  valid_symbols text[] := ARRAY[
    'BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 
    'AAVE', 'CRV', 'COMP', 'SUSHI', 'USDC', 'USDT', 'DAI', 'LTC', 'BCH', 'XLM', 
    'ALGO', 'ATOM', 'ICP', 'FIL',
    -- Add EUR pairs
    'BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'DOT-EUR', 'MATIC-EUR', 
    'AVAX-EUR', 'LINK-EUR', 'UNI-EUR', 'AAVE-EUR', 'CRV-EUR', 'COMP-EUR', 'SUSHI-EUR',
    'USDC-EUR', 'USDT-EUR', 'DAI-EUR', 'LTC-EUR', 'BCH-EUR', 'XLM-EUR', 'ALGO-EUR', 
    'ATOM-EUR', 'ICP-EUR', 'FIL-EUR'
  ];
BEGIN
  -- Check if the cryptocurrency symbol is valid
  IF NEW.cryptocurrency IS NOT NULL AND NOT (NEW.cryptocurrency = ANY(valid_symbols)) THEN
    RAISE EXCEPTION 'Invalid cryptocurrency symbol: %. Valid symbols are: %', NEW.cryptocurrency, array_to_string(valid_symbols, ', ');
  END IF;
  
  RETURN NEW;
END;
$function$;