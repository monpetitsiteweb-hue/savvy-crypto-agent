import { createClient } from '@supabase/supabase-js';

export async function devTopUpCoverage(params: {
  strategyId: string;
  base: string; // e.g., 'BTC'
  amount: number; // how much to buy
  price: number;  // any reasonable test price
}) {
  const { strategyId, base, amount, price } = params;
  const supabaseUrl = 'https://fuieplftlcxdfkxyqzlt.supabase.co';
  const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8';
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: session } = await supabase.auth.getSession();
  const uid = session?.session?.user?.id;
  if (!uid) throw new Error('No user session');

  const total_value = amount * price;
  const payload = {
    user_id: uid,
    strategy_id: strategyId,
    trade_type: 'buy',
    cryptocurrency: base.toUpperCase(),
    amount, price, total_value,
    fees: 0, buy_fees: 0,
    is_test_mode: true,
    executed_at: new Date().toISOString(),
    notes: 'dev-coverage-topup',
  };

  const { error } = await supabase.from('mock_trades').insert(payload);
  if (error) throw error;
  return { ok: true };
}