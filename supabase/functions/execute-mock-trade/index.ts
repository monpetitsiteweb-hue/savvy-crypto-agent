import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get user from JWT token
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { 
      strategyId,
      tradeType, // 'buy' or 'sell'
      cryptocurrency,
      amount,
      price,
      strategyTrigger,
      marketConditions 
    } = await req.json();

    if (!strategyId || !tradeType || !cryptocurrency || !amount || !price) {
      throw new Error('Missing required trade parameters');
    }

    console.log('Executing mock trade:', {
      strategyId,
      tradeType,
      cryptocurrency,
      amount,
      price,
      userId: user.id
    });

    // Calculate trade details
    const totalValue = parseFloat(amount) * parseFloat(price);
    const fees = totalValue * 0.0025; // 0.25% fee (typical for crypto exchanges)
    
    // Simulate market conditions and profit/loss
    const marketVolatility = Math.random() * 0.1 - 0.05; // ±5% market movement
    const profitLoss = tradeType === 'buy' 
      ? 0 // For buy orders, profit/loss is calculated when selling
      : totalValue * marketVolatility; // For sell orders, simulate immediate market impact

    // Insert mock trade
    const { data: mockTrade, error: tradeError } = await supabaseClient
      .from('mock_trades')
      .insert({
        strategy_id: strategyId,
        user_id: user.id,
        trade_type: tradeType,
        cryptocurrency,
        amount: parseFloat(amount),
        price: parseFloat(price),
        total_value: totalValue,
        fees,
        profit_loss: profitLoss,
        strategy_trigger,
        market_conditions: marketConditions || {},
        notes: `Mock ${tradeType} order executed in test mode`,
        is_test_mode: true
      })
      .select()
      .single();

    if (tradeError) {
      console.error('Error inserting mock trade:', tradeError);
      throw new Error('Failed to execute mock trade');
    }

    console.log('Mock trade executed successfully:', mockTrade);

    // Get updated strategy performance
    const { data: performance } = await supabaseClient
      .from('strategy_performance')
      .select('*')
      .eq('strategy_id', strategyId)
      .eq('execution_date', new Date().toISOString().split('T')[0])
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        trade: mockTrade,
        performance,
        message: `Mock ${tradeType} order executed successfully`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in execute-mock-trade function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});