/**
 * Test Mode Coordinator Integration Tests
 * 
 * Verifies that is_test_mode is correctly propagated from strategy config
 * to decision_events.metadata for the learning loop.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
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

describe('Test Mode Coordinator Integration', () => {
  it('should log is_test_mode=true when strategy config has is_test_mode=true', async () => {
    // Set strategy config with is_test_mode: true
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          is_test_mode: true,
          enableSignalFusion: false,
          aiConfidenceThreshold: 60
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
        horizon: '1h'
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    // Query decision_events to verify is_test_mode in metadata
    const { data: decisionEvents } = await supabase
      .from('decision_events')
      .select('metadata')
      .eq('user_id', testUserId)
      .eq('strategy_id', testStrategyId)
      .eq('symbol', 'BTC')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(decisionEvents).toBeDefined();
    expect(decisionEvents!.length).toBeGreaterThan(0);

    const metadata = decisionEvents![0].metadata as any;
    expect(metadata.is_test_mode).toBe(true);
  });

  it('should log is_test_mode=false when strategy config has is_test_mode=false', async () => {
    // Set strategy config with is_test_mode: false (LIVE mode)
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          is_test_mode: false,
          enableSignalFusion: false,
          aiConfidenceThreshold: 60
        }
      })
      .eq('id', testStrategyId);

    const tradeIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'ETH',
      side: 'BUY',
      source: 'automated',
      confidence: 0.75,
      qtySuggested: 0.01,
      metadata: {
        horizon: '1h'
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    // Query decision_events to verify is_test_mode in metadata
    const { data: decisionEvents } = await supabase
      .from('decision_events')
      .select('metadata')
      .eq('user_id', testUserId)
      .eq('strategy_id', testStrategyId)
      .eq('symbol', 'ETH')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(decisionEvents).toBeDefined();
    expect(decisionEvents!.length).toBeGreaterThan(0);

    const metadata = decisionEvents![0].metadata as any;
    expect(metadata.is_test_mode).toBe(false);
  });

  it('should default to is_test_mode=false when configuration.is_test_mode is missing', async () => {
    // Set strategy config WITHOUT is_test_mode field (backwards compatibility test)
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          enableSignalFusion: false,
          aiConfidenceThreshold: 60
          // is_test_mode intentionally omitted
        }
      })
      .eq('id', testStrategyId);

    const tradeIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'SOL',
      side: 'BUY',
      source: 'automated',
      confidence: 0.75,
      qtySuggested: 0.5,
      metadata: {
        horizon: '1h'
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    // Query decision_events to verify is_test_mode defaults to false
    const { data: decisionEvents } = await supabase
      .from('decision_events')
      .select('metadata')
      .eq('user_id', testUserId)
      .eq('strategy_id', testStrategyId)
      .eq('symbol', 'SOL')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(decisionEvents).toBeDefined();
    expect(decisionEvents!.length).toBeGreaterThan(0);

    const metadata = decisionEvents![0].metadata as any;
    // Should default to false when not present in config
    expect(metadata.is_test_mode).toBe(false);
  });

  it('should respect intent.metadata.is_test_mode as fallback', async () => {
    // Set strategy config with is_test_mode: false
    await supabase
      .from('trading_strategies')
      .update({
        configuration: {
          is_test_mode: false,
          enableSignalFusion: false,
          aiConfidenceThreshold: 60
        }
      })
      .eq('id', testStrategyId);

    const tradeIntent = {
      userId: testUserId,
      strategyId: testStrategyId,
      symbol: 'ADA',
      side: 'BUY',
      source: 'manual', // Manual test trade
      confidence: 0.75,
      qtySuggested: 10,
      metadata: {
        is_test_mode: true, // Override via intent metadata
        horizon: '1h'
      }
    };

    const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
      body: { intent: tradeIntent }
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    // Query decision_events to verify fallback works
    const { data: decisionEvents } = await supabase
      .from('decision_events')
      .select('metadata')
      .eq('user_id', testUserId)
      .eq('strategy_id', testStrategyId)
      .eq('symbol', 'ADA')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(decisionEvents).toBeDefined();
    expect(decisionEvents!.length).toBeGreaterThan(0);

    const metadata = decisionEvents![0].metadata as any;
    // Should use intent.metadata.is_test_mode as fallback
    expect(metadata.is_test_mode).toBe(true);
  });
});
