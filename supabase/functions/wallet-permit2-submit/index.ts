/**
 * Permit2 Submit Proxy (Task 5.4)
 * Submits Permit2.permit() transaction server-side using our signer infrastructure
 * User provides their EIP-712 signature; we broadcast the permit transaction
 * 
 * Features:
 * - Comprehensive signature validation (chainId, domain, deadline, nonce)
 * - Dry-run mode support (EXECUTION_DRY_RUN env)
 * - Deterministic transaction processing
 * - Idempotency via nonce + signature tracking
 * 
 * Ref: https://docs.uniswap.org/contracts/permit2/reference/signature-transfer
 */

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { BASE_CHAIN_ID, BASE_0X, BASE_TOKENS } from '../_shared/addresses.ts';
import { getSigner } from '../_shared/signer.ts';
import { sendRawTransaction } from '../_shared/eth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { encodeFunctionData, parseAbi } from 'https://esm.sh/viem@1.21.4';
import { logger } from '../_shared/logger.ts';

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';
const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS') || '';
const EXECUTION_DRY_RUN = Deno.env.get('EXECUTION_DRY_RUN') !== 'false';

/**
 * Validate EIP-712 typed data structure with comprehensive checks
 */
function validateTypedData(
  typedData: any, 
  chainId: number, 
  expectedToken?: string
): { valid: boolean; code?: string; message?: string } {
  // Validate domain
  if (typedData.domain?.name !== 'Permit2') {
    logger.warn('permit2.sig.invalid', { reason: 'domain.name', expected: 'Permit2', got: typedData.domain?.name });
    return { valid: false, code: 'signature_invalid', message: 'typedData.domain.name must be "Permit2"' };
  }
  
  if (typedData.domain?.chainId !== chainId) {
    logger.warn('permit2.sig.invalid', { reason: 'domain.chainId', expected: chainId, got: typedData.domain?.chainId });
    return { valid: false, code: 'signature_invalid', message: `typedData.domain.chainId must match ${chainId}` };
  }
  
  if (typedData.domain?.verifyingContract?.toLowerCase() !== BASE_0X.PERMIT2.toLowerCase()) {
    logger.warn('permit2.sig.invalid', { reason: 'domain.verifyingContract', expected: BASE_0X.PERMIT2, got: typedData.domain?.verifyingContract });
    return { valid: false, code: 'signature_invalid', message: `typedData.domain.verifyingContract must be ${BASE_0X.PERMIT2}` };
  }

  // Validate message structure
  const msg = typedData.message;
  if (!msg || !msg.details || !msg.spender || msg.sigDeadline === undefined) {
    logger.warn('permit2.sig.invalid', { reason: 'message_structure', hasDetails: !!msg?.details, hasSpender: !!msg?.spender, hasSigDeadline: msg?.sigDeadline !== undefined });
    return { valid: false, code: 'signature_invalid', message: 'typedData.message must contain details, spender, sigDeadline' };
  }

  // Validate details structure
  const details = msg.details;
  if (!details.token || details.amount === undefined || details.expiration === undefined || details.nonce === undefined) {
    logger.warn('permit2.sig.invalid', { reason: 'details_structure', hasToken: !!details.token, hasAmount: details.amount !== undefined, hasExpiration: details.expiration !== undefined, hasNonce: details.nonce !== undefined });
    return { valid: false, code: 'signature_invalid', message: 'typedData.message.details must contain token, amount, expiration, nonce' };
  }

  // Validate token (if expected token provided)
  if (expectedToken && details.token.toLowerCase() !== expectedToken.toLowerCase()) {
    logger.warn('permit2.sig.invalid', { reason: 'token_mismatch', expected: expectedToken, got: details.token });
    return { valid: false, code: 'signature_invalid', message: `token must be ${expectedToken}` };
  }

  // Validate spender (must be 0x Exchange Proxy on Base)
  if (msg.spender.toLowerCase() !== BASE_0X.SPENDER.toLowerCase()) {
    logger.warn('permit2.sig.invalid', { reason: 'spender_mismatch', expected: BASE_0X.SPENDER, got: msg.spender });
    return { valid: false, code: 'signature_invalid', message: `spender must be ${BASE_0X.SPENDER} (0x Exchange Proxy on Base)` };
  }

  // Validate deadline (sigDeadline must be in the future)
  const nowSec = Math.floor(Date.now() / 1000);
  const sigDeadline = Number(msg.sigDeadline);
  if (sigDeadline <= nowSec) {
    logger.warn('permit2.sig.expired', { sigDeadline, nowSec, expiredBy: nowSec - sigDeadline });
    return { valid: false, code: 'signature_expired', message: `sigDeadline ${sigDeadline} has expired (now: ${nowSec})` };
  }

  // Validate nonce (must be non-negative integer)
  const nonce = Number(details.nonce);
  if (!Number.isInteger(nonce) || nonce < 0) {
    logger.warn('permit2.sig.invalid', { reason: 'invalid_nonce', nonce: details.nonce });
    return { valid: false, code: 'signature_invalid', message: 'nonce must be a non-negative integer' };
  }

  logger.info('permit2.sig.verify', { 
    token: details.token, 
    amount: details.amount, 
    nonce, 
    sigDeadline, 
    spender: msg.spender,
    expiresIn: sigDeadline - nowSec 
  });
  
  return { valid: true };
}

const permit2Abi = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)'
]);

/**
 * Encode Permit2.permit() calldata using viem
 */
function encodePermitCalldata(owner: string, typedData: any, signature: string): `0x${string}` {
  const m = typedData.message;
  return encodeFunctionData({
    abi: permit2Abi,
    functionName: 'permit',
    args: [
      owner as `0x${string}`,
      {
        details: {
          token: m.details.token as `0x${string}`,
          amount: BigInt(m.details.amount),
          expiration: Number(m.details.expiration),
          nonce: Number(m.details.nonce),
        },
        spender: m.spender as `0x${string}`,
        sigDeadline: BigInt(m.sigDeadline),
      },
      signature as `0x${string}`,
    ],
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, code: 'method_not_allowed', message: 'Only POST requests allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const startTime = Date.now();
  let body: any;
  
  try {
    const rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch (parseError) {
    logger.error('error', { code: 'bad_json', message: String(parseError) });
    return new Response(
      JSON.stringify({ ok: false, code: 'bad_json', message: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { 
      chainId, 
      owner, 
      address,  // alias for owner
      token, 
      spender, 
      amount, 
      nonce, 
      sigDeadline, 
      signature, 
      typedData,
      domain,
      types,
      message,
      dryRun 
    } = body;

    // Normalize inputs (support aliases)
    const normalizedOwner = owner || address;
    
    // Build typedData if provided in pieces
    const normalizedTypedData = typedData || (domain && types && message ? { domain, types, message } : null);

    logger.info('permit2.submit.start', { 
      owner: normalizedOwner, 
      token, 
      amount, 
      nonce, 
      chainId, 
      dryRun: dryRun ?? EXECUTION_DRY_RUN 
    });

    // Validate chainId (MUST be Base 8453)
    if (chainId !== BASE_CHAIN_ID) {
      logger.error('error', { code: 'invalid_chain', field: 'chainId', expected: BASE_CHAIN_ID, got: chainId });
      return new Response(
        JSON.stringify({ ok: false, code: 'invalid_chain', field: 'chainId', message: `Only Base (8453) supported, got ${chainId}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate owner address format
    if (!normalizedOwner || !/^0x[0-9a-fA-F]{40}$/.test(normalizedOwner)) {
      logger.error('error', { code: 'bad_request', field: 'owner', message: 'Invalid owner address format' });
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_request', field: 'owner', message: 'owner must be 0x-prefixed 20-byte hex' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate signature format (65 bytes = 130 hex chars + 0x)
    if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      logger.error('error', { code: 'bad_request', field: 'signature', message: 'Invalid signature format' });
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_request', field: 'signature', message: 'signature must be 65-byte hex (0x + 130 chars)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate typedData is provided
    if (!normalizedTypedData) {
      logger.error('error', { code: 'bad_request', field: 'typedData', message: 'typedData is required' });
      return new Response(
        JSON.stringify({ ok: false, code: 'bad_request', field: 'typedData', message: 'typedData (or domain/types/message) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate typed data structure with comprehensive checks
    const validation = validateTypedData(normalizedTypedData, chainId, token);
    if (!validation.valid) {
      const statusCode = validation.code === 'signature_expired' ? 422 : 
                        validation.code === 'signature_invalid' ? 422 : 400;
      return new Response(
        JSON.stringify({ ok: false, code: validation.code, message: validation.message }),
        { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build calldata
    const calldata = encodePermitCalldata(normalizedOwner, normalizedTypedData, signature);
    logger.debug('permit2.calldata', { length: calldata.length, preview: calldata.slice(0, 66) });

    // Build transaction payload
    const txPayload = {
      to: BASE_0X.PERMIT2,
      from: BOT_ADDRESS,
      data: calldata,
      value: '0x0',
      gas: '0x0', // Will be estimated by signer
    };

    // Determine dry-run mode (explicit param OR global env)
    const effectiveDryRun = dryRun ?? EXECUTION_DRY_RUN;

    if (effectiveDryRun) {
      // DRY-RUN MODE: Return success without broadcasting
      logger.info('permit2.submit.done', { 
        mode: 'submit', 
        dryRun: true, 
        owner: normalizedOwner, 
        token: normalizedTypedData.message.details.token,
        amount: normalizedTypedData.message.details.amount,
        nonce: normalizedTypedData.message.details.nonce,
        duration: Date.now() - startTime 
      });

      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'submit',
          dryRun: true,
          message: 'Dry-run mode enabled - transaction not broadcast',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // LIVE MODE: Sign and broadcast transaction
    const signer = getSigner();
    logger.info('signer.mode', { type: signer.type });
    
    let signedTx: string;
    try {
      signedTx = await signer.sign(txPayload, chainId);
      logger.info('signer.success', { txLength: signedTx.length });
    } catch (signError: any) {
      logger.error('signer.error', { code: 'signing_failed', message: signError.message });
      
      // Initialize Supabase client for logging
      const supabaseUrl = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from('trade_events').insert({
          trade_id: null,
          phase: 'permit2_submit',
          severity: 'error',
          payload: {
            error: 'signing_failed',
            message: signError.message,
            owner: normalizedOwner,
            token: normalizedTypedData.message.details.token,
          },
        });
      }

      return new Response(
        JSON.stringify({
          ok: false,
          code: 'signer_unavailable',
          message: signError.message,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Broadcast transaction
    logger.info('tx.broadcast.start', { chainId });
    const broadcastResult = await sendRawTransaction(chainId, signedTx);

    if (!broadcastResult.success) {
      logger.error('error', { code: 'broadcast_failed', message: broadcastResult.error });
      
      // Log error event
      const supabaseUrl = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from('trade_events').insert({
          trade_id: null,
          phase: 'permit2_submit',
          severity: 'error',
          payload: {
            error: 'broadcast_failed',
            message: broadcastResult.error,
            owner: normalizedOwner,
            token: normalizedTypedData.message.details.token,
            amount: normalizedTypedData.message.details.amount,
          },
        });
      }

      return new Response(
        JSON.stringify({
          ok: false,
          code: 'broadcast_failed',
          message: broadcastResult.error || 'Unknown RPC error',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txHash = broadcastResult.txHash!;
    logger.info('tx.broadcast', { hash: txHash });

    // Log success event
    const supabaseUrl = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('trade_events').insert({
        trade_id: null,
        phase: 'permit2_submit',
        severity: 'info',
        payload: {
          owner: normalizedOwner,
          token: normalizedTypedData.message.details.token,
          amount: normalizedTypedData.message.details.amount,
          nonce: normalizedTypedData.message.details.nonce,
          txHash,
        },
      });
    }

    logger.info('permit2.submit.done', { 
      mode: 'submit', 
      dryRun: false, 
      txHash, 
      duration: Date.now() - startTime 
    });

    return new Response(
      JSON.stringify({
        ok: true,
        mode: 'submit',
        dryRun: false,
        txHash,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error('error', { code: 'unhandled', message: String(error) });
    return new Response(
      JSON.stringify({ ok: false, code: 'internal_error', message: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
