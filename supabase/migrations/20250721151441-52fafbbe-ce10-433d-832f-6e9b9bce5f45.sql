-- Add INSERT policy for external_market_data so edge functions can write data
CREATE POLICY "System can insert external market data" 
ON public.external_market_data 
FOR INSERT 
WITH CHECK (true);