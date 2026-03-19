-- Phase 1: Remove DB-level single-position constraint.
-- Gate 5b (maxLotsPerSymbol) in coordinator is now the canonical guard.
DROP INDEX IF EXISTS unique_open_position_per_symbol;