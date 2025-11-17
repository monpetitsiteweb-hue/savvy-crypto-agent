import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔍 LEARNING.DEBUG: Starting diagnostic scan for user', user.id);

    // 1. OHLCV Coverage Analysis
    const { data: ohlcvStats, error: ohlcvError } = await supabase
      .from('market_ohlcv_raw')
      .select('symbol, granularity, ts_utc')
      .order('ts_utc', { ascending: true });

    const ohlcvCoverage: Record<string, any> = {};
    if (ohlcvStats && !ohlcvError) {
      for (const row of ohlcvStats) {
        const key = `${row.symbol}`;
        if (!ohlcvCoverage[key]) {
          ohlcvCoverage[key] = {
            symbol: row.symbol,
            min_ts: row.ts_utc,
            max_ts: row.ts_utc,
            row_count: 0,
            granularities: new Set()
          };
        }
        ohlcvCoverage[key].max_ts = row.ts_utc;
        ohlcvCoverage[key].row_count++;
        ohlcvCoverage[key].granularities.add(row.granularity);
      }
    }

    // Convert Sets to arrays for JSON
    const ohlcvSummary = Object.values(ohlcvCoverage).map((c: any) => ({
      ...c,
      granularities: Array.from(c.granularities)
    }));

    // 2. Decision Events Coverage Analysis
    const { data: decisionStats, error: decisionsError } = await supabase
      .from('decision_events')
      .select('symbol, decision_ts, created_at')
      .eq('user_id', user.id)
      .order('decision_ts', { ascending: true });

    const decisionCoverage: Record<string, any> = {};
    if (decisionStats && !decisionsError) {
      for (const row of decisionStats) {
        // Normalize symbol to include -EUR
        const normalizedSymbol = row.symbol.includes('-') ? row.symbol : `${row.symbol}-EUR`;
        if (!decisionCoverage[normalizedSymbol]) {
          decisionCoverage[normalizedSymbol] = {
            symbol: normalizedSymbol,
            base_symbol: row.symbol,
            min_decision_ts: row.decision_ts,
            max_decision_ts: row.decision_ts,
            count: 0
          };
        }
        decisionCoverage[normalizedSymbol].max_decision_ts = row.decision_ts;
        decisionCoverage[normalizedSymbol].count++;
      }
    }

    const decisionSummary = Object.values(decisionCoverage);

    // 3. Temporal Overlap Analysis
    const overlapAnalysis = decisionSummary.map((dec: any) => {
      const ohlcv = ohlcvSummary.find((o: any) => o.symbol === dec.symbol);
      
      if (!ohlcv) {
        return {
          symbol: dec.symbol,
          has_ohlcv: false,
          has_decisions: true,
          decision_count: dec.count,
          decision_range: `${dec.min_decision_ts} to ${dec.max_decision_ts}`,
          overlap: 'NO_OHLCV_DATA'
        };
      }

      const decMin = new Date(dec.min_decision_ts);
      const decMax = new Date(dec.max_decision_ts);
      const ohlcvMin = new Date(ohlcv.min_ts);
      const ohlcvMax = new Date(ohlcv.max_ts);

      const hasOverlap = decMin <= ohlcvMax && decMax >= ohlcvMin;
      const decisionBeforeData = decMax < ohlcvMin;
      const decisionAfterData = decMin > ohlcvMax;

      return {
        symbol: dec.symbol,
        has_ohlcv: true,
        has_decisions: true,
        decision_count: dec.count,
        ohlcv_row_count: ohlcv.row_count,
        decision_range: `${dec.min_decision_ts} to ${dec.max_decision_ts}`,
        ohlcv_range: `${ohlcv.min_ts} to ${ohlcv.max_ts}`,
        granularities: ohlcv.granularities,
        overlap: hasOverlap ? 'YES' : decisionBeforeData ? 'DECISIONS_TOO_OLD' : 'DECISIONS_TOO_NEW',
        evaluation_feasible: hasOverlap
      };
    });

    // 4. Pending Decisions Analysis (sample)
    const horizons = ['15m', '1h', '4h', '24h'];
    const pendingAnalysis: Record<string, any> = {};

    for (const horizon of horizons) {
      const { data: pending, error: pendingError } = await supabase
        .rpc('get_pending_decisions_for_horizon', { horizon_key: horizon });

      if (!pendingError && pending) {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const recentCount = pending.filter((p: any) => new Date(p.decision_ts) >= thirtyDaysAgo).length;
        const oldCount = pending.length - recentCount;

        pendingAnalysis[horizon] = {
          total_pending: pending.length,
          recent_30d: recentCount,
          older_than_30d: oldCount,
          oldest_decision: pending[0]?.decision_ts,
          newest_decision: pending[pending.length - 1]?.decision_ts,
          sample_old: pending.slice(0, 3).map((p: any) => ({
            symbol: p.symbol,
            decision_ts: p.decision_ts,
            age_days: Math.floor((now.getTime() - new Date(p.decision_ts).getTime()) / (1000 * 60 * 60 * 24))
          }))
        };
      }
    }

    // 5. Outcomes vs Decisions Gap
    const { count: totalDecisions } = await supabase
      .from('decision_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    const { count: totalOutcomes } = await supabase
      .from('decision_outcomes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    const diagnostics = {
      timestamp: new Date().toISOString(),
      user_id: user.id,
      summary: {
        total_decisions: totalDecisions || 0,
        total_outcomes: totalOutcomes || 0,
        evaluation_gap: (totalDecisions || 0) * 4 - (totalOutcomes || 0), // 4 horizons per decision
        symbols_with_decisions: decisionSummary.length,
        symbols_with_ohlcv: ohlcvSummary.length
      },
      ohlcv_coverage: ohlcvSummary.slice(0, 10), // First 10 symbols
      decision_coverage: decisionSummary.slice(0, 10), // First 10 symbols
      temporal_overlap: overlapAnalysis,
      pending_by_horizon: pendingAnalysis,
      diagnosis: {
        likely_issue: overlapAnalysis.every((o: any) => o.overlap === 'DECISIONS_TOO_OLD' || o.overlap === 'NO_OHLCV_DATA')
          ? 'ALL_DECISIONS_OUTSIDE_OHLCV_COVERAGE'
          : overlapAnalysis.some((o: any) => o.overlap === 'DECISIONS_TOO_OLD')
          ? 'SOME_DECISIONS_OUTSIDE_OHLCV_COVERAGE'
          : 'UNKNOWN',
        recommendation: 'Evaluator should filter decisions to only process those within OHLCV coverage window (last 30-90 days)'
      }
    };

    console.log('✅ LEARNING.DEBUG: Diagnostic complete');
    console.log('   - Symbols with decisions:', diagnostics.summary.symbols_with_decisions);
    console.log('   - Symbols with OHLCV:', diagnostics.summary.symbols_with_ohlcv);
    console.log('   - Likely issue:', diagnostics.diagnosis.likely_issue);

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ LEARNING.DEBUG: Error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
