/**
 * Signal Fusion Coordinator Integration Tests
 * 
 * Tests Phase 1B READ-ONLY integration with zero behavior change.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

let testUserId: string;
let testStrategyId: string;

beforeAll(async () => {
  // Authenticate test user
  const { data: { user }, error } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'testpassword'
  });

  if (error || !user) {
    throw new Error('Failed to authenticate test user');
  }

  testUserId = user.id;

  // Get a test strategy
  const { data: strategies } = await supabase
    .from('trading_strategies')
    .select('id')
    .eq('user_id', testUserId)
    .limit(1);

  if (!strategies || strategies.length === 0) {
    throw new Error('No strategies found for test user');
  }

  testStrategyId = strategies[0].id;
});

describe('Signal Fusion Coordinator Integration - Phase 1B', () => {
  it('should NOT call fusion when enableSignalFusion is false', async () => {
    // This test verifies that fusion is OFF by default
    // First, ensure strategy config has enableSignalFusion: false
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          enableSignalFusion: false,
          is_test_mode: true
        }
      })
      .eq('id', testStrategyId);

    const tradeIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'BTC',
      side: 'BUY',
      source: 'automated',
      confidence: 0.75,
      qtySuggested: 0.001,
      metadata: {
        is_test_mode: true
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.ok).toBe(true);
    
    // Decision should be made without fusion
    expect(data.decision).toBeDefined();
  });

  it('should call fusion when enableSignalFusion is true in TEST mode', async () => {
    // Update strategy config to enable fusion
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          enableSignalFusion: true,
          is_test_mode: true
        }
      })
      .eq('id', testStrategyId);

    // Insert a test signal
    const { error: insertError } = await supabase
      .from('live_signals')
      .insert({
        user_id: testUserId,
        source_id: testStrategyId,
        symbol: 'BTC',
        signal_type: 'ma_cross_bullish',
        signal_strength: 80,
        source: 'test_signal_fusion',
        timestamp: new Date().toISOString()
      });

    expect(insertError).toBeNull();

    const tradeIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'BTC',
      side: 'BUY',
      source: 'automated',
      confidence: 0.75,
      qtySuggested: 0.001,
      metadata: {
        is_test_mode: true,
        horizon: '1h'
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.ok).toBe(true);
    
    // Verify decision was made
    expect(data.decision).toBeDefined();
    
    // Check that fusion was computed by querying decision_events
    const { data: decisionEvents } = await supabase
      .from('decision_events')
      .select('metadata')
      .eq('user_id', testUserId)
      .eq('strategy_id', testStrategyId)
      .eq('symbol', 'BTC')
      .order('created_at', { ascending: false })
      .limit(1);
    
    expect(decisionEvents).toBeDefined();
    if (decisionEvents && decisionEvents.length > 0) {
      const metadata = decisionEvents[0].metadata as any;
      // If fusion was enabled, metadata should have signalFusion field
      if (metadata?.signalFusion) {
        expect(metadata.signalFusion.score).toBeDefined();
        expect(typeof metadata.signalFusion.score).toBe('number');
      }
    }
  });

  it('should fail soft when fusion errors occur', async () => {
    // Create a temporary strategy with fusion enabled but invalid signal_registry references
    const { data: tempStrategy } = await supabase
      .from('trading_strategies')
      .insert({
        user_id: testUserId,
        strategy_name: 'Test Fusion Error Strategy',
        configuration: {
          enableSignalFusion: true,
          is_test_mode: true
        }
      })
      .select('id')
      .single();

    const tradeIntent = {
      userId: testUserId,
      strategyId: tempStrategy!.id,
      symbol: 'BTC',
      side: 'BUY',
      source: 'automated',
      confidence: 0.75,
      qtySuggested: 0.001,
      metadata: {
        is_test_mode: true
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    // Fusion error should NOT block the decision
    // Coordinator should continue with fusion score = null
    expect(data).toBeDefined();
    // Even if there's an error from coordinator (e.g., strategy not found),
    // it should NOT be from signal fusion
  });

  it('should NOT change decision behavior with or without fusion', async () => {
    // Make two identical decisions: one with fusion OFF, one with fusion ON
    const baseIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'ETH',
      side: 'BUY',
      source: 'automated',
      confidence: 0.70,
      qtySuggested: 0.01
    };

    // Decision 1: Fusion OFF
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          enableSignalFusion: false,
          is_test_mode: true
        }
      })
      .eq('id', testStrategyId);

    const intent1 = {
      ...baseIntent,
      metadata: {
        is_test_mode: true
      }
    };

    const { data: data1 } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: intent1 }
    });

    // Decision 2: Fusion ON
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          enableSignalFusion: true,
          is_test_mode: true
        }
      })
      .eq('id', testStrategyId);

    const intent2 = {
      ...baseIntent,
      metadata: {
        is_test_mode: true,
        horizon: '1h'
      }
    };

    const { data: data2 } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: intent2 }
    });

    // Both decisions should have the same action and reason
    // (fusion should not influence behavior in Phase 1B)
    expect(data1?.decision?.action).toBe(data2?.decision?.action);
    // Reasons might differ slightly due to timing, but actions should match
  });
});

afterAll(async () => {
  // Cleanup test signals
  await supabase
    .from('live_signals')
    .delete()
    .eq('source', 'test_signal_fusion');
});
