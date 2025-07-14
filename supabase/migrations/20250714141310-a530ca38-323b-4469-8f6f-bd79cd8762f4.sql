-- Create a function to fetch connection name from Coinbase API
CREATE OR REPLACE FUNCTION public.fetch_coinbase_connection_name(connection_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This function will be called by edge functions to update connection names
  -- For now, return a placeholder that edge functions can update
  RETURN 'Coinbase Account';
END;
$$;