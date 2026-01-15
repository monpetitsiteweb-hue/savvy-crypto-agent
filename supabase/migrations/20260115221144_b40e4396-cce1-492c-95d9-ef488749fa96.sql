-- Create withdrawal audit log table
CREATE TABLE IF NOT EXISTS public.withdrawal_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_id UUID NOT NULL REFERENCES public.execution_wallets(id),
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  to_address TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.withdrawal_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own withdrawal history
CREATE POLICY "Users can view own withdrawals"
  ON public.withdrawal_audit_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert (edge function)
CREATE POLICY "Service role can insert withdrawals"
  ON public.withdrawal_audit_log
  FOR INSERT
  WITH CHECK (true);

-- Create index for rate limiting queries
CREATE INDEX idx_withdrawal_audit_user_created 
  ON public.withdrawal_audit_log(user_id, created_at DESC);