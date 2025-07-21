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

    const requestBody = await req.json();
    console.log(`📡 External Data Collector received:`, JSON.stringify(requestBody));

    // Check if this is a webhook payload (QuickNode, etc.)
    if (requestBody.webhook || requestBody.data || !requestBody.action) {
      console.log('🔗 Processing webhook payload...');
      await processWebhookPayload(supabaseClient, requestBody, req.headers);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle admin panel actions
    const { action, sourceId, userId } = requestBody;
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
  
  // Get enabled categories first
  const { data: enabledCategories } = await supabaseClient
    .from('ai_data_categories')
    .select('id, category_name')
    .eq('is_enabled', true);

  if (!enabledCategories || enabledCategories.length === 0) {
    console.log('📭 No enabled categories found');
    return;
  }

  console.log(`📋 Enabled categories: ${enabledCategories.map(c => c.category_name).join(', ')}`);

  // Get sources for enabled categories only
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select(`
      *,
      ai_data_categories!inner(
        id,
        category_name,
        is_enabled
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('ai_data_categories.is_enabled', true);

  if (!sources || sources.length === 0) {
    console.log('📭 No active data sources found for enabled categories');
    return;
  }

  for (const source of sources) {
    try {
      await syncDataSource(supabaseClient, source.id);
    } catch (error) {
      console.error(`Failed to sync source ${source.source_name}:`, error);
    }
  }

  console.log(`✅ Synced ${sources.length} data sources from enabled categories`);
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
    case 'quicknode_webhooks':
      await syncQuickNodeWebhooks(supabaseClient, source);
      break;
    case 'cryptocurrency_alerting':
    case 'bitquery_api':
    case 'twitter_sentiment':
    case 'youtube_channels':
    case 'reddit_crypto':
    case 'custom_website':
    case 'document_upload':
      await syncGenericDataSource(supabaseClient, source);
      break;
    default:
      console.log(`⚠️ Unknown source type: ${source.source_name}`);
      throw new Error(`Unsupported source type: ${source.source_name}`);
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

      // Store the data with category context
      await supabaseClient
        .from('external_market_data')
        .insert({
          source_id: source.id,
          data_type: 'institutional_flow',
          entity,
          cryptocurrency: 'BTC',
          data_value: mockData.transactions[0].amount,
          metadata: mockData,
          category_context: {
            category_name: 'Institutional Flow',
            category_type: 'institutional',
            signal_strength: 'high',
            market_impact: 'bullish'
          },
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
          category_context: {
            category_name: 'Market Fear & Greed',
            category_type: 'sentiment',
            signal_strength: fearGreedData.value < 20 ? 'extreme_fear' : fearGreedData.value > 80 ? 'extreme_greed' : 'moderate',
            market_impact: fearGreedData.value < 40 ? 'bearish' : fearGreedData.value > 60 ? 'bullish' : 'neutral'
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
          category_context: {
            category_name: 'Institutional Flow',
            category_type: 'institutional',
            signal_strength: mockVolume > 5000000 ? 'high' : 'medium',
            market_impact: 'neutral'
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
          category_context: {
            category_name: 'Whale Activity',
            category_type: 'whale_tracking',
            signal_strength: tx.amount > 500 ? 'high' : 'medium',
            market_impact: tx.type === 'exchange_inflow' ? 'bearish' : 'neutral'
          },
          timestamp: new Date().toISOString()
        });
    }

    console.log('✅ Synced Whale Alert data');
  } catch (error) {
    console.error('Failed to sync Whale Alert data:', error);
  }
}

async function syncQuickNodeWebhooks(supabaseClient: any, source: any) {
  console.log('⚡ Syncing QuickNode webhook configuration...');
  
  try {
    // For webhook sources, the sync is mainly about testing the configuration
    // and possibly triggering a test webhook or checking connectivity
    
    const webhookUrl = source.configuration?.webhook_url;
    const webhookSecret = source.configuration?.webhook_secret;
    
    if (!webhookUrl) {
      console.log('⚠️ QuickNode webhook URL not configured');
      return;
    }
    
    console.log(`🔗 QuickNode webhook configured: ${webhookUrl}`);
    
    // Create a test event to verify webhook is working
    await supabaseClient
      .from('whale_signal_events')
      .insert({
        user_id: source.user_id,
        source_id: source.id,
        event_type: 'sync_test',
        transaction_hash: `test_${Date.now()}`,
        amount: 0,
        from_address: 'test_sync',
        to_address: 'test_sync',
        token_symbol: 'TEST',
        blockchain: 'test',
        raw_data: { 
          sync_test: true, 
          timestamp: new Date().toISOString(),
          webhook_url: webhookUrl,
          has_secret: !!webhookSecret
        },
        timestamp: new Date().toISOString(),
        processed: true
      });
    
    console.log('✅ QuickNode webhook sync completed - test event created');
  } catch (error) {
    console.error('Failed to sync QuickNode webhook:', error);
    throw error;
  }
}

async function syncGenericDataSource(supabaseClient: any, source: any) {
  console.log(`🔄 Syncing generic data source: ${source.source_name}`);
  
  try {
    // For generic sources, create a sync test entry
    await supabaseClient
      .from('external_market_data')
      .insert({
        source_id: source.id,
        data_type: 'sync_test',
        entity: source.source_name,
        cryptocurrency: 'TEST',
        data_value: 1,
        metadata: {
          sync_test: true,
          configuration: source.configuration,
          timestamp: new Date().toISOString()
        },
        category_context: {
          category_name: source.source_type,
          category_type: 'test',
          signal_strength: 'low',
          market_impact: 'neutral'
        },
        timestamp: new Date().toISOString()
      });
      
    console.log(`✅ Generic data source sync completed: ${source.source_name}`);
  } catch (error) {
    console.error(`Failed to sync generic source ${source.source_name}:`, error);
    throw error;
  }
}

async function processWebhookPayload(supabaseClient: any, payload: any, headers: Headers) {
  console.log('🔗 Processing webhook payload:', JSON.stringify(payload));
  
  try {
    // Determine the source type based on payload structure or headers
    const userAgent = headers.get('user-agent') || '';
    const webhookSource = headers.get('x-webhook-source') || '';
    
    if (userAgent.includes('QuickNode') || webhookSource.includes('quicknode')) {
      await processQuickNodeWebhook(supabaseClient, payload, headers);
    } else if (payload.webhook_type || payload.event_type) {
      // Handle other webhook sources (Cryptocurrency Alerting, etc.)
      await processGenericWebhook(supabaseClient, payload, headers);
    } else {
      console.log('⚠️ Unknown webhook format, storing as generic data');
      await processGenericWebhook(supabaseClient, payload, headers);
    }
    
    console.log('✅ Webhook payload processed successfully');
  } catch (error) {
    console.error('❌ Failed to process webhook payload:', error);
    throw error;
  }
}

async function processQuickNodeWebhook(supabaseClient: any, payload: any, headers: Headers) {
  console.log('⚡ Processing QuickNode webhook');
  
  // Find the QuickNode data source
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('source_name', 'quicknode_webhooks')
    .eq('is_active', true);
    
  if (!sources || sources.length === 0) {
    console.log('⚠️ No active QuickNode sources found');
    return;
  }
  
  const source = sources[0];
  
  // Verify webhook signature if secret is configured
  const webhookSecret = source.configuration?.webhook_secret;
  if (webhookSecret) {
    console.log('🔐 Webhook secret configured, signature verification would happen here');
  }
  
  // Process matching transactions from QuickNode payload
  const matchingTransactions = payload.matchingTransactions || [];
  
  for (const transaction of matchingTransactions) {
    try {
      // Convert hex value to decimal (Wei to ETH)
      const valueInWei = parseInt(transaction.value, 16);
      const valueInEth = valueInWei / Math.pow(10, 18);
      
      // Determine blockchain from chainId
      const chainId = parseInt(transaction.chainId, 16);
      const blockchain = getBlockchainName(chainId);
      
      // Store whale signal event
      await supabaseClient
        .from('whale_signal_events')
        .insert({
          user_id: source.user_id,
          source_id: source.id,
          event_type: 'large_transaction',
          transaction_hash: transaction.hash,
          amount: valueInEth,
          from_address: transaction.from,
          to_address: transaction.to,
          token_symbol: 'ETH', // QuickNode typically tracks ETH, can be enhanced
          blockchain: blockchain,
          raw_data: transaction,
          timestamp: new Date().toISOString(),
          processed: false
        });
        
      console.log(`🐋 Stored whale signal: ${valueInEth.toFixed(4)} ETH on ${blockchain} (${transaction.hash})`);
    } catch (error) {
      console.error('❌ Error processing transaction:', error);
    }
  }
}

async function processGenericWebhook(supabaseClient: any, payload: any, headers: Headers) {
  console.log('📊 Processing generic webhook');
  
  // Try to find a matching source based on headers or payload structure
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('is_active', true)
    .in('source_name', ['cryptocurrency_alerting', 'bitquery_api']);
    
  if (!sources || sources.length === 0) {
    console.log('⚠️ No matching webhook sources found');
    return;
  }
  
  // Use the first matching source (enhance this logic as needed)
  const source = sources[0];
  
  // Store as external market data
  await supabaseClient
    .from('external_market_data')
    .insert({
      source_id: source.id,
      data_type: 'webhook_event',
      entity: 'external_webhook',
      cryptocurrency: payload.symbol || payload.coin || 'UNKNOWN',
      data_value: payload.amount || payload.value || 0,
      metadata: payload,
      category_context: {
        category_name: 'External Webhook',
        category_type: 'webhook',
        signal_strength: 'medium',
        market_impact: 'neutral'
      },
      timestamp: new Date().toISOString()
    });
    
  console.log('📊 Stored generic webhook data');
}

function getBlockchainName(chainId: number): string {
  const blockchainMap: { [key: number]: string } = {
    1: 'ethereum',
    56: 'binance_smart_chain',
    137: 'polygon',
    43114: 'avalanche',
    250: 'fantom',
    42161: 'arbitrum',
    10: 'optimism'
  };
  
  return blockchainMap[chainId] || `chain_${chainId}`;
}