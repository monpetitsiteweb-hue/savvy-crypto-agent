import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/types/supabase';

/**
 * Minimal typed shim that allows querying known public tables
 * PLUS a small set of optional/legacy tables (e.g., whale_signal_events).
 */
type KnownTables = keyof Database['public']['Tables'] 
  | 'whale_signal_events' 
  | 'strategy_parameters' 
  | 'execution_circuit_breakers' 
  | 'execution_holds'
  | 'signal_registry'
  | 'strategy_signal_weights';

export function fromTable<T extends KnownTables>(name: T) {
  // At runtime, supabase-js will accept any relation string;
  // typings are widened here to avoid hard build breaks for optional tables.
  return (supabase as any).from(name);
}