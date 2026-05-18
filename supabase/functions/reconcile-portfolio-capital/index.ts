// Gap #25 — Periodic reconciliation of portfolio_capital.cash_balance_eur
// against expected cash computed from mock_trades.
// Read + alert only. No side effect on portfolio_capital, decision_events,
// circuit breakers, or strategies (option 4-A passive).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const ALERT_THRESHOLD_EUR = 0.10; // hardcoded per Q2

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Symmetric with onchain-receipts-poller (jobid 42 pattern)
  const cronSecret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!cronSecret || provided !== cronSecret) {
    console.error('[reconcile] unauthorized: missing or bad x-cron-secret');
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const startedAt = new Date().toISOString();
  console.log(`[reconcile] start at ${startedAt}`);

  const { data: rows, error } = await supabase.rpc('reconcile_portfolio_capital');
  if (error) {
    console.error('[reconcile] RPC error:', error);
    return new Response(
      JSON.stringify({ error: 'rpc_failed', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const rows_checked = rows?.length ?? 0;
  let alerts_emitted = 0;

  for (const r of (rows ?? [])) {
    // FULL_SNAPSHOT structured log (one line per portfolio)
    console.log('[reconcile] FULL_SNAPSHOT', JSON.stringify(r));

    const delta = Number(r.delta_eur);
    if (Number.isFinite(delta) && Math.abs(delta) > ALERT_THRESHOLD_EUR) {
      const { error: insErr } = await supabase
        .from('reconciliation_alerts')
        .insert({
          user_id: r.user_id,
          is_test_mode: r.is_test_mode,
          actual_cash_eur: r.actual_cash_eur,
          expected_cash_eur: r.expected_cash_eur,
          delta_eur: r.delta_eur,
          threshold_eur: ALERT_THRESHOLD_EUR,
          n_buys: r.n_buys,
          n_sells: r.n_sells,
          sum_buys: r.sum_buys,
          sum_sells: r.sum_sells,
          sum_fees: Number(r.sum_buy_fees) + Number(r.sum_sell_fees),
          sum_gas_eur: r.sum_gas_eur,
          starting_capital_eur: r.starting_capital_eur,
          notes: 'auto-emitted by reconcile-portfolio-capital cron',
        });
      if (insErr) {
        console.error('[reconcile] insert alert failed:', insErr);
      } else {
        alerts_emitted++;
        console.log(`[reconcile] ALERT user=${r.user_id} mode=${r.is_test_mode} delta=${delta.toFixed(4)}`);
      }
    }
  }

  console.log(`[reconcile] done: rows_checked=${rows_checked} alerts_emitted=${alerts_emitted}`);
  return new Response(
    JSON.stringify({ rows_checked, alerts_emitted, threshold_eur: ALERT_THRESHOLD_EUR, started_at: startedAt }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
