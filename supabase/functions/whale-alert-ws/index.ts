// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================================================
// WHALE ALERT WEBSOCKET CONNECTOR
// Connects to wss://leviathan.whale-alert.io/ws for real-time whale alerts
// Inserts signals into live_signals with source = 'whale_alert_ws'
// =============================================================================

// Map blockchain symbols to trading symbols
const SYMBOL_MAP: Record<string, string> = {
  'bitcoin': 'BTC',
  'btc': 'BTC',
  'ethereum': 'ETH',
  'eth': 'ETH',
  'ripple': 'XRP',
  'xrp': 'XRP',
  'solana': 'SOL',
  'sol': 'SOL',
  'cardano': 'ADA',
  'ada': 'ADA',
  'avalanche': 'AVAX',
  'avax': 'AVAX',
  'polkadot': 'DOT',
  'dot': 'DOT',
  'litecoin': 'LTC',
  'ltc': 'LTC',
  'tether': 'USDT',
  'usdt': 'USDT',
  'usd-coin': 'USDC',
  'usdc': 'USDC',
};

// Resolve fallback user_id
async function resolveFallbackUserId(supabaseClient: any): Promise<string> {
  const { data: activeUsers } = await supabaseClient
    .from('trading_strategies')
    .select('user_id')
    .or('is_active_test.eq.true,is_active.eq.true')
    .limit(1);
  
  if (activeUsers && activeUsers.length > 0) {
    return activeUsers[0].user_id;
  }
  return '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'; // Known system user
}

// Determine signal type based on whale transaction characteristics
function determineSignalType(transaction: any): string {
  const from = (transaction.from?.owner_type || '').toLowerCase();
  const to = (transaction.to?.owner_type || '').toLowerCase();
  
  // Exchange inflow = potential selling pressure
  if (to === 'exchange') {
    return 'whale_exchange_inflow';
  }
  
  // Exchange outflow = potential accumulation
  if (from === 'exchange') {
    return 'whale_exchange_outflow';
  }
  
  // Large unknown movement
  return 'whale_large_movement';
}

// Calculate signal strength based on USD value
function calculateSignalStrength(amountUsd: number): number {
  // Scale: $1M = 20, $10M = 50, $100M = 80, $1B+ = 100
  if (amountUsd >= 1_000_000_000) return 100;
  if (amountUsd >= 100_000_000) return 80;
  if (amountUsd >= 10_000_000) return 50;
  if (amountUsd >= 1_000_000) return 20;
  return Math.min(15, Math.floor(amountUsd / 100_000) * 5);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const apiKey = Deno.env.get('WHALE_ALERT_API_KEY');
  if (!apiKey) {
    console.error('❌ WHALE_ALERT_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'WHALE_ALERT_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Resolve user_id for signal insertion
  const userId = await resolveFallbackUserId(supabaseClient);
  console.log(`🐋 Whale Alert WS: Using userId ${userId}`);

  // Get the source_id for whale_alert
  const { data: sources } = await supabaseClient
    .from('ai_data_sources')
    .select('id')
    .eq('source_name', 'whale_alert')
    .limit(1);
  
  const sourceId = sources?.[0]?.id || null;

  try {
    // Since Edge Functions can't maintain persistent WebSocket connections,
    // we'll use the REST API to fetch recent transactions instead
    // The WebSocket would require a long-running process
    
    console.log('🐋 Fetching recent whale transactions via REST API...');
    
    // Use the transactions API endpoint
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    
    const apiUrl = `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}&min_value=1000000&start=${oneHourAgo}&limit=100`;
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Whale Alert API error: ${response.status} - ${errorText}`);
      return new Response(JSON.stringify({ 
        error: `Whale Alert API error: ${response.status}`,
        details: errorText 
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    console.log(`📊 Whale Alert returned ${data.count || 0} transactions`);

    if (!data.transactions || data.transactions.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No whale transactions in the last hour',
        signals_created: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const signals: any[] = [];

    for (const tx of data.transactions) {
      const blockchain = (tx.blockchain || '').toLowerCase();
      const symbol = SYMBOL_MAP[blockchain] || SYMBOL_MAP[tx.symbol?.toLowerCase()] || blockchain.toUpperCase();
      
      // Skip if we can't map to a known symbol
      if (!symbol || symbol.length > 10) {
        console.log(`⚠️ Skipping unmapped blockchain: ${blockchain}`);
        continue;
      }

      const signalType = determineSignalType(tx);
      const signalStrength = calculateSignalStrength(tx.amount_usd || 0);

      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        symbol: symbol,
        signal_type: signalType,
        signal_strength: signalStrength,
        source: 'whale_alert_ws',
        data: {
          blockchain: tx.blockchain,
          hash: tx.hash,
          amount: tx.amount,
          amount_usd: tx.amount_usd,
          from_owner: tx.from?.owner || 'unknown',
          from_type: tx.from?.owner_type || 'unknown',
          to_owner: tx.to?.owner || 'unknown',
          to_type: tx.to?.owner_type || 'unknown',
          transaction_type: tx.transaction_type,
          description: `${signalType}: ${tx.amount?.toFixed(2)} ${symbol} ($${(tx.amount_usd || 0).toLocaleString()}) from ${tx.from?.owner_type || 'unknown'} to ${tx.to?.owner_type || 'unknown'}`
        },
        processed: false
      });

      console.log(`🐋 Processed: ${signalType} | ${symbol} | $${(tx.amount_usd || 0).toLocaleString()} | strength: ${signalStrength}`);
    }

    // Insert signals
    if (signals.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('live_signals')
        .upsert(signals, { 
          onConflict: 'source_id,symbol,timestamp,signal_type',
          ignoreDuplicates: true 
        });

      if (insertError) {
        console.error('❌ Error inserting whale signals:', insertError);
        // Try individual inserts as fallback
        let inserted = 0;
        for (const signal of signals) {
          const { error } = await supabaseClient
            .from('live_signals')
            .insert(signal);
          if (!error) inserted++;
        }
        console.log(`✅ Inserted ${inserted}/${signals.length} whale signals (fallback mode)`);
      } else {
        console.log(`✅ Inserted ${signals.length} whale signals`);
      }
    }

    // Update last_sync on the source
    if (sourceId) {
      await supabaseClient
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', sourceId);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Processed ${data.transactions.length} whale transactions`,
      signals_created: signals.length,
      userId: userId
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Whale Alert WS error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
