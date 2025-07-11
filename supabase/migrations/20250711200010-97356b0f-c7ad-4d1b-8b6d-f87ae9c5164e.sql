-- Add passphrase field to coinbase_connections table
ALTER TABLE public.coinbase_connections
ADD COLUMN api_passphrase_encrypted text;