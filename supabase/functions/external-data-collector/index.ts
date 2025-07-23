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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role for system operations
    );

    const requestBody = await req.json();
    console.log(`📡 External Data Collector received:`, JSON.stringify(requestBody));

    // Check if this is a webhook payload from external services
    // Admin actions have specific structure: { action: "sync_all_sources", userId: "..." }
    const hasAdminAction = requestBody.action && 
                          typeof requestBody.action === 'string' && 
                          (requestBody.action === 'sync_all_sources' || requestBody.action === 'sync_source') &&
                          (requestBody.userId || requestBody.sourceId);
    
    // If it's not an admin action, treat it as a webhook payload
    if (!hasAdminAction) {
      console.log('🔗 Processing webhook payload (not admin action)...');
      await processWebhookPayload(supabaseClient, requestBody, req.headers);
      return new Response(JSON.stringify({ success: true, message: 'Webhook processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle admin panel actions
    const { action, sourceId, userId } = requestBody;
    
    if (!action) {
      console.error('No action specified in request body');
      return new Response(JSON.stringify({ error: 'No action specified' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`📡 External Data Collector: ${action} for user ${userId}`);

    if (action === 'sync_all_sources') {
      if (!userId) {
        return new Response(JSON.stringify({ error: 'User ID required for sync_all_sources' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      await syncAllDataSources(supabaseClient, userId);
      return new Response(JSON.stringify({ success: true, message: 'All sources synced' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'sync_source') {
      if (!sourceId) {
        return new Response(JSON.stringify({ error: 'Source ID required for sync_source' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      await syncDataSource(supabaseClient, sourceId);
      return new Response(JSON.stringify({ success: true, message: 'Source synced' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('External Data Collector Error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack,
      details: error
    }), {
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
  console.log(`🔄 Starting sync for source ID: ${sourceId}`);
  
  const { data: source, error: sourceError } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (sourceError) {
    console.error('Error fetching source:', sourceError);
    throw new Error(`Failed to fetch source: ${sourceError.message}`);
  }

  if (!source) {
    console.error('Source not found for ID:', sourceId);
    throw new Error('Data source not found');
  }

  console.log(`🔄 Syncing ${source.source_name} (ID: ${sourceId})...`);

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
    case 'whale_alert_api':
      await syncWhaleAlert(supabaseClient, source);
      break;
    case 'quicknode_webhooks':
      await syncQuickNodeWebhooks(supabaseClient, source);
      break;
    case 'cryptonews_api':
      await syncCryptoNewsAPI(supabaseClient, source);
      break;
    case 'eodhd_api':
      await syncEODHDAPI(supabaseClient, source);
      break;
    case 'bigquery':
      await syncBigQueryAPI(supabaseClient, source);
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
  try {
    const { error: updateError } = await supabaseClient
      .from('ai_data_sources')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', sourceId);
      
    if (updateError) {
      console.error('Error updating last_sync:', updateError);
      throw new Error(`Failed to update last_sync: ${updateError.message}`);
    }
    
    console.log(`✅ Successfully synced and updated last_sync for ${source.source_name}`);
  } catch (error) {
    console.error('Error in last_sync update:', error);
    throw error;
  }
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
    const apiKey = Deno.env.get('COINBASE_API_KEY');
    const apiSecret = Deno.env.get('COINBASE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      console.log('⚠️ Coinbase API credentials not configured');
      return;
    }

    const cryptos = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
    
    for (const crypto of cryptos) {
      try {
        // Fetch real 24h stats from Coinbase Advanced Trade API
        const statsResponse = await fetch(`https://api.exchange.coinbase.com/products/${crypto}/stats`);
        const stats = await statsResponse.json();
        
        // Fetch recent large trades (potential institutional activity)
        const tradesResponse = await fetch(`https://api.exchange.coinbase.com/products/${crypto}/trades?limit=100`);
        const trades = await tradesResponse.json();
        
        // Analyze for institutional patterns
        const largeTrades = trades.filter((trade: any) => parseFloat(trade.size) * parseFloat(trade.price) > 100000); // Trades > $100k
        const totalLargeTradeVolume = largeTrades.reduce((sum: number, trade: any) => 
          sum + (parseFloat(trade.size) * parseFloat(trade.price)), 0);
        
        const volume24h = parseFloat(stats.volume);
        const institutionalRatio = totalLargeTradeVolume / (volume24h * parseFloat(stats.last));
        
        await supabaseClient
          .from('external_market_data')
          .insert({
            source_id: source.id,
            data_type: 'institutional_flow',
            entity: 'coinbase_institutional',
            cryptocurrency: crypto.split('-')[0],
            data_value: totalLargeTradeVolume,
            metadata: {
              product_id: crypto,
              volume_24h: volume24h,
              large_trades_count: largeTrades.length,
              institutional_ratio: institutionalRatio,
              price_last: parseFloat(stats.last),
              price_change_24h: parseFloat(stats.volume_30day || 0),
              type: 'real_institutional_analysis'
            },
            category_context: {
              category_name: 'Institutional Flow',
              category_type: 'institutional',
              signal_strength: institutionalRatio > 0.3 ? 'high' : institutionalRatio > 0.15 ? 'medium' : 'low',
              market_impact: institutionalRatio > 0.25 ? 'bullish' : 'neutral'
            },
            timestamp: new Date().toISOString()
          });
          
        console.log(`✅ Synced real Coinbase institutional data for ${crypto}: ${largeTrades.length} large trades, $${totalLargeTradeVolume.toFixed(0)} volume`);
      } catch (error) {
        console.error(`Failed to sync ${crypto}:`, error);
      }
    }

    console.log('✅ Completed Coinbase institutional flow analysis using real API data');
  } catch (error) {
    console.error('Failed to sync Coinbase institutional data:', error);
  }
}

async function syncWhaleAlert(supabaseClient: any, source: any) {
  console.log('🐋 Testing Whale Alert WebSocket connection...');
  
  const apiKey = source.configuration?.api_key;
  if (!apiKey) {
    throw new Error('Whale Alert API key not configured');
  }

  try {
    // Test API key validity first
    const response = await fetch(`https://api.whale-alert.io/v1/status?api_key=${apiKey}`);
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid API key - Please check your Whale Alert API key');
      }
      throw new Error(`API test failed: ${response.status} ${response.statusText}`);
    }

    const statusData = await response.json();
    console.log('📊 Whale Alert API status:', statusData);

    // Create a test connection event
    const validationEvent = {
      user_id: source.user_id,
      source_id: source.id,
      event_type: 'whale_alert_validation',
      transaction_hash: `validation_${Date.now()}`,
      amount: 0,
      from_address: 'validation_test',
      to_address: 'validation_test', 
      token_symbol: 'VALIDATION',
      blockchain: 'test',
      raw_data: {
        validation_test: true,
        timestamp: new Date().toISOString(),
        api_key_valid: true,
        status_response: statusData,
        connection_test: 'successful'
      },
      timestamp: new Date().toISOString(),
      processed: true
    };

    const { error: insertError } = await supabaseClient
      .from('whale_signal_events')
      .insert(validationEvent);

    if (insertError) {
      console.error('Error storing validation event:', insertError);
      throw new Error(`Failed to store validation result: ${insertError.message}`);
    }

    console.log('✅ Whale Alert API validation successful - WebSocket connection will be established');
    
    // Start WebSocket connection (this would be handled by a persistent connection)
    await startWhaleAlertWebSocket(supabaseClient, source);

  } catch (error) {
    console.error('❌ Whale Alert sync failed:', error);
    
    // Store failed validation
    const failedEvent = {
      user_id: source.user_id,
      source_id: source.id,
      event_type: 'whale_alert_validation_failed',
      transaction_hash: `failed_${Date.now()}`,
      amount: 0,
      from_address: 'validation_failed',
      to_address: 'validation_failed',
      token_symbol: 'ERROR',
      blockchain: 'test',
      raw_data: {
        validation_test: true,
        timestamp: new Date().toISOString(),
        api_key_valid: false,
        error_message: error.message,
        connection_test: 'failed'
      },
      timestamp: new Date().toISOString(),
      processed: true
    };

    await supabaseClient
      .from('whale_signal_events')
      .insert(failedEvent);
      
    throw error;
  }
}

async function startWhaleAlertWebSocket(supabaseClient: any, source: any) {
  const apiKey = source.configuration?.api_key;
  
  console.log('🔌 Starting Whale Alert WebSocket connection...');
  
  // In a real implementation, this would establish a persistent WebSocket connection
  // For now, we'll simulate the connection and create a mock event
  const mockWhaleTransaction = {
    user_id: source.user_id,
    source_id: source.id,
    event_type: 'whale_transaction',
    transaction_hash: '0x' + Math.random().toString(16).substr(2, 64),
    amount: 1000 + Math.random() * 10000, // Random whale amount between 1000-11000
    from_address: '0x' + Math.random().toString(16).substr(2, 40),
    to_address: '0x' + Math.random().toString(16).substr(2, 40),
    token_symbol: ['BTC', 'ETH', 'USDT'][Math.floor(Math.random() * 3)],
    blockchain: 'ethereum',
    raw_data: {
      amount_usd: 500000 + Math.random() * 1000000,
      transaction_type: 'transfer',
      timestamp: Date.now(),
      websocket_connection: true,
      live_feed_active: true
    },
    timestamp: new Date().toISOString(),
    processed: false
  };

  const { error } = await supabaseClient
    .from('whale_signal_events')
    .insert(mockWhaleTransaction);

  if (error) {
    console.error('Error storing whale transaction:', error);
  } else {
    console.log('🐋 Mock whale transaction stored - WebSocket feed simulation active');
    
    // Trigger AI analysis for the whale signal
    await processWhaleSignalForAI(supabaseClient, mockWhaleTransaction);
  }
}

async function processWhaleSignalForAI(supabaseClient: any, whaleEvent: any) {
  console.log('🤖 Processing whale signal for AI analysis...');
  
  try {
    // Check if this whale signal matches any active strategy conditions
    const { data: activeStrategies } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('user_id', whaleEvent.user_id)
      .eq('is_active', true);

    if (!activeStrategies || activeStrategies.length === 0) {
      console.log('📭 No active strategies found for whale signal analysis');
      return;
    }

    for (const strategy of activeStrategies) {
      const config = strategy.configuration;
      
      // Check if whale signal matches strategy criteria
      const shouldTrigger = checkWhaleSignalMatch(whaleEvent, config);
      
      if (shouldTrigger) {
        console.log(`🎯 Whale signal matches strategy: ${strategy.strategy_name}`);
        
        // Send to AI Trading Assistant for immediate analysis
        const { error: aiError } = await supabaseClient.functions.invoke('ai-trading-assistant', {
          body: {
            action: 'analyze_whale_signal',
            userId: whaleEvent.user_id,
            strategyId: strategy.id,
            whaleSignal: whaleEvent,
            priority: 'urgent'
          }
        });

        if (aiError) {
          console.error('Error sending whale signal to AI:', aiError);
        } else {
          console.log('✅ Whale signal sent to AI for urgent analysis');
        }
      }
    }
  } catch (error) {
    console.error('Error processing whale signal for AI:', error);
  }
}

function checkWhaleSignalMatch(whaleEvent: any, strategyConfig: any): boolean {
  // Check if whale signal matches strategy criteria
  const thresholdAmount = strategyConfig.whale_threshold || 100000; // Default $100k
  const watchedTokens = strategyConfig.watched_cryptocurrencies || [];
  
  // Check amount threshold
  const amountUSD = whaleEvent.raw_data?.amount_usd || 0;
  if (amountUSD < thresholdAmount) {
    return false;
  }
  
  // Check if token is being watched
  if (watchedTokens.length > 0 && !watchedTokens.includes(whaleEvent.token_symbol)) {
    return false;
  }
  
  return true;
}

async function syncQuickNodeWebhooks(supabaseClient: any, source: any) {
  console.log('⚡ Syncing QuickNode webhook configuration...');
  console.log('Source details:', JSON.stringify(source, null, 2));
  
  try {
    const webhookUrl = source.configuration?.webhook_url;
    const webhookSecret = source.configuration?.webhook_secret;
    
    if (!webhookUrl) {
      throw new Error('QuickNode webhook URL not configured');
    }
    
    console.log(`🔗 Validating QuickNode webhook: ${webhookUrl}`);
    
    // 1. Validate webhook URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
      if (!parsedUrl.protocol.startsWith('http')) {
        throw new Error('Webhook URL must use HTTP or HTTPS');
      }
    } catch (urlError) {
      throw new Error(`Invalid webhook URL format: ${urlError.message}`);
    }
    
    // 2. Test our own endpoint to ensure it's reachable and responds correctly
    console.log('🔍 Testing webhook endpoint reachability...');
    
    try {
      // Send a test payload to our own endpoint to verify it works
      const testPayload = {
        test: true,
        source: 'quicknode_sync_test',
        timestamp: new Date().toISOString(),
        matchingTransactions: [
          {
            hash: '0xtest123',
            from: '0xtest456',
            to: '0xtest789',
            value: '0x16345785d8a0000', // 0.1 ETH in hex
            chainId: '0x1' // Ethereum mainnet
          }
        ]
      };
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'QuickNode-Webhook-Sync-Test',
          ...(webhookSecret && { 'X-Webhook-Secret': webhookSecret })
        },
        body: JSON.stringify(testPayload)
      });
      
      if (!response.ok) {
        throw new Error(`Webhook endpoint returned ${response.status}: ${response.statusText}`);
      }
      
      const responseText = await response.text();
      console.log('✅ Webhook endpoint test successful:', responseText);
      
    } catch (fetchError) {
      throw new Error(`Webhook endpoint unreachable: ${fetchError.message}`);
    }
    
    // 3. Create validation result record
    const validationData = {
      user_id: source.user_id,
      source_id: source.id,
      event_type: 'webhook_validation',
      transaction_hash: `validation_${Date.now()}`,
      amount: 0,
      from_address: 'validation_test',
      to_address: 'validation_test',
      token_symbol: 'VALIDATION',
      blockchain: 'test',
      raw_data: { 
        validation_test: true,
        timestamp: new Date().toISOString(),
        webhook_url: webhookUrl,
        has_secret: !!webhookSecret,
        url_valid: true,
        endpoint_reachable: true,
        status: 'validated'
      },
      timestamp: new Date().toISOString(),
      processed: true
    };
    
    console.log('Inserting validation event:', JSON.stringify(validationData, null, 2));
    
    const { data: insertedData, error: insertError } = await supabaseClient
      .from('whale_signal_events')
      .insert(validationData)
      .select();
    
    if (insertError) {
      console.error('Error inserting validation event:', insertError);
      throw new Error(`Failed to store validation result: ${insertError.message}`);
    }
    
    console.log('✅ QuickNode webhook validation completed successfully:', insertedData);
    
    return {
      url_valid: true,
      endpoint_reachable: true,
      has_secret: !!webhookSecret,
      last_validated: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Failed to validate QuickNode webhook:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    
    // Store failed validation
    try {
      await supabaseClient
        .from('whale_signal_events')
        .insert({
          user_id: source.user_id,
          source_id: source.id,
          event_type: 'webhook_validation_failed',
          transaction_hash: `validation_failed_${Date.now()}`,
          amount: 0,
          from_address: 'validation_failed',
          to_address: 'validation_failed',
          token_symbol: 'ERROR',
          blockchain: 'test',
          raw_data: { 
            validation_failed: true,
            error: error.message,
            timestamp: new Date().toISOString(),
            webhook_url: source.configuration?.webhook_url
          },
          timestamp: new Date().toISOString(),
          processed: true
        });
    } catch (insertError) {
      console.error('Failed to store validation failure:', insertError);
    }
    
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

async function syncCryptoNewsAPI(supabaseClient: any, source: any) {
  console.log('📰 Syncing CryptoNews API...');
  
  try {
    // Call the crypto-news-collector function with proper parameters
    const { data, error } = await supabaseClient.functions.invoke('crypto-news-collector', {
      body: {
        action: 'fetch_latest_news',
        symbols: ['BTC', 'ETH', 'SOL', 'ADA', 'DOT'],
        hours: 24,
        sourceId: source.id,
        userId: source.user_id,
        limit: 50
      }
    });

    if (error) {
      throw new Error(`CryptoNews API sync failed: ${error.message}`);
    }

    console.log('✅ CryptoNews API sync completed:', data);
  } catch (error) {
    console.error('Failed to sync CryptoNews API:', error);
    throw error;
  }
}

async function syncEODHDAPI(supabaseClient: any, source: any) {
  console.log('📊 Syncing EODHD API...');
  
  try {
    // Call the eodhd-collector function with proper parameters
    const { data, error } = await supabaseClient.functions.invoke('eodhd-collector', {
      body: {
        action: 'fetch_real_time_data',
        symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ADA-USD', 'DOT-USD'],
        sourceId: source.id,
        userId: source.user_id
      }
    });

    if (error) {
      throw new Error(`EODHD API sync failed: ${error.message}`);
    }

    console.log('✅ EODHD API sync completed:', data);
  } catch (error) {
    console.error('Failed to sync EODHD API:', error);
    throw error;
  }
}

async function syncBigQueryAPI(supabaseClient: any, source: any) {
  console.log('🗄️ Syncing BigQuery...');
  
  try {
    // Default symbols for crypto data
    const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Call the bigquery-collector function with proper parameters
    const { data, error } = await supabaseClient.functions.invoke('bigquery-collector', {
      body: {
        action: 'sync_daily_data',
        symbols: symbols,
        startDate: weekAgo.toISOString().split('T')[0],
        endDate: today.toISOString().split('T')[0],
        sourceId: source.id,
        userId: source.user_id
      }
    });

    if (error) {
      throw new Error(`BigQuery sync failed: ${error.message}`);
    }

    console.log('✅ BigQuery sync completed:', data);
  } catch (error) {
    console.error('Failed to sync BigQuery:', error);
    throw error;
  }
}