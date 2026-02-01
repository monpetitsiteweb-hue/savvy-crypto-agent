-- ============================================================================
-- ADD DURABLE EXECUTION-CLASS COLUMN FOR SYSTEM OPERATOR TRADES
-- ============================================================================
-- This column defines the execution class at the ledger level.
-- System operator trades bypass all strategy/coverage/FIFO logic.
-- ============================================================================

-- 1️⃣ Add the durable execution-class column
ALTER TABLE public.mock_trades 
ADD COLUMN IF NOT EXISTS is_system_operator BOOLEAN NOT NULL DEFAULT FALSE;

-- Create partial index for efficient filtering of system operator trades
CREATE INDEX IF NOT EXISTS idx_mock_trades_is_system_operator
ON public.mock_trades(is_system_operator)
WHERE is_system_operator = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN public.mock_trades.is_system_operator IS 
'Durable execution-class flag. TRUE = system operator trade (uses BOT_ADDRESS, bypasses all strategy/FIFO/coverage logic). Must be set explicitly at INSERT time.';

-- 2️⃣ Update the trigger to use the dedicated column with hard bypass
CREATE OR REPLACE FUNCTION public.mt_on_sell_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    v_buy RECORD;
    v_exit_value NUMERIC;
BEGIN
    -- Only process SELL trades
    IF NEW.trade_type <> 'sell' THEN
        RETURN NEW;
    END IF;

    -- Calculate exit value
    v_exit_value := NEW.amount * NEW.price;

    -- ========================================================================
    -- HARD BYPASS: SYSTEM OPERATOR TRADES
    -- Execution class is defined by the column, NOT by JSON
    -- is_system_operator = true ⇒ no FIFO, no coverage, no strategy ownership
    -- ========================================================================
    IF NEW.is_system_operator = TRUE THEN
        NEW.exit_value := v_exit_value;

        -- Explicit zeroing (documented as "not applicable" for system trades)
        NEW.original_purchase_amount := 0;
        NEW.original_purchase_price := 0;
        NEW.original_purchase_value := 0;
        NEW.buy_fees := 0;
        NEW.sell_fees := COALESCE(NEW.fees, 0);
        NEW.fees := COALESCE(NEW.fees, 0);
        NEW.realized_pnl := 0;
        NEW.realized_pnl_pct := 0;
        NEW.profit_loss := 0;

        RETURN NEW;
    END IF;

    -- ========================================================================
    -- STANDARD STRATEGY FLOW (non-system trades only)
    -- Requires BUY coverage for the same strategy/symbol
    -- ========================================================================
    SELECT *
    INTO v_buy
    FROM public.mock_trades
    WHERE user_id = NEW.user_id
      AND strategy_id = NEW.strategy_id
      AND cryptocurrency = NEW.cryptocurrency
      AND trade_type = 'buy'
      AND is_corrupted = FALSE
    ORDER BY executed_at ASC
    LIMIT 1;

    IF v_buy IS NULL THEN
        RAISE EXCEPTION
            'SELL rejected: insufficient BUY coverage for % (strategy: %, user: %)',
            NEW.cryptocurrency, NEW.strategy_id, NEW.user_id;
    END IF;

    NEW.exit_value := v_exit_value;
    NEW.original_trade_id := v_buy.id;
    NEW.original_purchase_amount := v_buy.amount;
    NEW.original_purchase_price := v_buy.price;
    NEW.original_purchase_value := v_buy.total_value;
    NEW.buy_fees := COALESCE(v_buy.fees, 0);
    NEW.sell_fees := COALESCE(NEW.fees, 0);
    NEW.fees := COALESCE(v_buy.fees, 0) + COALESCE(NEW.fees, 0);
    NEW.realized_pnl := v_exit_value - v_buy.total_value - NEW.fees;
    NEW.realized_pnl_pct := CASE
        WHEN v_buy.total_value > 0
        THEN (NEW.realized_pnl / v_buy.total_value) * 100
        ELSE 0
    END;
    NEW.profit_loss := NEW.realized_pnl;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;