-- Fix RLS policies to allow users to read price data for technical indicators
-- Market data should be publicly readable since it's the same for everyone

-- Update price_data table policies
DROP POLICY IF EXISTS "Users can view their own price data" ON public.price_data;
CREATE POLICY "Users can view price data for indicators" 
ON public.price_data 
FOR SELECT 
USING (true); -- Allow all authenticated users to read price data

-- Update historical_market_data table policies  
DROP POLICY IF EXISTS "Users can view their own historical market data" ON public.historical_market_data;
CREATE POLICY "Users can view historical market data for indicators" 
ON public.historical_market_data 
FOR SELECT 
USING (true); -- Allow all authenticated users to read historical market data