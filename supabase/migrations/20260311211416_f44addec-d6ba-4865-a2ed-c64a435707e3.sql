
-- PHASE 1: Signal health + Decision Snapshots (no dedup index yet)

-- Signal ingestion health tracking
CREATE TABLE IF NOT EXISTS public.signal_source_health (
  source TEXT NOT NULL,
  expected_interval_seconds INT NOT NULL DEFAULT 3600,
  last_signal_at TIMESTAMPTZ,
  signal_count_24h INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source)
);

ALTER TABLE public.signal_source_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on signal_source_health"
  ON public.signal_source_health FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read signal_source_health"
  ON public.signal_source_health FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.signal_source_health (source, expected_interval_seconds, status) VALUES
  ('technical_analysis', 300, 'unknown'),
  ('crypto_news', 3600, 'unknown'),
  ('fear_greed_index', 3600, 'unknown'),
  ('whale_alert_ws', 3600, 'unknown'),
  ('whale_alert_api', 1800, 'unknown'),
  ('whale_alert_tracked', 86400, 'unknown'),
  ('eodhd', 300, 'unknown')
ON CONFLICT (source) DO NOTHING;

-- Decision Snapshots (append-only, schema-versioned)
CREATE TABLE IF NOT EXISTS public.decision_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  decision_id UUID REFERENCES public.decision_events(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
  fusion_score NUMERIC,
  signal_breakdown_json JSONB,
  guard_states_json JSONB,
  strategy_config_snapshot_json JSONB,
  market_context_json JSONB,
  decision_result TEXT NOT NULL,
  decision_reason TEXT,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_snapshots_symbol_ts
  ON public.decision_snapshots (symbol, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_decision_snapshots_decision_id
  ON public.decision_snapshots (decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_snapshots_user_strategy
  ON public.decision_snapshots (user_id, strategy_id, timestamp_utc DESC);

ALTER TABLE public.decision_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on decision_snapshots"
  ON public.decision_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can read own decision_snapshots"
  ON public.decision_snapshots FOR SELECT TO authenticated
  USING (user_id = auth.uid());
