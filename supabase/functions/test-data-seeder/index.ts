import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const userId = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

    // First run backfill
    console.log('🔄 Running backfill function...');
    const { data: backfillData, error: backfillError } = await supabaseAdmin.functions.invoke('backfill-sell-snapshots', {
      body: {
        scope: 'single_user',
        userId: userId,
        mode: 'test',
        dryRun: false
      }
    });

    if (backfillError) {
      console.error('Backfill error:', backfillError);
      return new Response(
        JSON.stringify({ error: 'Backfill failed', details: backfillError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Backfill completed:', backfillData);

    // Create Sequence A (COINBASE_PRO, 0% fees)
    const strategyA = crypto.randomUUID();
    
    // BUY trade A
    const { data: buyA, error: buyAError } = await supabaseAdmin.from('mock_trades').insert({
      user_id: userId,
      strategy_id: strategyA,
      trade_type: 'buy',
      cryptocurrency: 'XRP-EUR',
      amount: 1.00000000,
      price: 100.00,
      total_value: 100.00,
      fees: 0.00,
      executed_at: new Date(Date.now() - 60000).toISOString(),
      is_test_mode: true
    }).select().single();

    if (buyAError) {
      console.error('Buy A error:', buyAError);
      return new Response(
        JSON.stringify({ error: 'Buy A failed', details: buyAError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SELL trade A
    const { data: sellA, error: sellAError } = await supabaseAdmin.from('mock_trades').insert({
      user_id: userId,
      strategy_id: strategyA,
      trade_type: 'sell',
      cryptocurrency: 'XRP-EUR',
      amount: 1.00000000,
      price: 120.00,
      total_value: 120.00,
      fees: 0.00,
      executed_at: new Date().toISOString(),
      is_test_mode: true,
      exit_value: 120.00,
      original_purchase_amount: 1.00000000,
      original_purchase_price: 100.00,
      original_purchase_value: 100.00,
      buy_fees: 0.00,
      sell_fees: 0.00,
      realized_pnl: 20.00,
      realized_pnl_pct: 20.00
    }).select().single();

    if (sellAError) {
      console.error('Sell A error:', sellAError);
      return new Response(
        JSON.stringify({ error: 'Sell A failed', details: sellAError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Sequence B (OTHER, 5% fees)
    const strategyB = crypto.randomUUID();
    
    // BUY trade B
    const { data: buyB, error: buyBError } = await supabaseAdmin.from('mock_trades').insert({
      user_id: userId,
      strategy_id: strategyB,
      trade_type: 'buy',
      cryptocurrency: 'ETH-EUR',
      amount: 1.00000000,
      price: 100.00,
      total_value: 100.00,
      fees: 5.00,
      executed_at: new Date(Date.now() - 60000).toISOString(),
      is_test_mode: true
    }).select().single();

    if (buyBError) {
      console.error('Buy B error:', buyBError);
      return new Response(
        JSON.stringify({ error: 'Buy B failed', details: buyBError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SELL trade B
    const { data: sellB, error: sellBError } = await supabaseAdmin.from('mock_trades').insert({
      user_id: userId,
      strategy_id: strategyB,
      trade_type: 'sell',
      cryptocurrency: 'ETH-EUR',
      amount: 1.00000000,
      price: 120.00,
      total_value: 120.00,
      fees: 6.00,
      executed_at: new Date().toISOString(),
      is_test_mode: true,
      exit_value: 120.00,
      original_purchase_amount: 1.00000000,
      original_purchase_price: 100.00,
      original_purchase_value: 100.00,
      buy_fees: 5.00,
      sell_fees: 6.00,
      realized_pnl: 9.00,
      realized_pnl_pct: 9.00
    }).select().single();

    if (sellBError) {
      console.error('Sell B error:', sellBError);
      return new Response(
        JSON.stringify({ error: 'Sell B failed', details: sellBError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validation queries
    const { data: missingCount } = await supabaseAdmin
      .from('mock_trades')
      .select('*', { count: 'exact', head: true })
      .eq('trade_type', 'sell')
      .is('original_purchase_value', null);

    const { data: badExitCount } = await supabaseAdmin
      .rpc('execute_sql', { 
        sql: `SELECT COUNT(*) AS count FROM mock_trades WHERE trade_type='sell' AND exit_value IS NOT NULL AND ABS(exit_value - (amount * price)) > 0.01` 
      });

    const { data: pastRowsCount } = await supabaseAdmin
      .from('past_positions_view_admin')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { data: pastRows } = await supabaseAdmin
      .from('past_positions_view_admin')
      .select('*')
      .eq('user_id', userId)
      .order('exit_at', { ascending: false })
      .limit(10);

    return new Response(
      JSON.stringify({
        success: true,
        backfill_response: backfillData,
        validation: {
          missing: missingCount,
          bad_exit: badExitCount,
          past_rows_count: pastRowsCount,
          past_rows: pastRows
        },
        test_sequences: {
          sell_a: sellA,
          sell_b: sellB
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});