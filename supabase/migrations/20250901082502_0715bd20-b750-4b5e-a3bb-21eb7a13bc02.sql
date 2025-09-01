-- Fix Security Definer Views by recreating them without SECURITY DEFINER
-- This ensures proper RLS enforcement and user permission checks

-- Drop and recreate past_positions_view without SECURITY DEFINER
DROP VIEW IF EXISTS public.past_positions_view;

CREATE VIEW public.past_positions_view AS
SELECT 
  id as sell_trade_id,
  cryptocurrency as symbol,
  original_purchase_amount as amount,
  original_purchase_price as purchase_price,
  original_purchase_value as purchase_value,
  price as exit_price,
  COALESCE(exit_value, total_value) as exit_value,
  buy_fees,
  sell_fees,
  realized_pnl as pnl,
  realized_pnl_pct as pnl_pct,
  executed_at as exit_at,
  user_id,
  strategy_id
FROM public.mock_trades
WHERE trade_type = 'sell'
  AND original_purchase_value IS NOT NULL;

-- Drop and recreate decision views without SECURITY DEFINER
DROP VIEW IF EXISTS public.v_decision_mix_24h;
DROP VIEW IF EXISTS public.v_decisions_timeseries_24h;
DROP VIEW IF EXISTS public.v_defer_health_15m;
DROP VIEW IF EXISTS public.v_internal_errors_1h;
DROP VIEW IF EXISTS public.v_unexpected_reasons_24h;

-- Recreate decision mix view
CREATE VIEW public.v_decision_mix_24h AS
SELECT 
  decision_action,
  decision_reason,
  COUNT(*) as cnt
FROM public.trade_decisions_log
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY decision_action, decision_reason
ORDER BY cnt DESC;

-- Recreate decisions timeseries view
CREATE VIEW public.v_decisions_timeseries_24h AS
SELECT 
  date_trunc('hour', created_at) as bucket,
  decision_action,
  COUNT(*) as cnt
FROM public.trade_decisions_log
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY bucket, decision_action
ORDER BY bucket, decision_action;

-- Recreate defer health view
CREATE VIEW public.v_defer_health_15m AS
SELECT 
  date_trunc('minute', created_at) as window_start,
  date_trunc('minute', created_at) + INTERVAL '1 minute' as window_end,
  COUNT(*) FILTER (WHERE decision_action = 'defer') as defer_count,
  COUNT(*) as total_count,
  ROUND((COUNT(*) FILTER (WHERE decision_action = 'defer')::numeric / COUNT(*) * 100), 2) as defer_rate_pct
FROM public.trade_decisions_log
WHERE created_at >= NOW() - INTERVAL '15 minutes'
GROUP BY date_trunc('minute', created_at)
ORDER BY window_start;

-- Recreate internal errors view
CREATE VIEW public.v_internal_errors_1h AS
SELECT 
  date_trunc('hour', created_at) as window_start,
  date_trunc('hour', created_at) + INTERVAL '1 hour' as window_end,
  COUNT(*) FILTER (WHERE decision_reason LIKE '%error%' OR decision_reason LIKE '%internal%') as internal_error_count
FROM public.trade_decisions_log
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY date_trunc('hour', created_at)
ORDER BY window_start;

-- Recreate unexpected reasons view  
CREATE VIEW public.v_unexpected_reasons_24h AS
SELECT 
  decision_action,
  decision_reason,
  COUNT(*) as cnt
FROM public.trade_decisions_log
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND decision_reason NOT IN ('technical_analysis', 'ai_signal', 'user_trigger', 'stop_loss', 'take_profit')
GROUP BY decision_action, decision_reason
ORDER BY cnt DESC;