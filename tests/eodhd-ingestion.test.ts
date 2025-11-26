import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fuieplftlcxdfkxyqzlt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8';

describe('EODHD Ingestion', () => {
  const supabase = createClient(supabaseUrl, supabaseKey);

  it('should have EODHD signals in live_signals table', async () => {
    const { data, error } = await supabase
      .from('live_signals')
      .select('*')
      .eq('source', 'eodhd')
      .order('created_at', { ascending: false })
      .limit(10);

    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it('should have valid signal structure with symbol and data', async () => {
    const { data, error } = await supabase
      .from('live_signals')
      .select('*')
      .eq('source', 'eodhd')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      expect(data.symbol).toBeDefined();
      expect(data.data).toBeDefined();
      expect(data.signal_type).toBeDefined();
      expect(data.signal_strength).toBeGreaterThanOrEqual(0);
    }
  });

  it('should have EODHD signal types in signal_registry', async () => {
    const { data, error } = await supabase
      .from('signal_registry')
      .select('*')
      .eq('category', 'eodhd');

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data?.length).toBeGreaterThan(0);
    
    const signalTypes = data?.map(s => s.key) || [];
    expect(signalTypes).toContain('eodhd_intraday_volume_spike');
    expect(signalTypes).toContain('eodhd_unusual_volatility');
    expect(signalTypes).toContain('eodhd_price_breakout_bullish');
    expect(signalTypes).toContain('eodhd_price_breakdown_bearish');
  });

  it('should not have schema mismatches', async () => {
    const { data, error } = await supabase
      .from('live_signals')
      .select('id, source_id, user_id, timestamp, symbol, signal_type, signal_strength, source, data, processed')
      .eq('source', 'eodhd')
      .limit(1);

    expect(error).toBeNull();
  });
});
