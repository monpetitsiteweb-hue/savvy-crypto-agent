/**
 * Signal Fusion Tests
 * 
 * Test the computeFusedSignalScore function with various scenarios
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { supabase } from '@/integrations/supabase/client';
import { fromTable } from '@/utils/supa';
import { computeFusedSignalScore } from '@/engine/signalFusion';

describe('Signal Fusion Module', () => {
  let testUserId: string;
  let testStrategyId: string;
  let testSignalId: string;

  beforeAll(async () => {
    // Get current user for testing
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    testUserId = user.id;

    // Get or create a test strategy
    const { data: strategies } = await supabase
      .from('trading_strategies')
      .select('id')
      .eq('user_id', testUserId)
      .limit(1);

    if (!strategies || strategies.length === 0) {
      throw new Error('No strategy found for testing');
    }
    testStrategyId = strategies[0].id;
  });

  it('should return zero score when no signals exist', async () => {
    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'NONEXISTENT',
      horizon: '1h',
      now: new Date()
    });

    expect(result.fusedScore).toBe(0);
    expect(result.totalSignals).toBe(0);
    expect(result.enabledSignals).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it('should compute positive score for bullish signal', async () => {
    // Insert a test bullish signal
    const { data: signal, error: insertError } = await supabase
      .from('live_signals')
      .insert({
        user_id: testUserId,
        source_id: testStrategyId,
        symbol: 'BTC',
        signal_type: 'ma_cross_bullish',
        signal_strength: 80,
        source: 'test',
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;
    testSignalId = signal.id;

    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'BTC',
      horizon: '1h',
      now: new Date()
    });

    expect(result.fusedScore).toBeGreaterThan(0);
    expect(result.enabledSignals).toBeGreaterThanOrEqual(1);
    expect(result.details.length).toBeGreaterThanOrEqual(1);

    const bullishSignal = result.details.find(d => d.signalType === 'ma_cross_bullish');
    expect(bullishSignal).toBeDefined();
    expect(bullishSignal?.contribution).toBeGreaterThan(0);

    // Cleanup
    await supabase.from('live_signals').delete().eq('id', testSignalId);
  });

  it('should compute negative score for bearish signal', async () => {
    // Insert a test bearish signal
    const { data: signal, error: insertError } = await supabase
      .from('live_signals')
      .insert({
        user_id: testUserId,
        source_id: testStrategyId,
        symbol: 'ETH',
        signal_type: 'rsi_overbought_bearish',
        signal_strength: 75,
        source: 'test',
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'ETH',
      horizon: '4h',
      now: new Date()
    });

    expect(result.fusedScore).toBeLessThan(0);
    expect(result.enabledSignals).toBeGreaterThanOrEqual(1);

    const bearishSignal = result.details.find(d => d.signalType === 'rsi_overbought_bearish');
    expect(bearishSignal).toBeDefined();
    expect(bearishSignal?.contribution).toBeLessThan(0);

    // Cleanup
    await supabase.from('live_signals').delete().eq('id', signal.id);
  });

  it('should handle mixed bullish and bearish signals', async () => {
    // Insert both bullish and bearish signals
    const { data: signals, error: insertError } = await supabase
      .from('live_signals')
      .insert([
        {
          user_id: testUserId,
          source_id: testStrategyId,
          symbol: 'SOL',
          signal_type: 'ma_cross_bullish',
          signal_strength: 70,
          source: 'test',
          timestamp: new Date().toISOString()
        },
        {
          user_id: testUserId,
          source_id: testStrategyId,
          symbol: 'SOL',
          signal_type: 'rsi_overbought_bearish',
          signal_strength: 60,
          source: 'test',
          timestamp: new Date().toISOString()
        }
      ])
      .select();

    if (insertError) throw insertError;

    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'SOL',
      horizon: '1h',
      now: new Date()
    });

    expect(result.enabledSignals).toBe(2);
    expect(result.details).toHaveLength(2);

    // Score should reflect the net of both signals
    const bullishContribution = result.details.find(d => d.signalType === 'ma_cross_bullish')?.contribution || 0;
    const bearishContribution = result.details.find(d => d.signalType === 'rsi_overbought_bearish')?.contribution || 0;
    expect(bullishContribution).toBeGreaterThan(0);
    expect(bearishContribution).toBeLessThan(0);

    // Cleanup
    if (signals) {
      for (const signal of signals) {
        await supabase.from('live_signals').delete().eq('id', signal.id);
      }
    }
  });

  it('should skip disabled signals from registry', async () => {
    // Disable a signal type
    await fromTable('signal_registry')
      .update({ is_enabled: false })
      .eq('key', 'volume_spike');

    // Insert signal of disabled type
    const { data: signal, error: insertError } = await supabase
      .from('live_signals')
      .insert({
        user_id: testUserId,
        source_id: testStrategyId,
        symbol: 'XRP',
        signal_type: 'volume_spike',
        signal_strength: 90,
        source: 'test',
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'XRP',
      horizon: '15m',
      now: new Date()
    });

    // Signal should be skipped
    const volumeSignal = result.details.find(d => d.signalType === 'volume_spike');
    expect(volumeSignal).toBeUndefined();

    // Re-enable signal
    await fromTable('signal_registry')
      .update({ is_enabled: true })
      .eq('key', 'volume_spike');

    // Cleanup
    await supabase.from('live_signals').delete().eq('id', signal.id);
  });

  it('should apply per-strategy weight overrides', async () => {
    // Create a strategy weight override
    const { data: override, error: overrideError } = await fromTable('strategy_signal_weights')
      .insert({
        strategy_id: testStrategyId,
        signal_key: 'ma_cross_bullish',
        weight: 2.5,
        is_enabled: true
      })
      .select()
      .single();

    if (overrideError) throw overrideError;

    // Insert signal
    const { data: signal, error: insertError } = await supabase
      .from('live_signals')
      .insert({
        user_id: testUserId,
        source_id: testStrategyId,
        symbol: 'ADA',
        signal_type: 'ma_cross_bullish',
        signal_strength: 50,
        source: 'test',
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'ADA',
      horizon: '1h',
      now: new Date()
    });

    const signalDetail = result.details.find(d => d.signalType === 'ma_cross_bullish');
    expect(signalDetail).toBeDefined();
    expect(signalDetail?.appliedWeight).toBe(2.5); // Override weight

    // Cleanup
    await fromTable('strategy_signal_weights').delete().eq('id', (override as any).id);
    await supabase.from('live_signals').delete().eq('id', signal.id);
  });

  it('should fail soft when errors occur', async () => {
    // Test with invalid strategy ID
    const result = await computeFusedSignalScore({
      userId: testUserId,
      strategyId: '00000000-0000-0000-0000-000000000000',
      symbol: 'BTC',
      horizon: '1h',
      now: new Date()
    });

    // Should not throw, should return zero score
    expect(result.fusedScore).toBe(0);
    expect(result.details).toHaveLength(0);
  });
});
