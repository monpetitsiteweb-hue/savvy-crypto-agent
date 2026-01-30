/**
 * Headless sign & send endpoint
 * 
 * SINGLE ENTRY POINT for all on-chain trade execution.
 * 
 * Accepts EITHER:
 * 1. tradeId - for pre-built trades (existing behavior)
 * 2. Raw trade params - internally builds then signs+sends
 *    Required: symbol, side, amount, taker (wallet address)
 *    Optional: slippageBps (default 100 = 1%)
 * 
 * This function is the ONLY place that:
 * - Signs transactions via getSigner()
 * - Broadcasts via eth_sendRawTransaction
 * - Updates trades table to status=submitted
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { getSigner } from '../_shared/signer.ts';
import { ALLOWED_TO_ADDRESSES } from '../_shared/addresses.ts';
import { corsHeaders } from '../_shared/cors.ts';

const PROJECT_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// ========================================================================
// Build Trade (internal helper - calls onchain-execute in build mode)
// ========================================================================
async function buildTrade(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  amount: number;
  taker: string;
  slippageBps?: number;
}): Promise<{ ok: true; tradeId: string; price?: number } | { ok: false; error: string }> {
  console.log('🔨 [sign-and-send] Building trade internally...', params);
  
  try {
    const buildResponse = await fetch(`${PROJECT_URL}/functions/v1/onchain-execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE!,
      },
      body: JSON.stringify({
        chainId: 8453, // Base
        base: params.symbol,
        quote: 'USDC',
        side: params.side,
        amount: params.amount,
        slippageBps: params.slippageBps || 100,
        provider: '0x',
        taker: params.taker,
        mode: 'build',
        preflight: true,
      }),
    });

    if (!buildResponse.ok) {
      const errorText = await buildResponse.text();
      console.error('❌ [sign-and-send] Build HTTP failed:', errorText);
      return { ok: false, error: `Build failed: ${errorText}` };
    }

    const buildData = await buildResponse.json();
    
    // Log full raw build response for debugging
    console.log('📦 [sign-and-send] Raw build response:', JSON.stringify(buildData, null, 2));
    
    // Handle preflight_required responses (Permit2, WETH wrap, etc.)
    if (buildData.status === 'preflight_required') {
      console.error('❌ [sign-and-send] Preflight required:', {
        reason: buildData.reason,
        note: buildData.note,
        tradeId: buildData.tradeId,
      });
      return { 
        ok: false, 
        error: `Preflight required: ${buildData.reason}. ${buildData.note || ''}`,
        preflightData: buildData,
      };
    }
    
    // Check for tradeId (the key success indicator from build mode)
    if (!buildData.tradeId) {
      console.error('❌ [sign-and-send] Build response missing tradeId:', buildData);
      return { ok: false, error: buildData.error?.message || 'Build returned invalid response (no tradeId)' };
    }
    
    // Check trade status - must be 'built' to proceed
    if (buildData.status && buildData.status !== 'built' && buildData.status !== 'ok') {
      console.error('❌ [sign-and-send] Build returned non-built status:', buildData.status);
      return { ok: false, error: `Build returned status: ${buildData.status}` };
    }

    console.log('✅ [sign-and-send] Trade built:', { tradeId: buildData.tradeId, status: buildData.status });
    return { ok: true, tradeId: buildData.tradeId, price: buildData.price };
  } catch (err: any) {
    console.error('❌ [sign-and-send] Build exception:', err.message);
    return { ok: false, error: err.message };
  }
}

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
}) {
  const webhookUrl = Deno.env.get('NOTIFICATION_WEBHOOK_URL');
  if (!webhookUrl) return; // Notifications disabled

  const webhookType = Deno.env.get('NOTIFICATION_WEBHOOK_TYPE') || 'slack';

  try {
    let body: any;

    if (webhookType === 'discord') {
      const emoji = payload.event.includes('failed') ? '❌' : 
                    payload.event === 'submitted' ? '✅' : 
                    payload.event.includes('attempt') ? '⏳' : '🔔';
      
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
      if (payload.error) {
        fields.push({ name: 'Error', value: `\`\`\`${payload.error}\`\`\``, inline: false });
      }

      body = {
        embeds: [{
          title: `${emoji} ${payload.event.replace(/_/g, ' ').toUpperCase()}`,
          color: payload.event.includes('failed') ? 0xff0000 : 
                 payload.event === 'submitted' ? 0x00ff00 : 
                 0xffaa00,
          fields,
          timestamp: new Date().toISOString(),
        }],
      };
    } else {
      const emoji = payload.event.includes('failed') ? ':x:' : 
                    payload.event === 'submitted' ? ':white_check_mark:' : 
                    payload.event.includes('attempt') ? ':hourglass:' : ':bell:';

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
      if (payload.error) {
        fields.push({ title: 'Error', value: `\`\`\`${payload.error}\`\`\``, short: false });
      }

      body = {
        attachments: [{
          color: payload.event.includes('failed') ? 'danger' : 
                 payload.event === 'submitted' ? 'good' : 
                 'warning',
          title: `${emoji} ${payload.event.replace(/_/g, ' ').toUpperCase()}`,
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
      console.warn(`⚠️  Notification failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.warn('⚠️  Notification error:', err.message);
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    let tradeId: string | undefined;
    let executedPrice: number | undefined;

    // ========================================================================
    // PATH A: Raw trade params provided (symbol, side, amount, taker)
    // Build the trade first, then proceed to sign+send
    // ========================================================================
    if (!body.tradeId && body.symbol && body.side && body.amount && body.taker) {
      console.log('🚀 [sign-and-send] RAW PARAMS PATH - building trade first');
      
      const buildResult = await buildTrade({
        symbol: body.symbol,
        side: body.side,
        amount: body.amount,
        taker: body.taker,
        slippageBps: body.slippageBps,
      });

      // CRITICAL: Handle build failure BEFORE accessing tradeId
      if (!buildResult.ok) {
        console.error('❌ [sign-and-send] BUILD FAILED (raw result):', JSON.stringify(buildResult, null, 2));
        return new Response(JSON.stringify({
          ok: false,
          error: { 
            code: 'BUILD_FAILED', 
            message: buildResult.error ?? 'Unknown build error',
            rawBuildResult: buildResult,
          },
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Only access tradeId AFTER confirming build succeeded
      tradeId = buildResult.tradeId;
      executedPrice = buildResult.price;
      console.log('✅ [sign-and-send] Trade built successfully:', { tradeId, executedPrice });
    }
    // ========================================================================
    // PATH B: tradeId provided (existing behavior)
    // ========================================================================
    else if (body.tradeId) {
      tradeId = body.tradeId;
      console.log('🔐 [sign-and-send] TRADE_ID PATH - signing existing trade:', tradeId);
    }
    // ========================================================================
    // Neither path - error
    // ========================================================================
    else {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Either tradeId OR (symbol, side, amount, taker) required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Final guard: tradeId must be defined at this point
    if (!tradeId) {
      console.error('❌ [sign-and-send] Unexpected state: tradeId is undefined after path routing');
      return new Response(JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'tradeId not set after path routing' },
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load trade
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      return new Response(JSON.stringify({ ok: false, error: 'Trade not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate trade status
    if (trade.status !== 'built') {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: `Trade status must be 'built', got '${trade.status}'` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate chain
    if (trade.chain_id !== 8453) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: `Only Base (8453) supported, got chain ${trade.chain_id}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate tx_payload exists
    if (!trade.tx_payload) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Trade missing tx_payload' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================================================
    // PREFLIGHT: Value Cap Check
    // ========================================================================
    const maxTxValueWeiStr = Deno.env.get('MAX_TX_VALUE_WEI');
    if (maxTxValueWeiStr) {
      const maxTxValueWei = BigInt(maxTxValueWeiStr);
      const tradeValueStr = trade.tx_payload.value || '0x0';
      const tradeValue = BigInt(tradeValueStr);
      
      if (tradeValue > maxTxValueWei) {
        console.error(`❌ Value cap exceeded: ${tradeValue} > ${maxTxValueWei}`);
        
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'VALUE_CAP_EXCEEDED',
            value: tradeValueStr,
            cap: maxTxValueWeiStr,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'VALUE_CAP_EXCEEDED'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ========================================================================
    // PREFLIGHT: Webhook Signer Configuration Check
    // ========================================================================
    const signerMode = Deno.env.get('SERVER_SIGNER_MODE') || 'local';
    if (signerMode === 'webhook') {
      const devUrl = Deno.env.get('DEV_SIGNER_WEBHOOK_URL');
      const devAuth = Deno.env.get('DEV_SIGNER_WEBHOOK_AUTH');
      const prodUrl = Deno.env.get('SIGNER_WEBHOOK_URL');
      const prodAuth = Deno.env.get('SIGNER_WEBHOOK_AUTH');
      
      const activeUrl = devUrl || prodUrl;
      const activeAuth = devAuth || prodAuth;
      
      if (!activeUrl || !activeAuth) {
        console.error('❌ Webhook signer misconfigured: missing URL or AUTH');
        
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'SIGNER_MISCONFIGURED',
            mode: signerMode,
            hasUrl: !!activeUrl,
            hasAuth: !!activeAuth,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'SIGNER_MISCONFIGURED'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Enforce router allowlist with 0x v2 Settler validation
    const targetTo = trade.tx_payload.to.toLowerCase();
    
    if (trade.provider === '0x') {
      // For 0x quotes, validate against the original quote's transaction.to
      // Accept multiple common 0x quote shapes
      const quoteToRaw =
        (trade.raw_quote?.transaction?.to ??
         trade.raw_quote?.to ??
         trade.raw_quote?.tx?.to ??
         trade.raw_quote?.target);

      const quoteTo = typeof quoteToRaw === 'string' ? quoteToRaw.toLowerCase() : undefined;
      
      if (!quoteTo) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'MISSING_QUOTE_TO',
            message: '0x quote missing transaction.to',
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'MISSING_QUOTE_TO',
          message: '0x quote missing transaction.to for validation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (targetTo !== quoteTo) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'TO_MISMATCH',
            target_to: targetTo,
            quote_to: quoteTo,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TO_MISMATCH',
          target_to: trade.tx_payload.to,
          quote_to: trade.raw_quote.transaction.to,
          message: 'tx_payload.to does not match original 0x quote transaction.to'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // For non-0x providers, use static allowlist
      const toOk = ALLOWED_TO_ADDRESSES.some(a => a.toLowerCase() === targetTo);
      if (!toOk) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'TO_NOT_ALLOWED',
            to: trade.tx_payload.to,
            provider: trade.provider,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TO_NOT_ALLOWED',
          to: trade.tx_payload.to 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Send notification: sign attempt
    await sendNotification({
      event: 'sign_attempt',
      tradeId,
      chainId: trade.chain_id,
      provider: trade.provider,
      symbol: trade.symbol,
      side: trade.side,
    });

    // Get signer
    const signer = getSigner();
    
    // If local mode, verify taker matches signer address
    if (signer.type === 'local') {
      const botAddress = Deno.env.get('BOT_ADDRESS')!;
      if (trade.taker.toLowerCase() !== botAddress.toLowerCase()) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TAKER_MISMATCH',
          message: `Local mode requires taker to match BOT_ADDRESS (${botAddress}), got ${trade.taker}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Sign transaction
    console.log(`🔐 Signing trade ${tradeId} using ${signer.type} signer`);
    let signedTx: string;
    
    try {
      signedTx = await signer.sign(trade.tx_payload, trade.chain_id);
      console.log(`✅ Transaction signed: ${signedTx.slice(0, 20)}...`);
    } catch (signError: any) {
      console.error('❌ Signing failed:', signError);
      
      // Log error event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'error',
        severity: 'error',
        payload: {
          step: 'sign',
          error: signError.message,
          signer_type: signer.type,
        },
      });

      // Send notification: signing failed
      await sendNotification({
        event: 'signing_failed',
        tradeId,
        chainId: trade.chain_id,
        provider: trade.provider,
        symbol: trade.symbol,
        side: trade.side,
        error: signError.message,
      });

      return new Response(JSON.stringify({
        ok: false, 
        error: {
          code: 'SIGNING_FAILED',
          message: signError.message,
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send notification: broadcast attempt
    await sendNotification({
      event: 'broadcast_attempt',
      tradeId,
      chainId: trade.chain_id,
      txHash: null,
      provider: trade.provider,
      symbol: trade.symbol,
      side: trade.side,
    });

    // Broadcast transaction
    const rpcUrl = Deno.env.get('RPC_URL_8453')!;
    console.log(`📡 Broadcasting to Base RPC...`);
    
    try {
      const rpcResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const rpcResult = await rpcResponse.json();

      if (rpcResult.error) {
        console.error('❌ RPC error:', rpcResult.error);
        
        // Log error event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'error',
          severity: 'error',
          payload: {
            step: 'broadcast',
            rpc_error: rpcResult.error,
          },
        });

        // Send notification: broadcast failed
        await sendNotification({
          event: 'broadcast_failed',
          tradeId,
          chainId: trade.chain_id,
          provider: trade.provider,
          symbol: trade.symbol,
          side: trade.side,
          error: rpcResult.error.message || 'RPC error',
        });

        return new Response(JSON.stringify({
          ok: false, 
          error: {
            code: 'BROADCAST_FAILED',
            message: rpcResult.error.message || 'RPC error',
            rpcBody: rpcResult.error,
          }
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const txHash = rpcResult.result;
      console.log(`✅ Transaction broadcast: ${txHash}`);

      // Update trade to submitted
      await supabase
        .from('trades')
        .update({
          status: 'submitted',
          tx_hash: txHash,
          sent_at: new Date().toISOString(),
        })
        .eq('id', tradeId);

      // Log success event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'submit',
        severity: 'info',
        payload: {
          txHash,
          signer_type: signer.type,
        },
      });

      // Send notification: submitted
      await sendNotification({
        event: 'submitted',
        tradeId,
        chainId: trade.chain_id,
        txHash,
        provider: trade.provider,
        symbol: trade.symbol,
        side: trade.side,
        explorerUrl: `https://basescan.org/tx/${txHash}`,
      });

      return new Response(JSON.stringify({
        ok: true,
        tradeId,
        tx_hash: txHash,
        network: 'base',
        executedPrice: executedPrice || trade.price,
        symbol: trade.base || trade.symbol,
        side: trade.side,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (broadcastError: any) {
      console.error('❌ Broadcast exception:', broadcastError);
      
      // Log error event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'error',
        severity: 'error',
        payload: {
          step: 'broadcast',
          error: broadcastError.message,
        },
      });

      return new Response(JSON.stringify({ 
        ok: false, 
        error: {
          code: 'BROADCAST_EXCEPTION',
          message: broadcastError.message,
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('❌ Unexpected error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
