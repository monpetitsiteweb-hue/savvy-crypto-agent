import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ========================================================================
// Notification Helper
// ========================================================================
async function sendNotification(payload: {
  event: string;
  tradeId: string;
  chainId: number;
  txHash?: string | null;
  provider?: string;
  symbol?: string;
  side?: string;
  explorerUrl?: string;
  error?: string;
  gasUsed?: string;
  blockNumber?: string;
}) {
  const webhookUrl = Deno.env.get('NOTIFICATION_WEBHOOK_URL');
  if (!webhookUrl) return;

  const webhookType = Deno.env.get('NOTIFICATION_WEBHOOK_TYPE') || 'slack';

  try {
    let body: any;

    if (webhookType === 'discord') {
      const emoji = payload.event === 'mined' ? '✅' : '❌';
      const fields = [
        { name: 'Trade ID', value: `\`${payload.tradeId}\``, inline: true },
        { name: 'Chain', value: `Base (${payload.chainId})`, inline: true },
        { name: 'Provider', value: payload.provider || 'N/A', inline: true },
        { name: 'Symbol', value: payload.symbol || 'N/A', inline: true },
        { name: 'Side', value: payload.side?.toUpperCase() || 'N/A', inline: true },
      ];

      if (payload.txHash) {
        fields.push({ name: 'TX Hash', value: `\`${payload.txHash}\``, inline: false });
      }
      if (payload.explorerUrl) {
        fields.push({ name: 'Explorer', value: `[View on BaseScan](${payload.explorerUrl})`, inline: false });
      }
      if (payload.gasUsed) {
        fields.push({ name: 'Gas Used', value: payload.gasUsed, inline: true });
      }
      if (payload.blockNumber) {
        fields.push({ name: 'Block', value: payload.blockNumber, inline: true });
      }
      if (payload.error) {
        fields.push({ name: 'Error', value: `\`\`\`${payload.error}\`\`\``, inline: false });
      }

      body = {
        embeds: [{
          title: `${emoji} ${payload.event.toUpperCase()}`,
          color: payload.event === 'mined' ? 0x00ff00 : 0xff0000,
          fields,
          timestamp: new Date().toISOString(),
        }],
      };
    } else {
      const emoji = payload.event === 'mined' ? ':white_check_mark:' : ':x:';
      const fields = [
        { title: 'Trade ID', value: payload.tradeId, short: true },
        { title: 'Chain', value: `Base (${payload.chainId})`, short: true },
        { title: 'Provider', value: payload.provider || 'N/A', short: true },
        { title: 'Symbol', value: payload.symbol || 'N/A', short: true },
        { title: 'Side', value: payload.side?.toUpperCase() || 'N/A', short: true },
      ];

      if (payload.txHash) {
        fields.push({ title: 'TX Hash', value: `\`${payload.txHash}\``, short: false });
      }
      if (payload.explorerUrl) {
        fields.push({ title: 'Explorer', value: `<${payload.explorerUrl}|View on BaseScan>`, short: false });
      }
      if (payload.gasUsed) {
        fields.push({ title: 'Gas Used', value: payload.gasUsed, short: true });
      }
      if (payload.blockNumber) {
        fields.push({ title: 'Block', value: payload.blockNumber, short: true });
      }
      if (payload.error) {
        fields.push({ title: 'Error', value: `\`\`\`${payload.error}\`\`\``, short: false });
      }

      body = {
        attachments: [{
          color: payload.event === 'mined' ? 'good' : 'danger',
          title: `${emoji} ${payload.event.toUpperCase()}`,
          fields,
          footer: 'Onchain Execution',
          ts: Math.floor(Date.now() / 1000),
        }],
      };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(`⚠️  Notification failed: ${response.status}`);
    }
  } catch (err) {
    console.warn('⚠️  Notification error:', err.message);
  }
}

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
  const { id: tradeId, chain_id, tx_hash, provider, symbol, side } = trade;

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

  // Send notification
  await sendNotification({
    event: newStatus, // 'mined' or 'failed'
    tradeId,
    chainId: chain_id,
    txHash: tx_hash,
    provider,
    symbol,
    side,
    explorerUrl: `https://basescan.org/tx/${tx_hash}`,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    error: txSuccess ? undefined : 'Transaction reverted',
  });

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
