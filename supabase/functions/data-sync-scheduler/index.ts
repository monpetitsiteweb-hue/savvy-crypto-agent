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

    const { schedule_type = 'intraday' } = await req.json() || {};
    console.log(`⏰ Data Sync Scheduler triggered for: ${schedule_type}`);

    // Get all active data sources
    const { data: dataSources } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .eq('is_active', true);

    if (!dataSources || dataSources.length === 0) {
      console.log('No active data sources found');
      return new Response(JSON.stringify({ 
        message: 'No active data sources to sync',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results = [];

    for (const source of dataSources) {
      try {
        let syncResult;
        
        switch (source.source_name) {
          case 'eodhd_api':
            syncResult = await syncEODHDData(supabaseClient, source, schedule_type);
            break;
          case 'cryptonews_api':
            syncResult = await syncCryptoNewsData(supabaseClient, source, schedule_type);
            break;
          case 'bigquery':
            syncResult = await syncBigQueryData(supabaseClient, source, schedule_type);
            break;
          default:
            console.log(`Skipping unsupported source: ${source.source_name}`);
            continue;
        }
        
        results.push({
          source: source.source_name,
          status: 'success',
          result: syncResult
        });
        
        // Update last_sync timestamp
        await supabaseClient
          .from('ai_data_sources')
          .update({ last_sync: new Date().toISOString() })
          .eq('id', source.id);
          
      } catch (error) {
        console.error(`Error syncing ${source.source_name}:`, error);
        results.push({
          source: source.source_name,
          status: 'error',
          error: error.message
        });
      }
    }

    // Trigger AI learning after data sync
    if (results.some(r => r.status === 'success')) {
      try {
        await triggerAILearning(supabaseClient);
      } catch (error) {
        console.error('Error triggering AI learning:', error);
      }
    }

    return new Response(JSON.stringify({ 
      message: 'Data sync scheduler completed',
      schedule_type,
      timestamp: new Date().toISOString(),
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in data sync scheduler:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function syncEODHDData(supabaseClient: any, source: any, scheduleType: string) {
  console.log(`📊 Syncing EODHD data for schedule: ${scheduleType}`);
  
  const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR']; // Default symbols
  
  let action;
  let params = {
    symbols,
    userId: source.user_id,
    sourceId: source.id
  };
  
  switch (scheduleType) {
    case 'intraday': // Every 2 minutes
      action = 'fetch_intraday_data';
      params = { ...params, interval: '5m' };
      break;
    case 'realtime': // Every 30 seconds
      action = 'fetch_real_time_data';
      break;
    case 'daily': // Once per day
      action = 'fetch_eod_data';
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      params = { 
        ...params, 
        startDate: yesterday.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0]
      };
      break;
    default:
      action = 'fetch_intraday_data';
  }
  
  const response = await supabaseClient.functions.invoke('eodhd-collector', {
    body: { action, ...params }
  });
  
  return response.data;
}

async function syncCryptoNewsData(supabaseClient: any, source: any, scheduleType: string) {
  console.log(`📰 Syncing CryptoNews data for schedule: ${scheduleType}`);
  
  // Only sync news on certain schedules
  if (!['news', 'intraday'].includes(scheduleType)) {
    return { skipped: true, reason: 'Not a news sync schedule' };
  }
  
  const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];
  const timeframe = scheduleType === 'news' ? '1h' : '3h';
  
  const response = await supabaseClient.functions.invoke('crypto-news-collector', {
    body: {
      action: 'fetch_latest_news',
      symbols,
      timeframe,
      userId: source.user_id,
      sourceId: source.id
    }
  });
  
  return response.data;
}

async function syncBigQueryData(supabaseClient: any, source: any, scheduleType: string) {
  console.log(`🏦 Syncing BigQuery data for schedule: ${scheduleType}`);
  
  // Only sync BigQuery on daily or weekly schedules
  if (!['daily', 'weekly'].includes(scheduleType)) {
    return { skipped: true, reason: 'Not a BigQuery sync schedule' };
  }
  
  const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];
  
  let action;
  let params = {
    symbols,
    userId: source.user_id,
    sourceId: source.id
  };
  
  if (scheduleType === 'weekly') {
    action = 'fetch_historical_data';
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7); // Last 7 days
    
    params = {
      ...params,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    };
  } else {
    action = 'sync_daily_data';
  }
  
  const response = await supabaseClient.functions.invoke('bigquery-collector', {
    body: { action, ...params }
  });
  
  return response.data;
}

async function triggerAILearning(supabaseClient: any) {
  console.log(`🧠 Triggering AI learning after data sync`);
  
  try {
    const response = await supabaseClient.functions.invoke('ai-learning-engine', {
      body: {
        action: 'analyze_correlations',
        trigger: 'scheduled_sync'
      }
    });
    
    console.log(`✅ AI learning triggered successfully`);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to trigger AI learning:', error);
    throw error;
  }
}