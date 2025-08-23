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

    const { symbol, startTime, endTime } = await req.json();
    
    console.log(`📊 SNAPSHOTS: Fetching price data for ${symbol} from ${startTime} to ${endTime}`);
    
    // Fetch historical price data from Coinbase Pro API
    const coinbaseSymbol = symbol.includes('-') ? symbol : `${symbol}-EUR`;
    const start = new Date(startTime).toISOString();
    const end = new Date(endTime).toISOString();
    
    // Get 1-minute candles from Coinbase Pro
    const url = `https://api.exchange.coinbase.com/products/${coinbaseSymbol}/candles?start=${start}&end=${end}&granularity=60`;
    
    console.log(`🔗 SNAPSHOTS: Fetching from ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Coinbase API error: ${response.status} ${response.statusText}`);
    }
    
    const candles = await response.json();
    console.log(`📈 SNAPSHOTS: Got ${candles.length} candles for ${symbol}`);
    
    // Transform candles to price snapshots
    // Coinbase format: [time, low, high, open, close, volume]
    const snapshots = candles.map((candle: any[]) => ({
      symbol: symbol.replace('-EUR', ''), // Normalize to base symbol
      ts: new Date(candle[0] * 1000).toISOString(), // Convert Unix timestamp
      price: parseFloat(candle[4]) // Close price
    }));
    
    // Insert snapshots in batches
    let inserted = 0;
    const batchSize = 100;
    
    for (let i = 0; i < snapshots.length; i += batchSize) {
      const batch = snapshots.slice(i, i + batchSize);
      
      const { error } = await supabaseClient
        .from('price_snapshots')
        .upsert(batch, { onConflict: 'symbol,ts' });
      
      if (error) {
        console.error('❌ SNAPSHOTS: Insert error:', error);
        throw error;
      }
      
      inserted += batch.length;
    }
    
    console.log(`✅ SNAPSHOTS: Inserted ${inserted} price snapshots for ${symbol}`);
    
    return new Response(JSON.stringify({
      success: true,
      symbol,
      snapshots_inserted: inserted,
      price_range: {
        min: Math.min(...snapshots.map(s => s.price)),
        max: Math.max(...snapshots.map(s => s.price))
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ SNAPSHOTS: Error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});