-- Create the update_updated_at_column function first
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add OAuth credentials table for admin-level Coinbase app credentials
CREATE TABLE public.coinbase_oauth_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id_encrypted TEXT,
  client_secret_encrypted TEXT,
  app_name TEXT NOT NULL DEFAULT 'Default App',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_sandbox BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.coinbase_oauth_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins can manage OAuth credentials
CREATE POLICY "Only admins can manage OAuth credentials" 
ON public.coinbase_oauth_credentials 
FOR ALL 
USING (has_role(auth.uid(), 'admin'));

-- Update coinbase_connections to use private_key instead of passphrase
ALTER TABLE public.coinbase_connections 
DROP COLUMN IF EXISTS api_passphrase_encrypted;

ALTER TABLE public.coinbase_connections 
ADD COLUMN api_private_key_encrypted TEXT;

-- Add trigger for OAuth credentials timestamps
CREATE TRIGGER update_coinbase_oauth_credentials_updated_at
BEFORE UPDATE ON public.coinbase_oauth_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();