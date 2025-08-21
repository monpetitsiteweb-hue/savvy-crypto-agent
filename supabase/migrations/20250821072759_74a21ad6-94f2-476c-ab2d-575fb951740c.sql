-- Fix the final remaining SECURITY DEFINER functions with empty search paths

-- Fix update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix update_user_coinbase_connections_updated_at
CREATE OR REPLACE FUNCTION public.update_user_coinbase_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
  NEW.last_sync = now();
  RETURN NEW;
END;
$function$;

-- Fix validate_cryptocurrency_symbol
CREATE OR REPLACE FUNCTION public.validate_cryptocurrency_symbol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
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