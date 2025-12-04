// Signal Seeder Utility for Testing INTELLIGENT_AUTO BUY Path
import { supabase } from '@/integrations/supabase/client';

export interface SeededSignal {
  id: string;
  symbol: string;
  signal_type: string;
}

/**
 * Seeds a bullish signal into live_signals for testing normal INTELLIGENT_AUTO BUY
 */
export async function seedBullishSignal(symbol: string): Promise<SeededSignal | null> {
  const baseSymbol = symbol.replace('-EUR', '');
  const normalizedSymbol = `${baseSymbol}-EUR`;
  
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user?.id) {
    console.error('[SignalSeeder] No authenticated user');
    return null;
  }

  const signalRow = {
    user_id: user.user.id,
    symbol: normalizedSymbol,
    signal_type: 'momentum_bullish',
    signal_strength: 0.8,
    source: 'test_seeder',
    source_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data: { seeded: true, reason: 'Testing INTELLIGENT_AUTO BUY path' }
  };

  const { data, error } = await supabase
    .from('live_signals')
    .insert(signalRow)
    .select('id, symbol, signal_type')
    .single();

  if (error) {
    console.error('[SignalSeeder] Insert failed:', error.message);
    return null;
  }

  console.log('[SignalSeeder] ✅ Seeded signal:', data);
  return data as SeededSignal;
}

/**
 * Check recent signals for a symbol
 */
export async function checkSignals(symbol?: string): Promise<any[]> {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  
  let query = supabase
    .from('live_signals')
    .select('id, symbol, signal_type, signal_strength, source, timestamp')
    .gte('timestamp', fourHoursAgo)
    .order('timestamp', { ascending: false })
    .limit(20);

  if (symbol) {
    const baseSymbol = symbol.replace('-EUR', '');
    query = query.or(`symbol.eq.${baseSymbol}-EUR,symbol.eq.${baseSymbol}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[SignalSeeder] Check failed:', error.message);
    return [];
  }

  console.log('[SignalSeeder] Recent signals:', data);
  return data || [];
}

/**
 * Clear seeded test signals
 */
export async function clearSeededSignals(): Promise<number> {
  const { data, error } = await supabase
    .from('live_signals')
    .delete()
    .eq('source', 'test_seeder')
    .select('id');

  if (error) {
    console.error('[SignalSeeder] Clear failed:', error.message);
    return 0;
  }

  const count = data?.length || 0;
  console.log('[SignalSeeder] Cleared', count, 'seeded signals');
  return count;
}

// Expose globally for console access
if (typeof window !== 'undefined') {
  (window as any).__SEED_SIGNAL = seedBullishSignal;
  (window as any).__CHECK_SIGNALS = checkSignals;
  (window as any).__CLEAR_SEEDED_SIGNALS = clearSeededSignals;
}
