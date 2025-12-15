import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// UUID v4 regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Safety flag: set to true ONLY when real-mode reconciliation is explicitly needed
const ALLOW_REAL_MODE = false;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SECURITY: Reject non-POST requests
  if (req.method !== 'POST') {
    console.error(`❌ admin-reconcile-cash: Method ${req.method} not allowed`);
    return new Response(
      JSON.stringify({ success: false, error: 'method_not_allowed', reason: 'only_post_accepted' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('🔧 admin-reconcile-cash: Starting cash reconciliation');

  try {
    // SECURITY: require x-cron-secret header (admin-only access)
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

    // SECURITY: Validate user_id is a valid UUID
    if (!user_id || typeof user_id !== 'string' || !UUID_REGEX.test(user_id)) {
      console.error('❌ admin-reconcile-cash: Invalid user_id - must be valid UUID');
      return new Response(
        JSON.stringify({ success: false, error: 'bad_request', reason: 'user_id_must_be_valid_uuid' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: Validate is_test_mode is boolean
    if (typeof is_test_mode !== 'boolean') {
      console.error('❌ admin-reconcile-cash: Missing or invalid is_test_mode');
      return new Response(
        JSON.stringify({ success: false, error: 'bad_request', reason: 'is_test_mode_must_be_boolean' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: Block REAL mode reconciliation unless explicitly allowed
    if (is_test_mode === false && !ALLOW_REAL_MODE) {
      console.error('❌ admin-reconcile-cash: REAL mode reconciliation is disabled');
      return new Response(
        JSON.stringify({ success: false, error: 'forbidden', reason: 'real_mode_reconciliation_disabled' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔧 admin-reconcile-cash: Processing user=${user_id}, is_test_mode=${is_test_mode}`);

    // Create service-role Supabase client (NEVER anon key)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // AUDIT: Log reconciliation attempt to decision_events
    const auditPayload = {
      user_id: user_id,
      strategy_id: '00000000-0000-0000-0000-000000000000', // system event
      symbol: 'SYSTEM',
      side: 'ADMIN',
      source: 'admin-reconcile-cash',
      reason: 'admin_reconcile_cash_called',
      confidence: 0,
      metadata: {
        is_test_mode,
        triggered_at: new Date().toISOString(),
        action: 'cash_reconciliation'
      }
    };

    await supabase.from('decision_events').insert(auditPayload);
    console.log('📝 admin-reconcile-cash: Audit event logged');

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
