import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('🔧 admin-reconcile-cash: Starting cash reconciliation');

  try {
    // Security: require x-cron-secret header (admin-only access)
    const cronSecret = Deno.env.get('CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    
    if (!cronSecret || providedSecret !== cronSecret) {
      console.error('❌ admin-reconcile-cash: Unauthorized - invalid or missing x-cron-secret');
      return new Response(
        JSON.stringify({ success: false, error: 'unauthorized', reason: 'invalid_cron_secret' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { user_id, is_test_mode } = body;

    if (!user_id) {
      console.error('❌ admin-reconcile-cash: Missing user_id');
      return new Response(
        JSON.stringify({ success: false, error: 'bad_request', reason: 'missing_user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof is_test_mode !== 'boolean') {
      console.error('❌ admin-reconcile-cash: Missing or invalid is_test_mode');
      return new Response(
        JSON.stringify({ success: false, error: 'bad_request', reason: 'is_test_mode_must_be_boolean' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔧 admin-reconcile-cash: Processing user=${user_id}, is_test_mode=${is_test_mode}`);

    // Create service-role Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Call the recalculate_cash_from_trades RPC
    const { data: result, error } = await supabase.rpc('recalculate_cash_from_trades', {
      p_user_id: user_id,
      p_is_test_mode: is_test_mode
    });

    if (error) {
      console.error('❌ admin-reconcile-cash: RPC error:', error);
      return new Response(
        JSON.stringify({ success: false, error: 'rpc_error', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (result?.success === false) {
      console.error('❌ admin-reconcile-cash: RPC returned failure:', result);
      return new Response(
        JSON.stringify({ success: false, ...result }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ admin-reconcile-cash: Reconciliation complete:', JSON.stringify(result));

    // Return the proof payload
    return new Response(
      JSON.stringify({
        success: true,
        reconciliation: result,
        timestamp: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ admin-reconcile-cash: Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'unexpected_error', details: error?.message || 'unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
