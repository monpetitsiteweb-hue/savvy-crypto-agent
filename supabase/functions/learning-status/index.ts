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

    console.log('📊 LEARNING STATUS: Fetching stats for user', user.id);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // Count trade decisions from trade_decisions_log (last 7 days)
    const { count: decisionsCount, error: decisionsError } = await supabase
      .from('trade_decisions_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sevenDaysAgoISO);

    // Count decision_events (last 7 days)
    const { count: eventsCount, error: eventsError } = await supabase
      .from('decision_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sevenDaysAgoISO);

    // Count decision_outcomes (last 7 days)
    const { count: outcomesCount, error: outcomesError } = await supabase
      .from('decision_outcomes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sevenDaysAgoISO);

    // Count calibration_metrics (last 7 days)
    const { count: metricsCount, error: metricsError } = await supabase
      .from('calibration_metrics')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sevenDaysAgoISO);

    // Get last evaluator run timestamp
    const { data: lastOutcome, error: lastOutcomeError } = await supabase
      .from('decision_outcomes')
      .select('evaluated_at')
      .eq('user_id', user.id)
      .order('evaluated_at', { ascending: false })
      .limit(1)
      .single();

    // Get last aggregator run timestamp
    const { data: lastMetric, error: lastMetricError } = await supabase
      .from('calibration_metrics')
      .select('computed_at')
      .eq('user_id', user.id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single();

    // Check for errors but don't fail
    if (decisionsError) console.warn('Error fetching decisions count:', decisionsError);
    if (eventsError) console.warn('Error fetching events count:', eventsError);
    if (outcomesError) console.warn('Error fetching outcomes count:', outcomesError);
    if (metricsError) console.warn('Error fetching metrics count:', metricsError);

    const status = {
      decisions_7d: decisionsCount ?? 0,
      events_7d: eventsCount ?? 0,
      outcomes_7d: outcomesCount ?? 0,
      metrics_7d: metricsCount ?? 0,
      last_evaluator_run: lastOutcome?.evaluated_at ?? null,
      last_aggregator_run: lastMetric?.computed_at ?? null,
      loop_active: (outcomesCount ?? 0) > 0 && (metricsCount ?? 0) > 0,
      timestamp: new Date().toISOString()
    };

    console.log('✅ LEARNING STATUS:', status);

    return new Response(JSON.stringify(status), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ LEARNING STATUS ERROR:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
