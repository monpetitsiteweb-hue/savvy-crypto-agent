// supabase/functions/_shared/openLots.ts
//
// B17 authoritative open-lot inventory helper.
// Wraps the Postgres RPC `get_open_lots_authoritative` and returns a typed
// list of open lots. Single source of truth for "what is open" across all
// consumers (engine fetchOpenPositions, coordinator G1/G7/G4/G6).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface OpenLot {
  id: string;
  symbol: string;
  entry_price: number;
  original_amount: number;
  remaining_amount: number;
  original_value_eur: number;
  executed_at: string;
  tx_hash: string | null;
  flag_open: boolean;
}

export interface FetchOpenLotsParams {
  userId: string;
  strategyId: string;
  isTestMode: boolean;
  symbol?: string | null;
}

export async function fetchOpenLotsAuthoritative(
  supa: SupabaseClient,
  params: FetchOpenLotsParams,
): Promise<OpenLot[]> {
  const { userId, strategyId, isTestMode, symbol } = params;

  const { data, error } = await supa.rpc('get_open_lots_authoritative', {
    p_user_id: userId,
    p_strategy_id: strategyId,
    p_is_test_mode: isTestMode,
    p_symbol: symbol ?? null,
  });

  if (error) {
    throw new Error(
      `[openLots] RPC failed for user=${userId.slice(0, 8)} strategy=${strategyId.slice(0, 8)} ` +
      `mode=${isTestMode ? 'TEST' : 'REAL'} symbol=${symbol ?? 'ALL'}: ${error.message}`,
    );
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row: any): OpenLot => ({
    id: row.id,
    symbol: row.symbol,
    entry_price: parseFloat(row.entry_price),
    original_amount: parseFloat(row.original_amount),
    remaining_amount: parseFloat(row.remaining_amount),
    original_value_eur: parseFloat(row.original_value_eur),
    executed_at: row.executed_at,
    tx_hash: row.tx_hash ?? null,
    flag_open: Boolean(row.flag_open),
  }));
}
