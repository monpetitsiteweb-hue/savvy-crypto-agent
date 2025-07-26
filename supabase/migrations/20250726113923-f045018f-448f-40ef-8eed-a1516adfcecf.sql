-- First, delete the invalid WORT trade
DELETE FROM public.mock_trades WHERE cryptocurrency = 'WORT';

-- Add a validation function to prevent invalid cryptocurrency symbols
CREATE OR REPLACE FUNCTION validate_cryptocurrency_symbol()
RETURNS trigger AS $$
DECLARE
  valid_symbols text[] := ARRAY['BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI', 'AAVE', 'CRV', 'COMP', 'SUSHI', 'USDC', 'USDT', 'DAI', 'LTC', 'BCH', 'XLM', 'ALGO', 'ATOM', 'ICP', 'FIL'];
BEGIN
  -- Check if the cryptocurrency symbol is valid
  IF NEW.cryptocurrency IS NOT NULL AND NOT (NEW.cryptocurrency = ANY(valid_symbols)) THEN
    RAISE EXCEPTION 'Invalid cryptocurrency symbol: %. Valid symbols are: %', NEW.cryptocurrency, array_to_string(valid_symbols, ', ');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Add validation trigger to mock_trades table
CREATE TRIGGER validate_mock_trades_cryptocurrency
  BEFORE INSERT OR UPDATE ON public.mock_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_cryptocurrency_symbol();

-- Add validation trigger to trading_history table
CREATE TRIGGER validate_trading_history_cryptocurrency
  BEFORE INSERT OR UPDATE ON public.trading_history
  FOR EACH ROW
  EXECUTE FUNCTION validate_cryptocurrency_symbol();