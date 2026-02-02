-- A1: Enforce execution-class invariant at DB level
-- is_system_operator = TRUE => strategy_id MUST be NULL
-- This constraint locks the invariant at the database level
ALTER TABLE public.mock_trades
ADD CONSTRAINT chk_system_operator_strategy_null
CHECK (
  (is_system_operator = TRUE AND strategy_id IS NULL)
  OR
  (is_system_operator = FALSE)
);