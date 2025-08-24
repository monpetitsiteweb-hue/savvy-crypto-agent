-- Enable pgcrypto extension for hash functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create trade decisions audit log table
CREATE TABLE IF NOT EXISTS public.trade_decisions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  intent_side TEXT NOT NULL,         -- BUY | SELL
  intent_source TEXT NOT NULL,       -- automated|intelligent|pool|manual|news|whale
  confidence NUMERIC(10,6) NOT NULL,
  decision_action TEXT NOT NULL,     -- BUY|SELL|HOLD
  decision_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.trade_decisions_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "select_own_trade_decisions_log"
  ON public.trade_decisions_log
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "insert_own_trade_decisions_log"
  ON public.trade_decisions_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Create performance index
CREATE INDEX IF NOT EXISTS idx_decisions_log_lookup
  ON public.trade_decisions_log (user_id, strategy_id, symbol, created_at DESC);

-- Add unified trading config to trading_strategies table
ALTER TABLE public.trading_strategies 
ADD COLUMN IF NOT EXISTS unified_config JSONB DEFAULT '{
  "enableUnifiedDecisions": false,
  "minHoldPeriodMs": 120000,
  "cooldownBetweenOppositeActionsMs": 30000,
  "confidenceOverrideThreshold": 0.70
}'::JSONB;