import type { Database } from '@/types/supabase';

export type StrategyRow =
  Database['public']['Tables']['trading_strategies']['Row'];

// Back-compat shape some components expect
export interface StrategyData extends StrategyRow {
  // Legacy/expected fields (optional, derived)
  is_active_test?: boolean;
  is_active_live?: boolean;
  test_mode?: boolean;
}

/**
 * Normalize DB row -> StrategyData with back-compat fields populated.
 * Rules:
 * - test_mode <- prefer existing row.test_mode, else is_test_mode, default false
 * - is_active_test <- true if is_active && is_test_mode
 * - is_active_live <- true if is_active && !is_test_mode
 */
export function normalizeStrategy(row: StrategyRow): StrategyData {
  const test_mode = (row as any).test_mode ?? (row.is_test_mode ?? false);
  const is_active = row.is_active ?? false;

  return {
    ...row,
    test_mode,
    is_active_test: (row as any).is_active_test ?? ((is_active && !!test_mode) || false),
    is_active_live: (row as any).is_active_live ?? ((is_active && !test_mode) || false),
  };
}