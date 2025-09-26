import { supabase } from '@/integrations/supabase/client'
import type { Database } from '@/types/supabase'

export type BreakerRow =
  Database['public']['Tables']['execution_circuit_breakers']['Row']
export type MetricsRow =
  Database['public']['Views']['execution_quality_metrics_24h']['Row']

export async function getBreakers(userId: string, strategyId?: string) {
  let q = supabase
    .from('execution_circuit_breakers')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (strategyId) q = q.eq('strategy_id', strategyId)
  const { data, error } = await q
  if (error) throw error
  return data as BreakerRow[]
}

export async function getQualityMetrics24h(userId: string, strategyId?: string) {
  let q = supabase
    .from('execution_quality_metrics_24h')
    .select('*')
    .eq('user_id', userId)
    .order('trade_count', { ascending: false })
  if (strategyId) q = q.eq('strategy_id', strategyId)
  const { data, error } = await q
  if (error) throw error
  return data as MetricsRow[]
}

/** Calls RPC reset_breaker (returns boolean). */
export async function resetBreakerRPC(params: {
  user_id: string
  strategy_id: string
  symbol: string
  breaker: string
}) {
  const { data, error } = await supabase.rpc('reset_breaker', {
    p_user: params.user_id,
    p_strategy: params.strategy_id,
    p_symbol: params.symbol,
    p_type: params.breaker,
  })
  if (error) throw error
  return Boolean(data)
}