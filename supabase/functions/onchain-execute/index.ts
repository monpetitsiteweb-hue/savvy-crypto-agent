import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { simulateCall, sendRawTransaction, waitForReceipt } from '../_shared/eth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { BASE_CHAIN_ID } from '../_shared/addresses.ts';
import { makePermit2Payload } from '../_shared/permit2Payload.ts';
import { signPermit2Single } from '../_shared/permit2Signer.ts';

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
  preflight?: boolean; // Default true, set false to skip preflight checks
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
 * Run preflight checks: WETH balance and Permit2 allowance
 * Returns a structured response if prerequisites are missing, null if all checks pass
 * 
 * Environment variables:
 * - ENABLE_AUTO_WRAP: Set to 'true' to allow automatic WETH wrapping when policy permits
 */
async function runPreflight(
  quoteData: any,
  params: { chainId: number; side: string; base: string; quote: string; taker: string }
): Promise<any | null> {
  const { chainId, side, base, quote, taker } = params;

  // Only run on Base for now
  if (chainId !== BASE_CHAIN_ID) {
    return null;
  }

  // Determine sell token based on side
  const sellToken = side === 'SELL' ? base : quote;
  
  // Get sellAmountAtomic from quote
  const sellAmountAtomic = quoteData.raw?.sellAmount;
  if (!sellAmountAtomic || typeof sellAmountAtomic !== 'string') {
    console.warn('Missing sellAmount in quote, skipping preflight');
    return null;
  }

  console.log(`Preflight: checking ${sellToken} for ${sellAmountAtomic} wei`);

  // Check if auto-wrap is enabled via policy/config
  const autoWrapEnabled = Deno.env.get('ENABLE_AUTO_WRAP') === 'true';
  console.log(`preflight.config: autoWrapEnabled=${autoWrapEnabled}`);

  // If selling ETH on Base, check WETH balance
  let tokenToCheck = sellToken;
  if (sellToken === 'ETH' && chainId === BASE_CHAIN_ID) {
    tokenToCheck = 'WETH';
    
    console.log('Checking WETH balance...');
    const wethResponse = await fetch(`${PROJECT_URL}/functions/v1/wallet-ensure-weth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify({
        address: taker,
        minWethNeeded: sellAmountAtomic,
        autoWrap: autoWrapEnabled, // Use config-driven auto-wrap policy
      }),
    });

    if (!wethResponse.ok) {
      const errorText = await wethResponse.text();
      console.error('WETH check failed:', errorText);
      
      // If auto-wrap is blocked by policy (e.g., address mismatch), return a structured error
      if (wethResponse.status === 409) {
        console.log('preflight.wrap.blocked: Auto-wrap policy not satisfied');
        return {
          status: 'preflight_required',
          reason: 'insufficient_weth',
          wrapPlan: { error: 'Auto-wrap blocked by policy', detail: errorText },
          note: 'Manual WETH wrap required or adjust policy.',
        };
      }
      
      return null;
    }

    const wethData = await wethResponse.json();
    if (wethData.action === 'wrap') {
      console.log('preflight.wrap.needed: WETH wrap required');
      return {
        status: 'preflight_required',
        reason: 'insufficient_weth',
        wrapPlan: wethData.wrapPlan,
        note: autoWrapEnabled 
          ? 'Auto-wrap enabled but not executed (read-only check).'
          : 'Wrap WETH manually, then re-run.',
      };
    }
    
    if (wethData.action === 'wrapped') {
      console.log('preflight.wrap.executed: Auto-wrap completed', {
        txHash: wethData.txHash,
        newBalance: wethData.newWethBalance,
      });
      // Continue to Permit2 checks after successful wrap
    }
    
    if (wethData.action === 'none') {
      console.log('preflight.wrap.sufficient: WETH balance already sufficient');
    }
  }

  // Check Permit2 allowance for the sell token
  console.log(`Checking Permit2 allowance for ${tokenToCheck}...`);
  const permit2Response = await fetch(`${PROJECT_URL}/functions/v1/wallet-permit2-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'apikey': SERVICE_ROLE,
    },
    body: JSON.stringify({
      address: taker,
      token: tokenToCheck,
      minAllowance: sellAmountAtomic,
    }),
  });

  if (!permit2Response.ok) {
    console.error('Permit2 check failed:', await permit2Response.text());
    return null;
  }

  const permit2Data = await permit2Response.json();
  if (permit2Data.action === 'permit2-sign') {
    console.log('Permit2 approval required');
    return {
      status: 'preflight_required',
      reason: 'permit2_required',
      typedData: permit2Data.typedData,
      spender: permit2Data.spender,
      permit2Contract: permit2Data.permit2Contract,
      note: 'Sign Permit2 then call Permit2.permit()',
    };
  }

  console.log('Preflight checks passed');
  return null;
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

  // GET handler - health checks and trade retrieval
  if (req.method === 'GET') {
    const url = new URL(req.url);
    
    // Health check: ?ping=1
    if (url.searchParams.get('ping') === '1') {
      return new Response(
        JSON.stringify({
          ok: true,
          name: 'onchain-execute',
          env: {
            has_SB_URL: !!Deno.env.get('SB_URL'),
            has_SB_SERVICE_ROLE: !!Deno.env.get('SB_SERVICE_ROLE'),
            has_RPC_URL_8453: !!Deno.env.get('RPC_URL_8453'),
            has_ZEROEX_API_KEY: !!Deno.env.get('ZEROEX_API_KEY'),
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Diagnostics: ?diag=1
    if (url.searchParams.get('diag') === '1') {
      return new Response(
        JSON.stringify({
          ok: true,
          name: 'onchain-execute',
          projectRef: 'fuieplftlcxdfkxyqzlt',
          signerMode: Deno.env.get('SERVER_SIGNER_MODE') || 'unset',
          runtime: {
            region: Deno.env.get('DENO_REGION') || 'unknown',
            node: typeof process !== 'undefined' ? process.version : 'N/A',
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    try {
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
    const url = new URL(req.url);
    const debugMode = url.searchParams.get('debug') === '1';
    const body: any = await req.json();
    const debugFromBody = body.debug === true;
    
    // Check if this is a send-only request (tradeId + signedTx)
    if (body.tradeId && body.signedTx && !body.chainId) {
      return await handleSendOnly(body.tradeId, body.signedTx);
    }
    
    // Otherwise, proceed with full build/execute flow
    const isDebug = debugMode || debugFromBody;
    const { chainId, base, quote, side, amount, slippageBps = 50, provider = '0x', taker, mode = 'build', simulateOnly = false, signedTx, preflight = true } = body;
    const preflightEnabled = preflight !== false && url.searchParams.get('preflight') !== '0';

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

    // ========== Safety Guards ==========
    // Guard 1: MAX_SELL_WEI - Prevent excessively large trades
    const MAX_SELL_WEI_STR = Deno.env.get('MAX_SELL_WEI') ?? '200000000000000000'; // 0.2 ETH default
    const maxSellWei = BigInt(MAX_SELL_WEI_STR);
    
    // Guard 2: MAX_SLIPPAGE_BPS - Prevent excessive slippage
    const MAX_SLIPPAGE_BPS = Number(Deno.env.get('MAX_SLIPPAGE_BPS') ?? '75'); // 0.75% default
    const requestedSlippageBps = slippageBps ?? 50;
    
    // Validate slippage first (before calculating sellAmount)
    if (requestedSlippageBps > MAX_SLIPPAGE_BPS) {
      console.error('❌ Slippage too high:', { requestedSlippageBps, MAX_SLIPPAGE_BPS });
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'slippage_too_high',
          message: `Requested slippage ${requestedSlippageBps} bps exceeds maximum ${MAX_SLIPPAGE_BPS} bps`,
          maxSlippageBps: MAX_SLIPPAGE_BPS,
          requestedSlippageBps,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        'apikey': SERVICE_ROLE,
      },
      body: JSON.stringify(quotePayload),
    });

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      const upstreamBody = errorText.substring(0, isDebug ? 2000 : 500);
      
      if (isDebug) {
        return new Response(
          JSON.stringify({
            ok: false,
            phase: 'quote',
            upstream: {
              status: quoteResponse.status,
              body: upstreamBody,
              attempts: []
            },
            headersUsed: {
              authorization: `SERVICE_ROLE (present: ${!!SERVICE_ROLE})`,
              apikeyPresent: true,
              zxVersion: 'v2',
              zxApiKeyPresent: !!Deno.env.get('ZEROEX_API_KEY')
            },
            note: 'Set ZEROEX_API_KEY and redeploy if 401/403.'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: `Quote failed: ${errorText.substring(0, 300)}`,
          upstreamStatus: quoteResponse.status,
          upstreamBody: upstreamBody
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const quoteData = await quoteResponse.json();
    console.log('Quote received:', { provider: quoteData.provider, price: quoteData.price, gasCostQuote: quoteData.gasCostQuote });

    // ========== Guard: Check sellAmount against MAX_SELL_WEI ==========
    // Extract sellAmountWei from quote (this is the atomic amount that will be sold)
    const sellAmountWei = quoteData.raw?.sellAmount ? BigInt(quoteData.raw.sellAmount) : 0n;
    
    if (sellAmountWei > maxSellWei) {
      console.error('❌ Sell amount too large:', { 
        sellAmountWei: sellAmountWei.toString(), 
        maxSellWei: maxSellWei.toString() 
      });
      
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'sell_amount_too_large',
          message: `Sell amount ${sellAmountWei.toString()} wei exceeds maximum ${maxSellWei.toString()} wei`,
          maxSellWei: MAX_SELL_WEI_STR,
          sellAmountWei: sellAmountWei.toString(),
          humanReadable: {
            sellAmount: `${Number(sellAmountWei) / 1e18} ETH`,
            maxSell: `${Number(maxSellWei) / 1e18} ETH`,
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Safety guards passed:', { 
      sellAmountWei: sellAmountWei.toString(),
      maxSellWei: maxSellWei.toString(),
      slippageBps: requestedSlippageBps,
      maxSlippageBps: MAX_SLIPPAGE_BPS,
    });

    // ========== Permit2 Signing Integration ==========
    // For SELL ETH/WETH on Base with 0x provider, sign Permit2 approval
    let permit2Data: any = null;
    
    const WETH_BASE = "0x4200000000000000000000000000000000000006" as const;
    const OX_PROXY = "0xDef1C0ded9bec7F1a1670819833240f027b25EfF" as const;
    
    if (
      provider === '0x' && 
      chainId === BASE_CHAIN_ID && 
      side === 'SELL' && 
      (base === 'ETH' || base === 'WETH') &&
      taker &&
      quoteData.raw?.sellAmount
    ) {
      try {
        console.log('permit2.flow.start: Generating Permit2 signature');
        
        const sellAmountWei = quoteData.raw.sellAmount;
        const sigDeadlineSec = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
        
        const permitPayload = makePermit2Payload({
          token: WETH_BASE,
          amountWei: sellAmountWei,
          spender: OX_PROXY,
          sigDeadlineSec,
        });
        
        const { signer, signature } = await signPermit2Single(permitPayload);
        
        permit2Data = {
          signature,
          details: permitPayload.message.details,
          spender: permitPayload.message.spender,
          sigDeadline: permitPayload.message.sigDeadline,
          signer,
        };
        
        console.log('permit2.flow.complete', { 
          signer, 
          amount: sellAmountWei,
          deadline: sigDeadlineSec 
        });
        
        // Log successful Permit2 generation
        await addTradeEvent(tradeId || 'pending', 'permit2', 'info', { 
          signer,
          amount: sellAmountWei,
          sigDeadline: sigDeadlineSec,
          note: 'Permit2 signature generated successfully'
        });
        
        // Store permit2 data for potential use in 0x /swap/permit2/quote endpoint
        // (Implementation note: Current 0x v2 integration uses /swap/quote which handles Permit2 internally.
        //  If switching to /swap/permit2/quote, include permit2Data in the quote request.)
        
      } catch (error) {
        console.error('permit2.flow.error', { error: String(error) });
        await addTradeEvent(tradeId, 'permit2', 'error', { 
          error: String(error),
          note: 'Permit2 signing failed, continuing without it' 
        });
        // Continue without Permit2 - let the transaction fail naturally if approval is required
      }
    }

    // ❗ Fail-fast if quote failed or has no price
    if (quoteData?.error || !quoteData?.price || !(quoteData.price > 0)) {
      if (isDebug) {
        return new Response(
          JSON.stringify({
            ok: false,
            phase: 'quote',
            upstream: {
              status: 200,
              body: JSON.stringify(quoteData).substring(0, 2000),
              attempts: quoteData.raw?.debug?.attempts || []
            },
            headersUsed: {
              authorization: `SERVICE_ROLE (present: ${!!SERVICE_ROLE})`,
              apikeyPresent: true,
              zxVersion: 'v2',
              zxApiKeyPresent: !!Deno.env.get('ZEROEX_API_KEY')
            },
            note: 'Set ZEROEX_API_KEY and redeploy if 401/403.'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({
          error: 'Quote failed',
          detail: quoteData?.error || 'No price in quote',
          upstreamBody: JSON.stringify(quoteData).substring(0, 500),
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
      notes: permit2Data ? `Permit2 signed: ${permit2Data.signer}` : null,
    };

    // Guard: only persist if persist !== false
    let tradeId: string;
    if (body.persist !== false) {
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

      tradeId = insertedTrade.id;
      console.log(`Trade record created: ${tradeId}`);
    } else {
      tradeId = 'no-persist-' + crypto.randomUUID();
      console.log(`Skipping trade persistence (persist=false), mock tradeId: ${tradeId}`);
    }

    // Add quote event
    await addTradeEvent(tradeId, 'quote', 'info', { quote: quoteData });

    // Run preflight checks if enabled and taker is present
    if (preflightEnabled && taker) {
      console.log('Running preflight checks...');
      const preflightResult = await runPreflight(quoteData, { chainId, side, base, quote, taker });
      if (preflightResult) {
        console.log('Preflight failed:', preflightResult.reason);
        await addTradeEvent(tradeId, 'preflight', 'warn', preflightResult);
        return new Response(
          JSON.stringify({
            tradeId,
            ...preflightResult,
            price: quoteData.price,
            minOut: quoteData.minOut,
            gasCostQuote: quoteData.gasCostQuote,
            unit: quoteData.unit,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

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
          permit2: permit2Data, // Include Permit2 signature data if generated
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
            permit2: permit2Data, // Include Permit2 signature data if generated
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
        permit2: permit2Data, // Include Permit2 signature data if generated
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
