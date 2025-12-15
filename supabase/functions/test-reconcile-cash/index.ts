// supabase/functions/test-reconcile-cash/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Hard-guarded single-user, test-mode-only reconciliation endpoint.
// Purpose: allow one-time repair + proof without cron-secret or UI work.
const ALLOWED_USER_ID = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const user_id = String(body?.user_id || '');
    const is_test_mode = body?.is_test_mode === true;

    if (!is_test_mode) {
      return new Response(JSON.stringify({ success: false, error: 'is_test_mode_required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (user_id !== ALLOWED_USER_ID) {
      return new Response(JSON.stringify({ success: false, error: 'forbidden_user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'missing_service_role_env' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: recalc, error: recalcError } = await supabase.rpc('recalculate_cash_from_trades', {
      p_user_id: user_id,
      p_is_test_mode: true,
    });

    if (recalcError) {
      return new Response(JSON.stringify({ success: false, error: recalcError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: cap, error: capError } = await supabase
      .from('portfolio_capital')
      .select('starting_capital_eur, cash_balance_eur, reserved_eur, updated_at')
      .eq('user_id', user_id)
      .single();

    if (capError) {
      return new Response(JSON.stringify({ success: false, error: capError.message, recalc }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        recalc,
        portfolio_capital: cap,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e?.message || 'unknown_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
