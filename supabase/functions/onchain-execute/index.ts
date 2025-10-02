import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { simulateCall, sendRawTransaction, waitForReceipt } from '../_shared/eth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const PROJECT_URL = Deno.env.get('SB_URL')!;
const SERVICE_ROLE = Deno.env.get('SB_SERVICE_ROLE')!;

// Service role client (bypasses RLS)
const supabase = createClient(PROJECT_URL, SERVICE_ROLE);

interface ExecuteRequest {
  chainId: number;
  base: string;
  quote: string;
  side: 'SELL' | 'BUY';
  amount: number;
  slippageBps?: number;
  provider?: '0x';
  taker?: string;
  mode?: 'build' | 'send';
  simulateOnly?: boolean;
  signedTx?: string; // For send mode
}

interface TradeRecord {
  id?: string;
  chain_id: number;
  base: string;
  quote: string;
  side: string;
  amount: number;
  slippage_bps: number;
  provider: string;
  taker: string | null;
  mode: string;
  simulate_only: boolean;
  price: number | null;
  min_out: string | null;
  gas_quote: number | null;
  raw_quote: any;
  status: string;
  tx_hash: string | null;
  tx_payload: any;
  receipts: any;
  effective_price: number | null;
  gas_wei: number | null;
  total_network_fee: string | null;
  notes: string | null;
}

async function addTradeEvent(tradeId: string, phase: string, severity: 'info' | 'warn' | 'error', payload: any) {
  const { error } = await supabase.from('trade_events').insert({
    trade_id: tradeId,
    phase,
    severity,
    payload,
  });
  if (error) {
    console.error('Failed to add trade event:', error);
  }
}

async function updateTradeStatus(tradeId: string, status: string, updates: Partial<TradeRecord>) {
  const { error } = await supabase
    .from('trades')
    .update({ status, ...updates })
    .eq('id', tradeId);
  if (error) {
    console.error('Failed to update trade status:', error);
  }
}

/**
 * Handle send-only request: broadcast a signed transaction for an existing built trade
 */
async function handleSendOnly(tradeId: string, signedTx: string) {
  console.log(`Send-only request for trade ${tradeId}`);

  // Validate trade exists and is in built status
  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .single();

  if (tradeError || !trade) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'TRADE_NOT_FOUND', message: 'Trade not found' } }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (trade.status !== 'built') {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Trade status is '${trade.status}', expected 'built'`,
        },
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Broadcast transaction
  console.log('Broadcasting signed transaction...');
  const sendResult = await sendRawTransaction(trade.chain_id, signedTx);

  if (!sendResult.success) {
    // Log error event
    await addTradeEvent(tradeId, 'error', 'error', {
      phase: 'submit',
      error: sendResult.error,
      rpcError: sendResult,
    });

    // Keep status as 'built' so user can retry
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'BROADCAST_FAILED',
          message: sendResult.error || 'Failed to broadcast transaction',
          rpcBody: sendResult,
        },
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const txHash = sendResult.txHash!;
  console.log(`Transaction submitted: ${txHash}`);

  // Update trade: status='submitted', tx_hash, sent_at
  await updateTradeStatus(tradeId, 'submitted', {
    tx_hash: txHash,
    // Note: sent_at would need to be added to TradeRecord interface if needed
  });

  // Log submit event
  await addTradeEvent(tradeId, 'submit', 'info', { txHash });

  return new Response(
    JSON.stringify({
      ok: true,
      tradeId,
      tx_hash: txHash,
      network: trade.chain_id === 8453 ? 'base' : `chain-${trade.chain_id}`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET handler - retrieve trade by ID
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url);
      const tradeId = url.searchParams.get('tradeId');
      
      if (!tradeId) {
        return new Response(
          JSON.stringify({ error: 'Missing tradeId parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch trade and events
      const { data: trade, error: tradeError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (tradeError || !trade) {
        return new Response(
          JSON.stringify({ error: 'Trade not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: events, error: eventsError } = await supabase
        .from('trade_events')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });

      return new Response(
        JSON.stringify({ trade, events: events || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('GET error:', error);
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // POST handler - execute trade
  try {
    const body: any = await req.json();
    
    // Check if this is a send-only request (tradeId + signedTx)
    if (body.tradeId && body.signedTx && !body.chainId) {
      return await handleSendOnly(body.tradeId, body.signedTx);
    }
    
    // Otherwise, proceed with full build/execute flow
    const { chainId, base, quote, side, amount, slippageBps = 50, provider = '0x', taker, mode = 'build', simulateOnly = false, signedTx } = body;

    if (!chainId || !base || !quote || !side || !amount) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: chainId, base, quote, side, amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (side !== 'SELL' && side !== 'BUY') {
      return new Response(
        JSON.stringify({ error: 'Invalid side: must be SELL or BUY' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (mode !== 'build' && mode !== 'send') {
      return new Response(
        JSON.stringify({ error: 'Invalid mode: must be build or send' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate taker if provided
    if (taker && !/^0x[0-9a-fA-F]{40}$/.test(taker)) {
      return new Response(
        JSON.stringify({ error: 'Invalid taker address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Received execute request: ${side} ${amount} ${base}/${quote} on chain ${chainId}, mode=${mode}, simulateOnly=${simulateOnly}`);

    // Step 1: Call /onchain-quote to get price snapshot
    const quoteUrl = new URL(`${PROJECT_URL}/functions/v1/onchain-quote`);
    const quotePayload = {
      chainId,
      base,
      quote,
      side,
      amount: String(amount),
      slippageBps,
      provider,
      taker, // Include taker for executable quote
    };

    console.log('Fetching quote:', quotePayload);

    const quoteResponse = await fetch(quoteUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify(quotePayload),
    });

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      return new Response(
        JSON.stringify({ error: `Quote failed: ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const quoteData = await quoteResponse.json();
    console.log('Quote received:', { provider: quoteData.provider, price: quoteData.price, gasCostQuote: quoteData.gasCostQuote });

    // ❗ Fail-fast if quote failed or has no price
    if (quoteData?.error || !quoteData?.price || !(quoteData.price > 0)) {
      return new Response(
        JSON.stringify({
          error: 'Quote failed',
          detail: quoteData?.error || 'No price in quote',
          raw: quoteData,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Insert trade record
    const tradeRecord: Omit<TradeRecord, 'id'> = {
      chain_id: chainId,
      base,
      quote,
      side,
      amount,
      slippage_bps: slippageBps,
      provider,
      taker: taker || null,
      mode,
      simulate_only: simulateOnly,
      price: quoteData.price || null,
      min_out: quoteData.minOut || null,
      gas_quote: quoteData.gasCostQuote || null,
      // Store actual 0x response for 0x provider, otherwise store wrapped response
      raw_quote: provider === '0x' ? quoteData.raw : quoteData,
      status: 'built',
      tx_hash: null,
      tx_payload: null,
      receipts: null,
      effective_price: null,
      gas_wei: null,
      total_network_fee: null,
      notes: null,
    };

    const { data: insertedTrade, error: insertError } = await supabase
      .from('trades')
      .insert(tradeRecord)
      .select()
      .single();

    if (insertError || !insertedTrade) {
      console.error('Failed to insert trade:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create trade record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tradeId = insertedTrade.id;
    console.log(`Trade record created: ${tradeId}`);

    // Add quote event
    await addTradeEvent(tradeId, 'quote', 'info', { quote: quoteData });

    // ❗ For 0x provider with taker in build mode, validate transaction object exists
    if (provider === '0x' && taker && mode === 'build') {
      if (!quoteData.raw?.transaction?.to) {
        console.error('0x quote missing transaction.to:', quoteData.raw);
        await addTradeEvent(tradeId, 'guard', 'error', {
          error: 'QUOTE_MISSING_TRANSACTION',
          message: '0x quote does not include transaction object with .to address',
          raw: quoteData.raw,
        });
        await updateTradeStatus(tradeId, 'failed', {
          notes: 'Quote validation failed: missing transaction.to',
        });
        return new Response(
          JSON.stringify({
            ok: false,
            tradeId,
            error: 'QUOTE_MISSING_TRANSACTION',
            message: '0x quote does not include transaction object with .to address',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 3: Build transaction payload
    let txPayload: any = null;

    if (provider === '0x' && quoteData.raw?.transaction) {
      // For 0x, derive tx_payload directly from raw_quote.transaction
      const tx = quoteData.raw.transaction;
      txPayload = {
        to: tx.to,
        data: tx.data,
        value: tx.value ?? '0x0',
        gas: tx.gas ?? tx.gasLimit,
        from: taker,
      };
      await updateTradeStatus(tradeId, 'built', { tx_payload: txPayload });
      console.log(`✅ Built trade ${tradeId}: tx.to=${txPayload.to}`);
    } else {
      // For other providers, use pickTx helper
      function pickTx(raw: any): any | null {
        if (!raw) return null;
        if (raw.transaction) return raw.transaction;
        if (Array.isArray(raw.transactions) && raw.transactions[0]) return raw.transactions[0];
        if (raw.protocolResponse?.tx) return raw.protocolResponse.tx;
        if (raw.tx) return raw.tx;
        return null;
      }

      const tx = pickTx(quoteData.raw);
      if (tx && tx.to && tx.data) {
        txPayload = {
          to: tx.to,
          data: tx.data,
          value: tx.value ?? '0x0',
          gas: tx.gas ?? tx.gasLimit,
          from: taker,
        };
        await updateTradeStatus(tradeId, 'built', { tx_payload: txPayload });
        console.log(`✅ Built trade ${tradeId}: tx.to=${txPayload.to}`);
      }
    }

    // Step 4: Simulate (if requested or in send mode)
    if ((simulateOnly || mode === 'send') && txPayload && taker) {
      console.log('Simulating transaction...');
      const simResult = await simulateCall(chainId, txPayload);

      await addTradeEvent(tradeId, 'simulate', simResult.success ? 'info' : 'error', simResult);

      if (!simResult.success) {
        await updateTradeStatus(tradeId, 'simulate_revert', {
          notes: `Simulation failed: ${simResult.error}`,
        });

        return new Response(
          JSON.stringify({
            tradeId,
            status: 'simulate_revert',
            error: simResult.error,
            price: quoteData.price,
            minOut: quoteData.minOut,
            gasCostQuote: quoteData.gasCostQuote,
            unit: quoteData.unit,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Simulation successful');
    }

    // If simulateOnly, return here
    if (simulateOnly) {
      return new Response(
        JSON.stringify({
          tradeId,
          status: 'built',
          price: quoteData.price,
          minOut: quoteData.minOut,
          gasCostQuote: quoteData.gasCostQuote,
          unit: quoteData.unit,
          txPayload,
          raw: quoteData.raw,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 5: Send transaction (if mode=send and signedTx provided)
    if (mode === 'send') {
      if (!signedTx) {
        return new Response(
          JSON.stringify({
            tradeId,
            status: 'built',
            error: 'signedTx required for send mode',
            txPayload,
            price: quoteData.price,
            minOut: quoteData.minOut,
            gasCostQuote: quoteData.gasCostQuote,
            unit: quoteData.unit,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Sending signed transaction...');
      const sendResult = await sendRawTransaction(chainId, signedTx);

      if (!sendResult.success) {
        await addTradeEvent(tradeId, 'submit', 'error', sendResult);
        await updateTradeStatus(tradeId, 'failed', {
          notes: `Send failed: ${sendResult.error}`,
        });

        return new Response(
          JSON.stringify({
            tradeId,
            status: 'failed',
            error: sendResult.error,
            price: quoteData.price,
            minOut: quoteData.minOut,
            gasCostQuote: quoteData.gasCostQuote,
            unit: quoteData.unit,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const txHash = sendResult.txHash!;
      console.log(`Transaction submitted: ${txHash}`);

      await updateTradeStatus(tradeId, 'submitted', { tx_hash: txHash });
      await addTradeEvent(tradeId, 'submit', 'info', { txHash });

      // Step 6: Wait for receipt (optional, async)
      // For now, return immediately with submitted status
      // In production, you might poll in background or let client poll

      return new Response(
        JSON.stringify({
          tradeId,
          status: 'submitted',
          txHash,
          price: quoteData.price,
          minOut: quoteData.minOut,
          gasCostQuote: quoteData.gasCostQuote,
          unit: quoteData.unit,
          raw: quoteData.raw,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: return built status with txPayload
    return new Response(
      JSON.stringify({
        tradeId,
        status: 'built',
        price: quoteData.price,
        minOut: quoteData.minOut,
        gasCostQuote: quoteData.gasCostQuote,
        unit: quoteData.unit,
        txPayload,
        raw: quoteData.raw,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Execute error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
