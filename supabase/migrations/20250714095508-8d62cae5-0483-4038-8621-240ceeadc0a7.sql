-- Add columns for proper Coinbase API credentials
ALTER TABLE public.user_coinbase_connections 
ADD COLUMN api_name_encrypted text,
ADD COLUMN api_identifier_encrypted text,
ADD COLUMN api_private_key_encrypted text;

-- Update the table comment to clarify the new structure
COMMENT ON TABLE public.user_coinbase_connections IS 'Stores user Coinbase connections with OAuth tokens OR API credentials (name, identifier, private key)';
COMMENT ON COLUMN public.user_coinbase_connections.api_name_encrypted IS 'Coinbase API name (e.g., organizations/xxx)';
COMMENT ON COLUMN public.user_coinbase_connections.api_identifier_encrypted IS 'Coinbase API identifier (e.g., 97dc6c2d)';
COMMENT ON COLUMN public.user_coinbase_connections.api_private_key_encrypted IS 'Coinbase API private key (PEM format)';