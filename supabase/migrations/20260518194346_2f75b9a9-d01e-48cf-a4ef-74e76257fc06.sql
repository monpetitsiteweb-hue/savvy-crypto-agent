-- =========================================================
-- (A) reconciliation_alerts table
-- =========================================================
CREATE TABLE public.reconciliation_alerts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id                UUID NOT NULL,
  is_test_mode           BOOLEAN NOT NULL,
  actual_cash_eur        NUMERIC NOT NULL,
  expected_cash_eur      NUMERIC NOT NULL,
  delta_eur              NUMERIC NOT NULL,
  threshold_eur          NUMERIC NOT NULL,
  n_buys                 INTEGER NOT NULL DEFAULT 0,
  n_sells                INTEGER NOT NULL DEFAULT 0,
  sum_buys               NUMERIC NOT NULL DEFAULT 0,
  sum_sells              NUMERIC NOT NULL DEFAULT 0,
  sum_fees               NUMERIC NOT NULL DEFAULT 0,
  sum_gas_eur            NUMERIC NOT NULL DEFAULT 0,
  starting_capital_eur   NUMERIC NOT NULL,
  notes                  TEXT,
  resolved               BOOLEAN NOT NULL DEFAULT false,
  resolved_at            TIMESTAMPTZ,
  resolved_by            UUID
);

CREATE INDEX idx_reconciliation_alerts_user_mode_created
  ON public.reconciliation_alerts (user_id, is_test_mode, created_at DESC);

ALTER TABLE public.reconciliation_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_own_alerts"
  ON public.reconciliation_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- =========================================================
-- (B) reconcile_portfolio_capital() RPC  [CORRECTION #2 applied: price + ts]
-- =========================================================
CREATE OR REPLACE FUNCTION public.reconcile_portfolio_capital()
RETURNS TABLE (
  user_id                UUID,
  is_test_mode           BOOLEAN,
  actual_cash_eur        NUMERIC,
  expected_cash_eur      NUMERIC,
  delta_eur              NUMERIC,
  n_buys                 INTEGER,
  n_sells                INTEGER,
  sum_buys               NUMERIC,
  sum_sells              NUMERIC,
  sum_buy_fees           NUMERIC,
  sum_sell_fees          NUMERIC,
  sum_gas_eur            NUMERIC,
  starting_capital_eur   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_eth_price_eur NUMERIC;
BEGIN
  -- ETH price for REAL gas conversion (matches get_portfolio_metrics STEP 6).
  -- Note: price_snapshots.price IS the EUR-equivalent value.
  SELECT price
    INTO v_eth_price_eur
    FROM price_snapshots
   WHERE symbol IN ('ETH-EUR', 'ETH')
   ORDER BY ts DESC
   LIMIT 1;

  v_eth_price_eur := COALESCE(v_eth_price_eur, 0);

  RETURN QUERY
  SELECT
    pc.user_id,
    pc.is_test_mode,
    pc.cash_balance_eur AS actual_cash_eur,
    (
      pc.starting_capital_eur
      - COALESCE(SUM(
          CASE WHEN mt.trade_type = 'buy' THEN
            mt.total_value
            + COALESCE(mt.buy_fees, 0)
            + CASE WHEN COALESCE(mt.buy_fees, 0) = 0
                   THEN COALESCE(mt.fees, 0) ELSE 0 END
          ELSE 0 END
        ), 0)
      + COALESCE(SUM(
          CASE WHEN mt.trade_type = 'sell' THEN
            mt.total_value
            - COALESCE(mt.sell_fees, 0)
            - CASE WHEN COALESCE(mt.sell_fees, 0) = 0
                   THEN COALESCE(mt.fees, 0) ELSE 0 END
          ELSE 0 END
        ), 0)
      - CASE WHEN pc.is_test_mode = false
             THEN COALESCE(SUM(mt.gas_cost_eth), 0) * v_eth_price_eur
             ELSE 0 END
    ) AS expected_cash_eur,
    (
      pc.cash_balance_eur -
      (
        pc.starting_capital_eur
        - COALESCE(SUM(
            CASE WHEN mt.trade_type = 'buy' THEN
              mt.total_value
              + COALESCE(mt.buy_fees, 0)
              + CASE WHEN COALESCE(mt.buy_fees, 0) = 0
                     THEN COALESCE(mt.fees, 0) ELSE 0 END
            ELSE 0 END
          ), 0)
        + COALESCE(SUM(
            CASE WHEN mt.trade_type = 'sell' THEN
              mt.total_value
              - COALESCE(mt.sell_fees, 0)
              - CASE WHEN COALESCE(mt.sell_fees, 0) = 0
                     THEN COALESCE(mt.fees, 0) ELSE 0 END
            ELSE 0 END
          ), 0)
        - CASE WHEN pc.is_test_mode = false
               THEN COALESCE(SUM(mt.gas_cost_eth), 0) * v_eth_price_eur
               ELSE 0 END
      )
    ) AS delta_eur,
    COALESCE(SUM(CASE WHEN mt.trade_type='buy'  THEN 1 ELSE 0 END), 0)::INT AS n_buys,
    COALESCE(SUM(CASE WHEN mt.trade_type='sell' THEN 1 ELSE 0 END), 0)::INT AS n_sells,
    COALESCE(SUM(CASE WHEN mt.trade_type='buy'  THEN mt.total_value ELSE 0 END), 0) AS sum_buys,
    COALESCE(SUM(CASE WHEN mt.trade_type='sell' THEN mt.total_value ELSE 0 END), 0) AS sum_sells,
    COALESCE(SUM(
      CASE WHEN mt.trade_type='buy' THEN
        COALESCE(mt.buy_fees,0)
        + CASE WHEN COALESCE(mt.buy_fees,0)=0 THEN COALESCE(mt.fees,0) ELSE 0 END
      ELSE 0 END), 0) AS sum_buy_fees,
    COALESCE(SUM(
      CASE WHEN mt.trade_type='sell' THEN
        COALESCE(mt.sell_fees,0)
        + CASE WHEN COALESCE(mt.sell_fees,0)=0 THEN COALESCE(mt.fees,0) ELSE 0 END
      ELSE 0 END), 0) AS sum_sell_fees,
    CASE WHEN pc.is_test_mode = false
         THEN COALESCE(SUM(mt.gas_cost_eth), 0) * v_eth_price_eur
         ELSE 0 END AS sum_gas_eur,
    pc.starting_capital_eur
  FROM portfolio_capital pc
  LEFT JOIN mock_trades mt
    ON  mt.user_id      = pc.user_id
    AND mt.is_test_mode = pc.is_test_mode
    AND mt.is_corrupted = false
    AND mt.is_archived  = false
    AND (pc.is_test_mode = true OR mt.execution_confirmed = true)
  GROUP BY pc.user_id, pc.is_test_mode, pc.cash_balance_eur, pc.starting_capital_eur;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_portfolio_capital() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_portfolio_capital() TO service_role;