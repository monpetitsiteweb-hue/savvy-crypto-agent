-- Remove api_secret_encrypted column from coinbase_connections as it's not needed
ALTER TABLE public.coinbase_connections 
DROP COLUMN IF EXISTS api_secret_encrypted;