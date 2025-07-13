-- Drop the old API key based tables
DROP TABLE IF EXISTS public.coinbase_connections;
DROP TABLE IF EXISTS public.api_connections;

-- Keep only the OAuth credentials table for admin
-- coinbase_oauth_credentials table already exists and is perfect

-- Create a simple user connections table for OAuth tokens
CREATE TABLE public.user_coinbase_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_sync TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  coinbase_user_id TEXT,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.user_coinbase_connections ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own connections" 
ON public.user_coinbase_connections 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own connections" 
ON public.user_coinbase_connections 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own connections" 
ON public.user_coinbase_connections 
FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own connections" 
ON public.user_coinbase_connections 
FOR DELETE 
USING (user_id = auth.uid());

-- Admin can view all connections
CREATE POLICY "Admins can view all connections" 
ON public.user_coinbase_connections 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_user_coinbase_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_sync = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_coinbase_connections_updated_at
BEFORE UPDATE ON public.user_coinbase_connections
FOR EACH ROW
EXECUTE FUNCTION public.update_user_coinbase_connections_updated_at();