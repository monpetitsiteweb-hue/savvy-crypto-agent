-- Create table for Coinbase sandbox API credentials
CREATE TABLE public.coinbase_sandbox_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.coinbase_sandbox_credentials ENABLE ROW LEVEL SECURITY;

-- Create policy for admin access only
CREATE POLICY "Only admins can manage sandbox credentials" 
ON public.coinbase_sandbox_credentials 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_coinbase_sandbox_credentials_updated_at
BEFORE UPDATE ON public.coinbase_sandbox_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();