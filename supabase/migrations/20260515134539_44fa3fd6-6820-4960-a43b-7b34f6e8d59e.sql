CREATE TABLE public.dust_pool (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_buy_id                   uuid        NOT NULL,
  user_id                         uuid        NOT NULL,
  strategy_id                     uuid        NOT NULL,
  cryptocurrency                  text        NOT NULL,
  dust_amount                     numeric     NOT NULL CHECK (dust_amount > 0),
  dust_value_eur_at_recognition   numeric     NOT NULL,
  recognized_at                   timestamptz NOT NULL DEFAULT now(),
  parent_tx_hash                  text,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dust_pool_parent_fk
    FOREIGN KEY (parent_buy_id) REFERENCES public.mock_trades(id)
    ON DELETE RESTRICT,
  CONSTRAINT dust_pool_amount_below_threshold
    CHECK (dust_amount < 1e-6)
);

CREATE INDEX dust_pool_user_symbol_idx
  ON public.dust_pool (user_id, cryptocurrency, recognized_at DESC);

CREATE INDEX dust_pool_parent_idx
  ON public.dust_pool (parent_buy_id);

ALTER TABLE public.dust_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own dust" ON public.dust_pool
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE VIEW public.v_dust_pool_aggregated AS
SELECT
  user_id,
  cryptocurrency,
  COUNT(*)::int                              AS dust_entries_count,
  SUM(dust_amount)                           AS total_dust_amount,
  SUM(dust_value_eur_at_recognition)         AS total_dust_value_eur,
  MIN(recognized_at)                         AS first_recognized_at,
  MAX(recognized_at)                         AS last_recognized_at
FROM public.dust_pool
GROUP BY user_id, cryptocurrency;

COMMENT ON TABLE public.dust_pool IS
  'Accounting ledger for dust residuals after partial BUY closures. Append-only. Each row = one dust recognition event triggered by settle_sell_trade_v2 when parent.remaining_amount falls below 1e-7.';