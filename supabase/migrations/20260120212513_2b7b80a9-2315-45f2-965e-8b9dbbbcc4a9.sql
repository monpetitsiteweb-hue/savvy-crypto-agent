-- Create function to get execution wallet balances from snapshots
CREATE OR REPLACE FUNCTION public.get_execution_wallet_balances(p_wallet_address text)
RETURNS TABLE (
  symbol text,
  amount numeric,
  token_address text,
  decimals integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (wbs.symbol)
    wbs.symbol,
    wbs.balance AS amount,
    wbs.token_address,
    wbs.decimals
  FROM wallet_balance_snapshots wbs
  WHERE wbs.wallet_address = p_wallet_address
  ORDER BY wbs.symbol, wbs.observed_at DESC;
$$;