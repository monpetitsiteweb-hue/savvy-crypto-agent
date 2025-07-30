-- Fix cryptocurrency symbol validation to accept EUR pairs
DROP TRIGGER IF EXISTS validate_cryptocurrency_symbol_trigger ON mock_trades;
DROP TRIGGER IF EXISTS validate_cryptocurrency_symbol_trigger ON trading_history;

-- Update the validation function to accept EUR pairs
CREATE OR REPLACE FUNCTION public.validate_cryptocurrency_symbol()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

-- Re-create triggers with the updated function
CREATE TRIGGER validate_cryptocurrency_symbol_trigger
  BEFORE INSERT OR UPDATE ON mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_cryptocurrency_symbol();

CREATE TRIGGER validate_cryptocurrency_symbol_trigger_history
  BEFORE INSERT OR UPDATE ON trading_history
  FOR EACH ROW
  EXECUTE FUNCTION validate_cryptocurrency_symbol();