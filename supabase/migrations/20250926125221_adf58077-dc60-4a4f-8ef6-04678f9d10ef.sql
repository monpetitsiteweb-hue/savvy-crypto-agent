-- Create execution quality log table
CREATE TABLE IF NOT EXISTS public.execution_quality_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  strategy_id uuid NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  slippage_bps numeric NOT NULL DEFAULT 0,
  execution_latency_ms integer NOT NULL DEFAULT 0,
  partial_fill boolean NOT NULL DEFAULT false,
  requested_amount numeric NOT NULL,
  filled_amount numeric NOT NULL,
  requested_price numeric,
  executed_price numeric NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create execution circuit breakers table
CREATE TABLE IF NOT EXISTS public.execution_circuit_breakers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  strategy_id uuid NOT NULL,
  symbol text NOT NULL,
  breaker_type text NOT NULL CHECK (breaker_type IN ('slippage', 'latency', 'partial_fill', 'volume')),
  threshold_value numeric NOT NULL,
  current_value numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamp with time zone,
  last_reset_at timestamp with time zone,
  trip_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add RLS policies
ALTER TABLE public.execution_quality_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_circuit_breakers ENABLE ROW LEVEL SECURITY;

-- RLS policies for execution_quality_log
CREATE POLICY "Users can view their own execution logs"
ON public.execution_quality_log FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "System can insert execution logs"
ON public.execution_quality_log FOR INSERT
WITH CHECK (true);

-- RLS policies for execution_circuit_breakers
CREATE POLICY "Users can view their own circuit breakers"
ON public.execution_circuit_breakers FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own circuit breakers"
ON public.execution_circuit_breakers FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_execution_quality_log_user_strategy ON public.execution_quality_log(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_execution_quality_log_executed_at ON public.execution_quality_log(executed_at);
CREATE INDEX IF NOT EXISTS idx_execution_circuit_breakers_user_strategy ON public.execution_circuit_breakers(user_id, strategy_id);

-- 24h execution metrics view
CREATE OR REPLACE VIEW public.execution_quality_metrics_24h AS
SELECT
  user_id,
  strategy_id,
  symbol,
  COUNT(*) AS trade_count,
  AVG(ABS(slippage_bps))::numeric AS avg_abs_slippage_bps,
  PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY execution_latency_ms) AS latency_p95_ms,
  AVG(CASE WHEN partial_fill THEN 1 ELSE 0 END)::numeric * 100 AS partial_fill_rate_pct
FROM public.execution_quality_log
WHERE executed_at >= NOW() - INTERVAL '24 hours'
GROUP BY user_id, strategy_id, symbol;

-- Breaker reset RPC
CREATE OR REPLACE FUNCTION public.reset_breaker(
  p_user uuid,
  p_strategy uuid,
  p_symbol text,
  p_type text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public AS $$
  UPDATE public.execution_circuit_breakers
  SET is_active = false,
      last_reset_at = now()
  WHERE user_id = p_user
    AND strategy_id = p_strategy
    AND symbol = p_symbol
    AND breaker_type = p_type;
$$;

GRANT EXECUTE ON FUNCTION public.reset_breaker(uuid,uuid,text,text) TO service_role;