import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const { action, sourceId, userId } = await req.json();
    console.log(`📡 External Data Collector: ${action} for user ${userId}`);

    if (action === 'sync_all_sources') {
      await syncAllDataSources(supabaseClient, userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'sync_source') {
      await syncDataSource(supabaseClient, sourceId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('External Data Collector Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function syncAllDataSources(supabaseClient: any, userId: string) {
  console.log('🔄 Syncing all data sources...');
  
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (!sources || sources.length === 0) {
    console.log('📭 No active data sources found');
    return;
  }

  for (const source of sources) {
    try {
      await syncDataSource(supabaseClient, source.id);
    } catch (error) {
      console.error(`Failed to sync source ${source.source_name}:`, error);
    }
  }

  console.log(`✅ Synced ${sources.length} data sources`);
}

async function syncDataSource(supabaseClient: any, sourceId: string) {
  const { data: source } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (!source) throw new Error('Data source not found');

  console.log(`🔄 Syncing ${source.source_name}...`);

  switch (source.source_name) {
    case 'arkham_intelligence':
      await syncArkhemIntelligence(supabaseClient, source);
      break;
    case 'fear_greed_index':
      await syncFearGreedIndex(supabaseClient, source);
      break;
    case 'coinbase_institutional':
      await syncCoinbaseInstitutional(supabaseClient, source);
      break;
    case 'whale_alerts':
      await syncWhaleAlerts(supabaseClient, source);
      break;
    default:
      console.log(`⚠️ Unknown source type: ${source.source_name}`);
  }

  // Update last sync time
  await supabaseClient
    .from('ai_data_sources')
    .update({ last_sync: new Date().toISOString() })
    .eq('id', sourceId);
}

async function syncArkhemIntelligence(supabaseClient: any, source: any) {
  const apiKey = source.configuration?.api_key;
  if (!apiKey) {
    console.log('⚠️ Arkham Intelligence API key not configured');
    return;
  }

  // Example: Fetch whale transactions for tracked entities
  const entities = ['blackrock', 'microstrategy', 'tesla'];
  
  for (const entity of entities) {
    try {
      // This would be the actual Arkham API call
      // const response = await fetch(`${source.api_endpoint}/entity/${entity}/transactions`, {
      //   headers: { 'Authorization': `Bearer ${apiKey}` }
      // });
      
      // Mock data for demonstration
      const mockData = {
        entity,
        transactions: [
          {
            amount: 1000000,
            cryptocurrency: 'BTC',
            type: 'inflow',
            timestamp: new Date().toISOString()
          }
        ]
      };

      // Store the data
      await supabaseClient
        .from('external_market_data')
        .insert({
          source_id: source.id,
          data_type: 'institutional_flow',
          entity,
          cryptocurrency: 'BTC',
          data_value: mockData.transactions[0].amount,
          metadata: mockData,
          timestamp: new Date().toISOString()
        });

      console.log(`✅ Synced Arkham data for ${entity}`);
    } catch (error) {
      console.error(`Failed to sync Arkham data for ${entity}:`, error);
    }
  }
}

async function syncFearGreedIndex(supabaseClient: any, source: any) {
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await response.json();
    
    if (data.data && data.data[0]) {
      const fearGreedData = data.data[0];
      
      await supabaseClient
        .from('external_market_data')
        .insert({
          source_id: source.id,
          data_type: 'sentiment_score',
          entity: 'market_sentiment',
          cryptocurrency: 'ALL',
          data_value: parseInt(fearGreedData.value),
          metadata: {
            classification: fearGreedData.value_classification,
            timestamp: fearGreedData.timestamp
          },
          timestamp: new Date().toISOString()
        });

      console.log(`✅ Synced Fear & Greed Index: ${fearGreedData.value} (${fearGreedData.value_classification})`);
    }
  } catch (error) {
    console.error('Failed to sync Fear & Greed Index:', error);
  }
}

async function syncCoinbaseInstitutional(supabaseClient: any, source: any) {
  try {
    // Mock institutional flow data
    const cryptos = ['BTC-USD', 'ETH-USD'];
    
    for (const crypto of cryptos) {
      const mockVolume = Math.random() * 10000000; // Random volume
      
      await supabaseClient
        .from('external_market_data')
        .insert({
          source_id: source.id,
          data_type: 'institutional_flow',
          entity: 'coinbase_institutional',
          cryptocurrency: crypto.split('-')[0],
          data_value: mockVolume,
          metadata: {
            product_id: crypto,
            volume_24h: mockVolume,
            type: 'institutional_volume'
          },
          timestamp: new Date().toISOString()
        });
    }

    console.log('✅ Synced Coinbase institutional data');
  } catch (error) {
    console.error('Failed to sync Coinbase institutional data:', error);
  }
}

async function syncWhaleAlerts(supabaseClient: any, source: any) {
  const apiKey = source.configuration?.api_key;
  if (!apiKey) {
    console.log('⚠️ Whale Alert API key not configured');
    return;
  }

  try {
    // Mock whale transaction data
    const mockTransactions = [
      {
        amount: 1000,
        cryptocurrency: 'BTC',
        from: 'unknown',
        to: 'binance',
        type: 'exchange_inflow'
      },
      {
        amount: 50000000,
        cryptocurrency: 'USDT',
        from: 'tether',
        to: 'unknown',
        type: 'mint'
      }
    ];

    for (const tx of mockTransactions) {
      await supabaseClient
        .from('external_market_data')
        .insert({
          source_id: source.id,
          data_type: 'whale_transaction',
          entity: 'whale_movements',
          cryptocurrency: tx.cryptocurrency,
          data_value: tx.amount,
          metadata: tx,
          timestamp: new Date().toISOString()
        });
    }

    console.log('✅ Synced Whale Alert data');
  } catch (error) {
    console.error('Failed to sync Whale Alert data:', error);
  }
}