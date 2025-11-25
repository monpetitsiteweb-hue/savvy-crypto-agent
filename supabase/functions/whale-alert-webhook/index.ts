// @ts-nocheck
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

    console.log(`🐋 Whale Alert Webhook received: ${req.method} ${req.url}`);
    
    if (req.method === 'GET') {
      // Health check endpoint
      return new Response(JSON.stringify({ 
        status: 'OK', 
        message: 'Whale Alert webhook is active',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse webhook payload
    const payload = await req.json();
    console.log(`🐋 Whale Alert payload:`, JSON.stringify(payload, null, 2));

    // Check if this is a QuickNode webhook (has different structure)
    if (payload.matchingTransactions) {
      console.log('🔗 Processing QuickNode webhook format');
      return await processQuickNodeWebhook(supabaseClient, payload);
    }

    // Get whale alert data source configuration
    const { data: dataSource } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .eq('source_name', 'whale_alert')
      .eq('is_active', true)
      .single();

    if (!dataSource) {
      console.log('⚠️ No Whale Alert data source configured, processing as generic webhook');
      // Try to find any whale-related data source
      const { data: fallbackSource } = await supabaseClient
        .from('ai_data_sources')
        .select('*')
        .eq('is_active', true)
        .or('source_name.eq.quicknode_webhooks,source_name.eq.whale_monitoring')
        .single();
        
      if (!fallbackSource) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'No data source configured, but webhook acknowledged' 
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Use fallback source
      var dataSource = fallbackSource;
    }

    const userId = dataSource.user_id;
    const sourceId = dataSource.id;
    const thresholdAmount = dataSource.threshold_amount || 50000;

    // Process webhook payload and extract whale transaction data
    const whaleEvents = [];
    
    if (payload.transactions && Array.isArray(payload.transactions)) {
      for (const tx of payload.transactions) {
        // Skip if below threshold
        if (tx.amount_usd && tx.amount_usd < thresholdAmount) {
          continue;
        }

        // Determine transaction type and signal type based on from/to addresses
        const fromOwner = tx.from?.owner || '';
        const toOwner = tx.to?.owner || '';
        const isExchangeInflow = toOwner && !fromOwner;
        const isExchangeOutflow = fromOwner && !toOwner;
        const isStablecoin = ['USDT', 'USDC', 'DAI', 'BUSD'].includes(tx.symbol?.toUpperCase());
        
        let transactionType = 'transfer';
        let signalType = 'whale_transfer';
        
        if (isExchangeInflow) {
          transactionType = 'inflow';
          signalType = isStablecoin ? 'whale_usdt_injection' : 'whale_exchange_inflow';
        } else if (isExchangeOutflow) {
          transactionType = 'outflow';
          signalType = 'whale_exchange_outflow';
        } else if (isStablecoin && fromOwner === 'Tether Treasury') {
          transactionType = 'mint';
          signalType = 'whale_stablecoin_mint';
        } else if (isStablecoin && toOwner === 'Tether Treasury') {
          transactionType = 'burn';
          signalType = 'whale_stablecoin_burn';
        }

        const whaleEvent = {
          source_id: sourceId,
          user_id: userId,
          timestamp: new Date(tx.timestamp * 1000).toISOString(),
          event_type: 'whale_transaction',
          blockchain: tx.blockchain || 'ethereum',
          transaction_hash: tx.hash,
          from_address: tx.from?.address || null,
          to_address: tx.to?.address || null,
          token_symbol: tx.symbol || 'ETH',
          amount: parseFloat(tx.amount || 0),
          raw_data: tx,
          processed: false
        };

        whaleEvents.push(whaleEvent);

        // Create live signal with specific signal type and tracked entity metadata
        const amountUsd = tx.amount_usd || 0;
        const signal = {
          source_id: sourceId,
          user_id: userId,
          timestamp: whaleEvent.timestamp,
          symbol: whaleEvent.token_symbol,
          signal_type: signalType,
          signal_strength: Math.min(100, amountUsd / 1000000 * 100),
          source: 'whale_alert_tracked', // Tracked wallets via webhook
          data: {
            hash: tx.hash,
            from: tx.from?.address,
            to: tx.to?.address,
            amount: parseFloat(tx.amount || 0),
            amount_usd: amountUsd,
            asset: tx.symbol || 'ETH',
            blockchain: tx.blockchain || 'ethereum',
            timestamp: tx.timestamp,
            transaction_type: transactionType,
            exchange: toOwner || fromOwner || null,
            tracked_entity: fromOwner || toOwner || null, 
            tracked_entity_type: (fromOwner || toOwner) ? 'exchange' : 'other',
            tracked_entity_id: null // Will be enhanced with specific IDs in future
          },
          processed: false
        };

        // Insert live signal
        const { error: signalError } = await supabaseClient
          .from('live_signals')
          .insert([signal]);

        if (signalError) {
          console.error('❌ Error inserting whale signal:', signalError);
        } else {
          console.log(`[WhaleSignals] Inserted signal into live_signals for ${signal.symbol} (${signalType})`);
        }
      }
      // Handle single transaction format
      const tx = payload;
      
      if (tx.amount_usd >= thresholdAmount) {
        // Determine transaction type and signal type
        const fromOwner = tx.from?.owner || '';
        const toOwner = tx.to?.owner || '';
        const isExchangeInflow = toOwner && !fromOwner;
        const isExchangeOutflow = fromOwner && !toOwner;
        const isStablecoin = ['USDT', 'USDC', 'DAI', 'BUSD'].includes(tx.symbol?.toUpperCase());
        
        let transactionType = 'transfer';
        let signalType = 'whale_transfer';
        
        if (isExchangeInflow) {
          transactionType = 'inflow';
          signalType = isStablecoin ? 'whale_usdt_injection' : 'whale_exchange_inflow';
        } else if (isExchangeOutflow) {
          transactionType = 'outflow';
          signalType = 'whale_exchange_outflow';
        } else if (isStablecoin && fromOwner === 'Tether Treasury') {
          transactionType = 'mint';
          signalType = 'whale_stablecoin_mint';
        } else if (isStablecoin && toOwner === 'Tether Treasury') {
          transactionType = 'burn';
          signalType = 'whale_stablecoin_burn';
        }

        const whaleEvent = {
          source_id: sourceId,
          user_id: userId,
          timestamp: new Date(tx.timestamp * 1000).toISOString(),
          event_type: 'whale_transaction',
          blockchain: tx.blockchain || 'ethereum',
          transaction_hash: tx.hash,
          from_address: tx.from?.address || null,
          to_address: tx.to?.address || null,
          token_symbol: tx.symbol || 'ETH',
          amount: parseFloat(tx.amount || 0),
          raw_data: tx,
          processed: false
        };

        whaleEvents.push(whaleEvent);

        // Create live signal with specific signal type and tracked entity metadata
        const amountUsd = tx.amount_usd || 0;
        const signal = {
          source_id: sourceId,
          user_id: userId,
          timestamp: whaleEvent.timestamp,
          symbol: whaleEvent.token_symbol,
          signal_type: signalType,
          signal_strength: Math.min(100, amountUsd / 1000000 * 100),
          source: 'whale_alert_tracked',
          data: {
            hash: tx.hash,
            from: tx.from?.address,
            to: tx.to?.address,
            amount: parseFloat(tx.amount || 0),
            amount_usd: amountUsd,
            asset: tx.symbol || 'ETH',
            blockchain: tx.blockchain || 'ethereum',
            timestamp: tx.timestamp,
            transaction_type: transactionType,
            exchange: toOwner || fromOwner || null,
            tracked_entity: fromOwner || toOwner || null,
            tracked_entity_type: (fromOwner || toOwner) ? 'exchange' : 'other',
            tracked_entity_id: null
          },
          processed: false
        };

        const { error: signalError } = await supabaseClient
          .from('live_signals')
          .insert([signal]);

        if (signalError) {
          console.error('❌ Error inserting whale signal:', signalError);
        } else {
          console.log(`[WhaleSignals] Inserted signal into live_signals for ${signal.symbol} (${signalType})`);
        }
      }
    }

    // Legacy whale_signal_events table insert removed - now using live_signals only
    console.log(`[WhaleSignals] Processed ${whaleEvents.length} whale transactions into live_signals (source: whale_alert_tracked)`);

    // Update last_sync timestamp
    await supabaseClient
      .from('ai_data_sources')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', sourceId);

    console.log(`🐋 Processed ${whaleEvents.length} whale events`);

    // Return fast 200 OK response
    return new Response(JSON.stringify({ 
      success: true, 
      events_processed: whaleEvents.length,
      message: 'Webhook processed successfully'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Whale Alert Webhook error:', error);
    
    // Return appropriate error status based on error type
    const status = error.message.includes('not configured') ? 200 : 500;
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      message: 'Webhook received but processing failed'
    }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function processQuickNodeWebhook(supabaseClient: any, payload: any) {
  console.log('🔗 Processing QuickNode webhook payload');
  
  // Get QuickNode data source
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select('*')
    .eq('source_name', 'quicknode_webhooks')
    .eq('is_active', true);
    
  if (!sources || sources.length === 0) {
    console.log('⚠️ No active QuickNode sources found, creating default');
    // Return success to avoid webhook delivery issues
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'QuickNode webhook received but no source configured' 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const source = sources[0];
  const whaleEvents = [];
  
  // Process matching transactions from QuickNode payload
  const matchingTransactions = payload.matchingTransactions || [];
  console.log(`🔍 Processing ${matchingTransactions.length} QuickNode transactions`);
  
  for (const transaction of matchingTransactions) {
    try {
      // Convert hex value to decimal (Wei to ETH)
      const valueInWei = parseInt(transaction.value, 16);
      const valueInEth = valueInWei / Math.pow(10, 18);
      
      // Skip small transactions (less than 10 ETH)
      if (valueInEth < 10) {
        continue;
      }
      
      // Determine blockchain from chainId
      const chainId = parseInt(transaction.chainId, 16);
      const blockchain = getBlockchainName(chainId);
      
      const whaleEvent = {
        source_id: source.id,
        user_id: source.user_id,
        timestamp: new Date().toISOString(),
        event_type: 'large_transaction',
        blockchain: blockchain,
        transaction_hash: transaction.hash,
        from_address: transaction.from,
        to_address: transaction.to,
        token_symbol: 'ETH',
        amount: valueInEth,
        raw_data: transaction,
        processed: false
      };
      
      whaleEvents.push(whaleEvent);
      
      // Create live signal for large QuickNode transactions
      const estimatedUsd = valueInEth * 3200; // Approximate
      const signalType = valueInEth > 100 ? 'whale_exchange_inflow' : 'whale_transfer';
      
      const signal = {
        source_id: source.id,
        user_id: source.user_id,
        timestamp: whaleEvent.timestamp,
        symbol: 'ETH',
        signal_type: signalType,
        signal_strength: Math.min(100, valueInEth / 10),
        source: 'whale_alert_tracked', // QuickNode tracked wallets
        data: {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          amount: valueInEth,
          amount_usd: estimatedUsd,
          asset: 'ETH',
          blockchain: blockchain,
          timestamp: Math.floor(Date.now() / 1000),
          transaction_type: 'transfer',
          exchange: null,
          tracked_entity: null, // Can be enhanced with wallet labels
          tracked_entity_type: null,
          tracked_entity_id: null
        },
        processed: false
      };
      
      // Insert live signal
      const { error: signalError } = await supabaseClient
        .from('live_signals')
        .insert([signal]);
        
      if (signalError) {
        console.error('❌ Error inserting QuickNode signal:', signalError);
      } else {
        console.log(`[WhaleSignals] Inserted QuickNode signal for ${valueInEth.toFixed(4)} ETH on ${blockchain}`);
      }
    } catch (error) {
      console.error('❌ Error processing QuickNode transaction:', error);
    }
  }
  
  // Legacy whale_signal_events table insert removed - now using live_signals only
  console.log(`[WhaleSignals] Processed ${whaleEvents.length} QuickNode transactions into live_signals (source: whale_alert_tracked)`);
  
  // Update last_sync timestamp
  await supabaseClient
    .from('ai_data_sources')
    .update({ last_sync: new Date().toISOString() })
    .eq('id', source.id);
  
  return new Response(JSON.stringify({ 
    success: true, 
    events_processed: whaleEvents.length,
    message: 'QuickNode webhook processed successfully'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
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