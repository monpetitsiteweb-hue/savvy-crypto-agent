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

    // --- parse + normalize input (support old and new payloads) ---
    const raw = await req.json().catch(() => ({} as any));

    // Back-compat: allow both shapes
    const sideInput = (raw.side ?? raw.action ?? '').toString().toLowerCase();
    const baseInput = (raw.symbol ?? raw.base ?? '').toString();

    // Validate side
    if (!['buy', 'sell'].includes(sideInput)) {
      return new Response(JSON.stringify({
        ok: false, stage: 'input', reason: 'bad_side', error: 'side/action must be buy or sell'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }});
    }

    // Normalize to BASE ticker, uppercase
    const baseSymbol = baseInput ? baseInput.toUpperCase().split('-')[0] : '';
    const qty  = Number(raw.amount);
    const px   = Number(raw.price);
    const strategyId = raw.strategy_id;

    // Derive test mode (no "always true")
    const isTestMode = (raw.testMode === true) || (['mock','test'].includes(String(raw.mode).toLowerCase()));

    // Validate required fields
    if (!strategyId || !baseSymbol || !qty || !px) {
      return new Response(JSON.stringify({
        ok: false,
        stage: 'input',
        reason: 'bad_amount_or_price',
        error: 'Missing or invalid: strategy_id, symbol/base, amount, or price'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Coord-Version': 'v2' }
      });
    }

    // Build normalized payload
    const payload = {
      user_id: userId,
      strategy_id: strategyId,
      trade_type: sideInput,               // 'buy' | 'sell' (lowercase)
      cryptocurrency: baseSymbol,          // 'BTC'
      amount: qty,
      price: px,
      total_value: qty * px,
      fees: 0,
      buy_fees: sideInput === 'buy'  ? 0 : 0,   // keep numbers for both
      sell_fees: sideInput === 'sell' ? 0 : 0,  // keep numbers for both
      is_test_mode: isTestMode,
      executed_at: new Date().toISOString(),
      notes: raw.reasonOverride || 'coordinator'
    };

    console.log('🎯 COORDINATOR: Inserting trade:', JSON.stringify(payload, null, 2));

    // Insert the trade directly into mock_trades
    const { data: insertedTrade, error: insertError } = await supabaseClient
      .from('mock_trades')
      .insert(payload)
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