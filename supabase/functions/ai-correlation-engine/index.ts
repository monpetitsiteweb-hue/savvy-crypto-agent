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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, userId, timeWindow = 4 } = await req.json();
    console.log(`🔗 AI Correlation Engine: ${action}`);

    if (action === 'analyze_correlations') {
      // Get recent unprocessed signals
      const { data: signals } = await supabaseClient
        .from('live_signals')
        .select('*')
        .eq('processed', false)
        .order('timestamp', { ascending: false })
        .limit(20);

      let correlations = 0;
      for (const signal of signals || []) {
        // Get price data around signal time
        const signalTime = new Date(signal.timestamp);
        const afterTime = new Date(signalTime.getTime() + 4 * 60 * 60 * 1000);
        
        const { data: priceData } = await supabaseClient
          .from('price_data')
          .select('*')
          .eq('symbol', signal.symbol)
          .gte('timestamp', signalTime.toISOString())
          .lte('timestamp', afterTime.toISOString())
          .order('timestamp', { ascending: true });

        if (priceData && priceData.length > 1) {
          const priceChange = ((priceData[priceData.length-1].close_price - priceData[0].close_price) / priceData[0].close_price) * 100;
          const effectiveness = signal.signal_type.includes('bullish') && priceChange > 0 ? 'positive' : 
                              signal.signal_type.includes('bearish') && priceChange < 0 ? 'positive' : 'negative';
          
          // Store learning insight
          await supabaseClient.from('ai_knowledge_base').insert([{
            user_id: userId,
            title: `Signal Correlation - ${signal.signal_type}`,
            content: `${signal.signal_type} signal ${effectiveness} - ${priceChange.toFixed(2)}% movement`,
            knowledge_type: 'signal_correlation',
            confidence_score: Math.abs(priceChange) / 10,
            data_points: 1,
            metadata: { signal, priceChange, effectiveness }
          }]);
          
          correlations++;
        }
        
        // Mark signal as processed
        await supabaseClient.from('live_signals').update({ processed: true }).eq('id', signal.id);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        correlations_analyzed: correlations,
        message: `Analyzed ${correlations} signal correlations`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ AI Correlation Engine error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});