import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// JWT decoding for user authentication
function decodeJWT(token: string): { sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (error) {
    console.error('JWT decode error:', error);
    return null;
  }
}

// Symbol normalization utilities (inlined for Deno)
type BaseSymbol = string;        // e.g., "BTC"

const toBaseSymbol = (input: string): BaseSymbol =>
  input.includes("-") ? input.split("-")[0] : input;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract user ID from JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        ok: false,
        stage: 'auth',
        reason: 'no_user',
        error: 'Missing or invalid Authorization header'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = decodeJWT(token);
    
    if (!payload?.sub) {
      return new Response(JSON.stringify({
        ok: false,
        stage: 'auth',
        reason: 'no_user',
        error: 'Invalid JWT token'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    const userId = payload.sub;

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { strategy_id, symbol, side, amount, price, reasonOverride, mode } = body;
    
    // Validate required fields
    if (!strategy_id || !symbol || !side || amount === undefined || price === undefined) {
      return new Response(JSON.stringify({
        ok: false,
        stage: 'input',
        reason: 'bad_amount_or_price',
        error: 'Missing required fields: strategy_id, symbol, side, amount, or price'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    if (amount <= 0 || price <= 0) {
      return new Response(JSON.stringify({
        ok: false,
        stage: 'input',
        reason: 'bad_amount_or_price',
        error: 'Amount and price must be greater than 0'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    // Build normalized trade payload
    const baseSymbol = toBaseSymbol(symbol);
    const tradePayload = {
      user_id: userId,
      strategy_id: strategy_id,
      trade_type: side.toLowerCase(), // 'buy' or 'sell'
      cryptocurrency: baseSymbol, // Normalized symbol (e.g. BTC)
      amount: parseFloat(amount),
      price: parseFloat(price),
      total_value: parseFloat(amount) * parseFloat(price),
      fees: 0,
      buy_fees: side.toLowerCase() === 'buy' ? 0 : null,
      sell_fees: side.toLowerCase() === 'sell' ? 0 : null,
      is_test_mode: mode === 'mock' || mode === 'test' || true, // Default to test mode
      executed_at: new Date().toISOString(),
      notes: reasonOverride || 'coordinator'
    };

    console.log('🎯 COORDINATOR: Inserting trade:', JSON.stringify(tradePayload, null, 2));

    // Insert the trade directly into mock_trades
    const { data: insertedTrade, error: insertError } = await supabaseClient
      .from('mock_trades')
      .insert(tradePayload)
      .select('id')
      .single();

    if (insertError) {
      console.error('❌ COORDINATOR: Trade insert failed:', insertError);
      return new Response(JSON.stringify({
        ok: false,
        stage: 'insert',
        reason: 'insert_error',
        error: insertError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    console.log(`✅ COORDINATOR: Trade inserted successfully with ID: ${insertedTrade.id}`);
    
    return new Response(JSON.stringify({
      ok: true,
      trade_id: insertedTrade.id
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
    });

  } catch (error) {
    console.error('❌ COORDINATOR: Exception:', error);
    return new Response(JSON.stringify({
      ok: false,
      stage: 'exception',
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
    });
  }
});