import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResetRequest {
  user_id: string;
  strategy_id: string;
  symbol: string;
  breaker: string;
}

interface TripRequest {
  user_id: string;
  strategy_id: string;
  symbol: string;
  breaker: string;
  reason?: string;
  thresholds?: Record<string, any>;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    
    let body: any = {};
    try { 
      body = await req.json(); 
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const action = (body?.action ?? '').toLowerCase();

    if (action === 'reset') {
      if (!body.user_id || !body.strategy_id || !body.symbol || !body.breaker) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase.rpc('reset_breaker', {
        p_breaker: body.breaker,
        p_strategy_id: body.strategy_id,
        p_symbol: body.symbol,
        p_user_id: body.user_id,
      });

      if (error) {
        console.error('Reset breaker error:', error);
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to reset breaker' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: Boolean(data) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'trip') {
      if (!body.user_id || !body.strategy_id || !body.symbol || !body.breaker) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('execution_circuit_breakers')
        .upsert(
          {
            user_id: body.user_id,
            strategy_id: body.strategy_id,
            symbol: body.symbol,
            breaker: body.breaker,
            tripped: true,
            tripped_at: new Date().toISOString(),
            last_reason: body.reason || 'manual trip',
            thresholds: body.thresholds || {},
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,strategy_id,symbol,breaker',
            ignoreDuplicates: false,
          }
        );

      if (error) {
        console.error('Trip breaker error:', error);
        return new Response(
          JSON.stringify({ ok: false, error: 'Failed to trip breaker' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Breaker ops error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});