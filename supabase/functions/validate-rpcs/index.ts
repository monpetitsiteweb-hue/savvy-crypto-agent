/**
 * RPC Validation Edge Function - GUARDRAIL #1
 * Validates canonical RPCs execute without error at deploy-time.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const testUserId = '00000000-0000-0000-0000-000000000000';
  const results: { rpc: string; ok: boolean; error?: string }[] = [];

  // Test both modes
  for (const mode of [true, false]) {
    const start = Date.now();
    const { error } = await supabase.rpc('get_portfolio_metrics' as any, {
      p_user_id: testUserId,
      p_is_test_mode: mode,
    });
    
    results.push({
      rpc: `get_portfolio_metrics(test=${mode})`,
      ok: !error,
      error: error?.message,
    });
  }

  const allPassed = results.every(r => r.ok);
  
  return new Response(JSON.stringify({
    allPassed,
    results,
    message: allPassed ? '✅ RPCs validated' : '❌ DEPLOY BLOCKED',
  }), {
    status: allPassed ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});
