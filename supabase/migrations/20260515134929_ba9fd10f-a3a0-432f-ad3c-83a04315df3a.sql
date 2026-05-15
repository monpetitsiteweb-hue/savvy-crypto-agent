BEGIN;

CREATE TYPE public.position_status_enum AS ENUM (
  'PENDING',
  'OPEN',
  'PARTIALLY_CLOSED',
  'CLOSED',
  'STUCK'
);

ALTER TABLE public.mock_trades
  ADD COLUMN position_status public.position_status_enum;

UPDATE public.mock_trades
SET position_status = 'PENDING'
WHERE trade_type = 'buy'
  AND execution_confirmed = false
  AND (execution_source = 'onchain_pending' OR tx_hash IS NULL)
  AND is_archived = false
  AND is_corrupted = false;

UPDATE public.mock_trades AS b
SET position_status = 'OPEN'
WHERE b.trade_type = 'buy'
  AND b.execution_confirmed = true
  AND b.is_open_position = true
  AND b.is_archived = false
  AND b.is_corrupted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.mock_trades s
    WHERE s.original_trade_id = b.id
      AND s.trade_type = 'sell'
      AND s.settlement_status = 'SETTLED'
      AND s.is_archived = false
      AND s.is_corrupted = false
  );

UPDATE public.mock_trades
SET position_status = 'CLOSED'
WHERE trade_type = 'buy'
  AND execution_confirmed = true
  AND is_open_position = false
  AND is_archived = false
  AND is_corrupted = false
  AND position_status IS NULL;

UPDATE public.mock_trades
SET position_status = 'STUCK'
WHERE trade_type = 'buy'
  AND execution_confirmed = false
  AND COALESCE(execution_ts, executed_at) < now() - interval '7 days'
  AND is_archived = false
  AND position_status IS NULL;

CREATE INDEX mock_trades_position_status_idx
  ON public.mock_trades (user_id, position_status)
  WHERE position_status IS NOT NULL;

COMMIT;