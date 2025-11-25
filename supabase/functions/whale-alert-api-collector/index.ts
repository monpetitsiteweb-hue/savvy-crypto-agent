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

    console.log(`🐋 Whale Alert API Collector triggered`);

    // Get active whale_alert_api data sources
    const { data: sources, error: sourcesError } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .eq('source_name', 'whale_alert_api')
      .eq('is_active', true);

    if (sourcesError) throw sourcesError;
    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No active Whale Alert API sources configured' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let totalSignalsCreated = 0;

    for (const source of sources) {
      const apiKey = source.configuration?.api_key;
      if (!apiKey || apiKey === 'demo_key') {
        console.log(`⚠️ Skipping source ${source.id}: invalid or demo API key`);
        continue;
      }

      const thresholdUsd = source.threshold_amount || 50000;
      const blockchains = source.configuration?.blockchain_filter || ['ethereum', 'bitcoin'];

      console.log(`🔍 Fetching whale transactions from Whale Alert API (threshold: $${thresholdUsd})`);

      // Fetch recent transactions from Whale Alert API
      // API docs: https://docs.whale-alert.io/
      const url = `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}&min_value=${thresholdUsd}&limit=100`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`❌ Whale Alert API error: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const transactions = data.transactions || [];
      console.log(`📊 Received ${transactions.length} whale transactions`);

      for (const tx of transactions) {
        // Filter by blockchain if configured
        if (!blockchains.includes(tx.blockchain)) {
          continue;
        }

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

        const amountUsd = tx.amount_usd || 0;
        
        // Insert into live_signals (not whale_signal_events)
        const signal = {
          source_id: source.id,
          user_id: source.user_id,
          timestamp: new Date(tx.timestamp * 1000).toISOString(),
          symbol: tx.symbol || 'BTC',
          signal_type: signalType,
          signal_strength: Math.min(100, amountUsd / 1000000 * 100),
          source: 'whale_alert_api', // Global whales via API (not tracked)
          data: {
            hash: tx.hash,
            from: tx.from?.address,
            to: tx.to?.address,
            amount: parseFloat(tx.amount || 0),
            amount_usd: amountUsd,
            asset: tx.symbol || 'BTC',
            blockchain: tx.blockchain,
            timestamp: tx.timestamp,
            transaction_type: transactionType,
            exchange: toOwner || fromOwner || null,
            tracked_entity: null, // Global whales don't have tracked entities
            tracked_entity_type: null
          },
          processed: false
        };

        const { error: signalError } = await supabaseClient
          .from('live_signals')
          .insert([signal]);

        if (signalError) {
          console.error('❌ Error inserting whale signal:', signalError);
        } else {
          totalSignalsCreated++;
          console.log(`[WhaleSignals] Inserted API signal into live_signals for ${signal.symbol} (${signalType})`);
        }
      }

      // Update last_sync
      await supabaseClient
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', source.id);
    }

    console.log(`[WhaleSignals] Inserted ${totalSignalsCreated} signals into live_signals (source: whale_alert_api)`);

    return new Response(JSON.stringify({ 
      success: true, 
      signals_created: totalSignalsCreated,
      message: 'Whale Alert API collection completed'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Whale Alert API Collector error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
