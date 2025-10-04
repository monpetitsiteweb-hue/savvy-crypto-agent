/**
 * Permit2 Submit Proxy
 * Submits Permit2.permit() transaction server-side using our signer infrastructure
 * User provides their EIP-712 signature; we broadcast the permit transaction
 * 
 * Ref: https://docs.uniswap.org/contracts/permit2/reference/signature-transfer
 */

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { BASE_CHAIN_ID, BASE_0X } from '../_shared/addresses.ts';
import { getSigner } from '../_shared/signer.ts';
import { sendRawTransaction } from '../_shared/eth.ts';
import { corsHeaders } from '../_shared/cors.ts';

const RPC_URL = Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com';
const BOT_ADDRESS = Deno.env.get('BOT_ADDRESS') || '';

/**
 * Validate EIP-712 typed data structure
 */
function validateTypedData(typedData: any, chainId: number): string | null {
  // Validate domain
  if (typedData.domain?.name !== 'Permit2') {
    return 'typedData.domain.name must be "Permit2"';
  }
  if (typedData.domain?.chainId !== chainId) {
    return `typedData.domain.chainId must match request chainId (${chainId})`;
  }
  if (typedData.domain?.verifyingContract?.toLowerCase() !== BASE_0X.PERMIT2.toLowerCase()) {
    return `typedData.domain.verifyingContract must be ${BASE_0X.PERMIT2}`;
  }

  // Validate message structure
  const msg = typedData.message;
  if (!msg || !msg.details || !msg.spender || !msg.sigDeadline) {
    return 'typedData.message must contain details, spender, sigDeadline';
  }

  // Validate spender
  if (msg.spender.toLowerCase() !== BASE_0X.SPENDER.toLowerCase()) {
    return `typedData.message.spender must be ${BASE_0X.SPENDER} (0x Exchange Proxy on Base)`;
  }

  return null;
}

/**
 * Encode Permit2.permit() calldata
 * Function: permit(address owner, PermitSingle permitSingle, bytes signature)
 */
function encodePermitCalldata(owner: string, typedData: any, signature: string): string {
  const msg = typedData.message;
  const details = msg.details;

  // Permit2.permit() selector: 0x30f28b7a
  const selector = '30f28b7a';

  // ABI encode parameters
  // owner (address)
  const ownerPadded = owner.slice(2).padStart(64, '0');

  // Offset to permitSingle struct (3 * 32 bytes from start)
  const permitSingleOffset = (3 * 32).toString(16).padStart(64, '0');

  // Offset to signature bytes (calculated after permitSingle struct)
  const signatureOffset = (3 * 32 + 6 * 32).toString(16).padStart(64, '0');

  // PermitSingle struct (6 words):
  // details.token (address)
  const tokenPadded = details.token.slice(2).padStart(64, '0');
  // details.amount (uint160)
  const amountPadded = BigInt(details.amount).toString(16).padStart(64, '0');
  // details.expiration (uint48)
  const expirationPadded = BigInt(details.expiration).toString(16).padStart(64, '0');
  // details.nonce (uint48)
  const noncePadded = BigInt(details.nonce).toString(16).padStart(64, '0');
  // spender (address)
  const spenderPadded = msg.spender.slice(2).padStart(64, '0');
  // sigDeadline (uint256)
  const deadlinePadded = BigInt(msg.sigDeadline).toString(16).padStart(64, '0');

  // Signature bytes (dynamic)
  const sigBytes = signature.slice(2); // Remove 0x
  const sigLength = (sigBytes.length / 2).toString(16).padStart(64, '0');
  const sigPadded = sigBytes.padEnd(Math.ceil(sigBytes.length / 64) * 64, '0');

  const calldata = '0x' + selector + 
    ownerPadded + 
    permitSingleOffset + 
    signatureOffset +
    tokenPadded +
    amountPadded +
    expirationPadded +
    noncePadded +
    spenderPadded +
    deadlinePadded +
    sigLength +
    sigPadded;

  return calldata;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { chainId, owner, typedData, signature } = await req.json();

    // Validate chainId
    if (chainId !== BASE_CHAIN_ID) {
      return new Response(
        JSON.stringify({ ok: false, error: `Only Base (8453) supported, got ${chainId}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate owner address format
    if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid owner address format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate signature format
    if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid signature format (expected 65-byte hex)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate typed data structure
    const typedDataError = validateTypedData(typedData, chainId);
    if (typedDataError) {
      return new Response(
        JSON.stringify({ ok: false, error: typedDataError }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📝 Permit2 submit for owner=${owner}, token=${typedData.message.details.token}`);

    // Build calldata
    const calldata = encodePermitCalldata(owner, typedData, signature);
    console.log(`📦 Calldata: ${calldata.slice(0, 100)}...`);

    // Build transaction payload
    const txPayload = {
      to: BASE_0X.PERMIT2,
      from: BOT_ADDRESS,
      data: calldata,
      value: '0x0',
      gas: '0x0', // Will be estimated by signer
    };

    // Get signer and sign transaction
    const signer = getSigner();
    console.log(`🔐 Signing with ${signer.type} signer...`);
    
    let signedTx: string;
    try {
      signedTx = await signer.sign(txPayload, chainId);
      console.log(`✅ Transaction signed`);
    } catch (signError: any) {
      console.error('❌ Signing failed:', signError);
      
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
            error: 'SIGNING_FAILED',
            message: signError.message,
            owner,
            token: typedData.message.details.token,
          },
        });
      }

      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'SIGNING_FAILED',
            message: signError.message,
          }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Broadcast transaction
    console.log(`📡 Broadcasting to Base RPC...`);
    const broadcastResult = await sendRawTransaction(chainId, signedTx);

    if (!broadcastResult.success) {
      console.error('❌ Broadcast failed:', broadcastResult.error);
      
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
            error: 'BROADCAST_FAILED',
            message: broadcastResult.error,
            owner,
            token: typedData.message.details.token,
            amount: typedData.message.details.amount,
          },
        });
      }

      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'BROADCAST_FAILED',
            message: broadcastResult.error || 'Unknown RPC error',
            rpcBody: broadcastResult.error,
          }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txHash = broadcastResult.txHash!;
    console.log(`✅ Permit2 transaction broadcast: ${txHash}`);

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
          owner,
          token: typedData.message.details.token,
          amount: typedData.message.details.amount,
          txHash,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        network: 'base',
        tx_hash: txHash,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('wallet-permit2-submit error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
