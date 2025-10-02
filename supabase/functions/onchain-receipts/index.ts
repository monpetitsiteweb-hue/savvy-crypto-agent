import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROJECT_URL = Deno.env.get('SB_URL')!;
const SERVICE_ROLE = Deno.env.get('SB_SERVICE_ROLE')!;

const supabase = createClient(PROJECT_URL, SERVICE_ROLE);

const RPC_URLS: Record<number, string> = {
  1: Deno.env.get('RPC_URL_1') || 'https://eth.llamarpc.com',
  8453: Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com',
  42161: Deno.env.get('RPC_URL_42161') || 'https://arbitrum.llamarpc.com',
};

async function getReceipt(chainId: number, txHash: string) {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { error: `No RPC URL for chainId ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
    });

    const json = await response.json();
    
    if (json.error) {
      return { error: json.error.message || JSON.stringify(json.error) };
    }

    return { receipt: json.result };
  } catch (error) {
    return { error: String(error) };
  }
}

async function processReceipt(trade: any) {
  const { id: tradeId, chain_id, tx_hash } = trade;

  console.log(`Polling receipt for trade ${tradeId}, tx ${tx_hash}`);

  const result = await getReceipt(chain_id, tx_hash);

  if (result.error) {
    console.error(`Failed to get receipt for ${tradeId}:`, result.error);
    return {
      tradeId,
      tx_hash,
      status: 'error',
      error: result.error,
    };
  }

  if (!result.receipt) {
    console.log(`No receipt yet for ${tradeId}`);
    return {
      tradeId,
      tx_hash,
      status: 'pending',
    };
  }

  const receipt = result.receipt;
  console.log(`Receipt found for ${tradeId}:`, {
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  });

  // Parse receipt status (0x0 = failed, 0x1 = success)
  const txSuccess = receipt.status === '0x1' || receipt.status === 1;
  const newStatus = txSuccess ? 'mined' : 'failed';

  // Calculate gas costs
  const gasUsedDec = parseInt(receipt.gasUsed, 16);
  const effectiveGasPrice = receipt.effectiveGasPrice
    ? parseInt(receipt.effectiveGasPrice, 16)
    : null;
  const totalNetworkFee = effectiveGasPrice
    ? (BigInt(gasUsedDec) * BigInt(effectiveGasPrice)).toString()
    : null;

  // Update trade with receipt
  const { error: updateError } = await supabase
    .from('trades')
    .update({
      status: newStatus,
      receipts: receipt,
      gas_wei: gasUsedDec,
      total_network_fee: totalNetworkFee,
    })
    .eq('id', tradeId);

  if (updateError) {
    console.error(`Failed to update trade ${tradeId}:`, updateError);
  }

  // Add trade event
  const { error: eventError } = await supabase.from('trade_events').insert({
    trade_id: tradeId,
    phase: txSuccess ? 'mined' : 'error',
    severity: txSuccess ? 'info' : 'error',
    payload: {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      status: receipt.status,
    },
  });

  if (eventError) {
    console.error(`Failed to add event for ${tradeId}:`, eventError);
  }

  return {
    tradeId,
    tx_hash,
    status: newStatus,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;

    let tradesToPoll: any[] = [];

    if (tradeId) {
      // Poll specific trade
      const { data: trade, error } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (error || !trade) {
        return new Response(
          JSON.stringify({ error: 'Trade not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (trade.status !== 'submitted') {
        return new Response(
          JSON.stringify({
            error: `Trade status is '${trade.status}', expected 'submitted'`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      tradesToPoll = [trade];
    } else {
      // Poll all submitted trades without receipts
      const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'submitted')
        .is('receipts', null)
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        console.error('Failed to fetch trades:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch trades' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      tradesToPoll = trades || [];
    }

    console.log(`Polling ${tradesToPoll.length} trade(s)`);

    // Process all trades in parallel
    const results = await Promise.all(
      tradesToPoll.map((trade) => processReceipt(trade))
    );

    return new Response(
      JSON.stringify({
        ok: true,
        polled: results.length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Receipt polling error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
