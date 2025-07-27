-- Revert database changes that broke the app
-- Remove RLS policies that might be blocking access to technical indicators

-- First, let's make price_data fully accessible for technical indicators
DROP POLICY IF EXISTS "Users can view price data for indicators" ON public.price_data;
CREATE POLICY "Anyone can view price data for indicators" ON public.price_data FOR SELECT USING (true);

-- Make historical_market_data fully accessible for technical indicators  
DROP POLICY IF EXISTS "Users can view historical market data for indicators" ON public.historical_market_data;
CREATE POLICY "Anyone can view historical market data for indicators" ON public.historical_market_data FOR SELECT USING (true);

-- Ensure live_signals are accessible
DROP POLICY IF EXISTS "Users can view their own live signals" ON public.live_signals;
CREATE POLICY "Anyone can view live signals for indicators" ON public.live_signals FOR SELECT USING (true);

-- Remove any user_id requirements from price data that might be causing issues
-- The technical indicators should work without user authentication
UPDATE public.price_data SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
UPDATE public.historical_market_data SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;