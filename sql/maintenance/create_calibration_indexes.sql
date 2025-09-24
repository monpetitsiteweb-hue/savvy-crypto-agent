-- Run each statement standalone (NOT inside a transaction).

-- Drop the old name (if any), non-blocking if it exists
DROP INDEX IF EXISTS idx_decision_events_ts_sym;

-- Recreate with correct column order; must be CONCURRENTLY and outside txn
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decision_events_sym_ts
  ON public.decision_events (symbol, decision_ts);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decision_outcomes_horizon
  ON public.decision_outcomes (horizon);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decision_outcomes_decision_id
  ON public.decision_outcomes (decision_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decision_events_strategy
  ON public.decision_events (strategy_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decision_outcomes_user
  ON public.decision_outcomes (user_id);

-- Update stats (fine to run outside a transaction as separate statements)
ANALYZE public.decision_events;
ANALYZE public.decision_outcomes;