/**
 * Learning Test Seed
 * Creates a realistic decision_events row for the authenticated user
 * Used to test the learning loop (evaluator/aggregator) without full trade execution
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's auth context
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Authentication failed', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 LEARNING_TEST_SEED: Creating test decision for user ${user.id}`);

    // Parse request body for optional customization
    const body = await req.json().catch(() => ({}));
    const symbol = body.symbol || 'BTC-EUR';
    const side = body.side || 'BUY';
    const entryPrice = body.entryPrice || 82000.0;

    // Get user's active strategy
    const { data: strategies, error: strategyError } = await supabase
      .from('trading_strategies')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    if (strategyError) {
      throw new Error(`Failed to fetch strategy: ${strategyError.message}`);
    }

    const strategyId = strategies?.[0]?.id;
    if (!strategyId) {
      return new Response(
        JSON.stringify({ error: 'No active strategy found. Please create and activate a strategy first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create realistic decision_events row
    const decisionEvent = {
      id: crypto.randomUUID(),
      user_id: user.id,
      strategy_id: strategyId,
      symbol: symbol,
      side: side,
      source: 'manual',
      confidence: 0.85,
      reason: 'learning_loop_test_seed',
      expected_pnl_pct: 2.5,
      tp_pct: 0.5,
      sl_pct: 0.8,
      entry_price: entryPrice,
      qty_suggested: side === 'BUY' ? 0.01 : 0.009,
      decision_ts: new Date().toISOString(),
      metadata: {
        test_seed: true,
        created_via: 'learning-test-seed',
        timestamp: new Date().toISOString()
      }
    };

    // Insert into decision_events
    const { data: insertedEvent, error: insertError } = await supabase
      .from('decision_events')
      .insert(decisionEvent)
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert decision event: ${insertError.message}`);
    }

    console.log(`✅ LEARNING_TEST_SEED: Created decision event ${insertedEvent.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        event: {
          id: insertedEvent.id,
          user_id: insertedEvent.user_id,
          strategy_id: insertedEvent.strategy_id,
          symbol: insertedEvent.symbol,
          side: insertedEvent.side,
          decision_ts: insertedEvent.decision_ts,
          entry_price: insertedEvent.entry_price,
          tp_pct: insertedEvent.tp_pct,
          sl_pct: insertedEvent.sl_pct
        },
        message: 'Test decision event created successfully',
        next_steps: [
          '1. Check decision_events table for the new row',
          '2. Call decision-evaluator to process this event',
          '3. Call calibration-aggregator to generate metrics',
          '4. Check learning-status to see updated counts'
        ]
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('❌ LEARNING_TEST_SEED: Error:', error.message);
    return new Response(
      JSON.stringify({ 
        error: 'Internal error', 
        details: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
