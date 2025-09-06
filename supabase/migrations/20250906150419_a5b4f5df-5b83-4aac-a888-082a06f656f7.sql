-- Grant permissions for price_data_with_indicators view
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.price_data_with_indicators TO anon, authenticated;

-- Add read policy for price_data (drop existing if present)
DROP POLICY IF EXISTS price_data_read ON public.price_data;
CREATE POLICY price_data_read ON public.price_data
  FOR SELECT TO anon, authenticated
  USING (true);