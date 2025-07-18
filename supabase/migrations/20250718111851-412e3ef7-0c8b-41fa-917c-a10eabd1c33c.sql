-- Add fee configuration to user profiles
ALTER TABLE public.profiles 
ADD COLUMN fee_rate DECIMAL(5,4) DEFAULT 0.0000;

-- Add comment explaining the fee rate column
COMMENT ON COLUMN public.profiles.fee_rate IS 'User trading fee rate as decimal (0.0000 = 0%, 0.005 = 0.5%, 0.015 = 1.5%)';

-- Update existing users to have 0% fees (Coinbase Pro default for this user)
UPDATE public.profiles SET fee_rate = 0.0000 WHERE fee_rate IS NULL;