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

    console.log(`🔧 BACKFILL: Starting deterministic trade backfill`);
    
    // Get all corrupted trades
    const { data: corruptedTrades, error: queryError } = await supabaseClient
      .from('mock_trades')
      .select('*')
      .eq('is_corrupted', true);
    
    if (queryError) throw queryError;
    
    console.log(`🔍 BACKFILL: Found ${corruptedTrades?.length} corrupted trades`);
    
    let fixed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const trade of corruptedTrades || []) {
      try {
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        const executedAt = new Date(trade.executed_at);
        
        // Find nearest price snapshot (within 5 minutes)
        const { data: snapshots } = await supabaseClient
          .from('price_snapshots')
          .select('*')
          .eq('symbol', symbol)
          .gte('ts', new Date(executedAt.getTime() - 5 * 60 * 1000).toISOString())
          .lte('ts', new Date(executedAt.getTime() + 5 * 60 * 1000).toISOString())
          .order('ts', { ascending: true })
          .limit(1);
        
        if (!snapshots || snapshots.length === 0) {
          console.warn(`⚠️ BACKFILL: No price snapshot found for ${symbol} at ${executedAt.toISOString()}`);
          skipped++;
          continue;
        }
        
        const snapshot = snapshots[0];
        const newPrice = parseFloat(snapshot.price.toString());
        const oldPrice = parseFloat(trade.price.toString());
        const oldAmount = parseFloat(trade.amount.toString());
        
        // Calculate correct amount: total_value / new_price
        const newAmount = parseFloat((trade.total_value / newPrice).toFixed(8));
        
        console.log(`🔧 BACKFILL: Fixing trade ${trade.id} - ${symbol}`);
        console.log(`  Old: ${oldAmount} @ €${oldPrice} = €${trade.total_value}`);
        console.log(`  New: ${newAmount} @ €${newPrice} = €${trade.total_value}`);
        
        // Update the trade
        const { error: updateError } = await supabaseClient
          .from('mock_trades')
          .update({
            price: newPrice,
            amount: newAmount,
            is_corrupted: false,
            integrity_reason: null
          })
          .eq('id', trade.id);
        
        if (updateError) throw updateError;
        
        // Log the fix in audit table
        await supabaseClient
          .from('mock_trades_fix_audit')
          .insert({
            trade_id: trade.id,
            user_id: trade.user_id,
            strategy_id: trade.strategy_id,
            symbol: symbol,
            old_price: oldPrice,
            new_price: newPrice,
            old_amount: oldAmount,
            new_amount: newAmount,
            reason: 'entry_price_placeholder_100_fixed',
            source: 'snapshot_1m'
          });
        
        fixed++;
        
      } catch (error) {
        console.error(`❌ BACKFILL: Error fixing trade ${trade.id}:`, error);
        errors++;
      }
    }
    
    console.log(`✅ BACKFILL: Complete - Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
    
    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_corrupted: corruptedTrades?.length || 0,
        fixed,
        skipped,
        errors
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ BACKFILL: Error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});