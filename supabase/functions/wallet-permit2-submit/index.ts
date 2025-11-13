// supabase/functions/wallet-permit2-submit/index.ts
// Validates Permit2 signature and builds transaction payload (NO broadcasting)
import { corsHeaders } from '../_shared/cors.ts';
import { logger } from '../_shared/logger.ts';
import { simulateCall } from '../_shared/eth.ts';
import { encodeFunctionData, parseAbi } from 'npm:viem@2.21.54';

const BASE_CHAIN_ID = 8453;
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// Permit2 ABI for the permit function
const PERMIT2_ABI = parseAbi([
  'function permit(address owner, tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature) external'
]);

interface SubmitRequest {
  chainId: number;
  owner: string;
  typedData: {
    domain: {
      name: string;
      version?: string;
      chainId: number;
      verifyingContract: string;
    };
    primaryType: string;
    message: {
      details: {
        token: string;
        amount: string;
        expiration: string;
        nonce: string;
      };
      spender: string;
      sigDeadline: string;
    };
  };
  signature: string;
  dryRun?: boolean;
  skipSimulation?: boolean;
}

interface SubmitResponse {
  success: boolean;
  txPayload?: {
    to: string;
    from: string;
    data: string;
    value: string;
  };
  simulation?: {
    success: boolean;
    result?: string;
    error?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed' }
      }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    logger.info('wallet_permit2_submit.start');

    // Parse request body
    const body: SubmitRequest = await req.json();
    const { chainId, owner, typedData, signature, dryRun, skipSimulation } = body;

    // Validate chainId
    if (chainId !== BASE_CHAIN_ID) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'unsupported_chain', chainId });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'UNSUPPORTED_CHAIN',
            message: `Only Base (chainId ${BASE_CHAIN_ID}) is supported. Received: ${chainId}`
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate owner address format
    if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'invalid_owner', owner });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_OWNER',
            message: 'Owner must be a valid Ethereum address (0x + 40 hex characters)'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate signature format
    if (!signature || signature.length !== 132 || !signature.startsWith('0x')) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'invalid_signature', sigLength: signature?.length });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Signature must be 132 characters (0x + 130 hex characters)'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate typedData structure
    if (!typedData || !typedData.domain || !typedData.message) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'missing_typed_data' });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_TYPED_DATA',
            message: 'typedData must include domain and message'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate domain matches Permit2 specifications
    const { domain } = typedData;
    if (
      domain.name !== 'Permit2' ||
      domain.chainId !== BASE_CHAIN_ID ||
      domain.verifyingContract.toLowerCase() !== PERMIT2_ADDRESS.toLowerCase()
    ) {
      logger.warn('wallet_permit2_submit.domain_mismatch', { 
        expected: { name: 'Permit2', chainId: BASE_CHAIN_ID, contract: PERMIT2_ADDRESS },
        received: domain 
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'DOMAIN_MISMATCH',
            message: `Domain must match Permit2 specifications for Base. Expected: name=Permit2, chainId=${BASE_CHAIN_ID}, contract=${PERMIT2_ADDRESS}`
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate primaryType
    if (typedData.primaryType !== 'PermitSingle') {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'invalid_primary_type', primaryType: typedData.primaryType });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_PRIMARY_TYPE',
            message: 'primaryType must be PermitSingle'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate message structure
    const { message } = typedData;
    if (!message.details || !message.spender || !message.sigDeadline) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'incomplete_message' });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INCOMPLETE_MESSAGE',
            message: 'message must include details, spender, and sigDeadline'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate details fields
    const { details } = message;
    if (!details.token || !details.amount || details.expiration === undefined || details.nonce === undefined) {
      logger.warn('wallet_permit2_submit.invalid_input', { reason: 'incomplete_details' });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INCOMPLETE_DETAILS',
            message: 'details must include token, amount, expiration, and nonce'
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build transaction payload - encode the permit function call
    const permitSingle = {
      details: {
        token: details.token as `0x${string}`,
        amount: BigInt(details.amount),
        expiration: BigInt(details.expiration),
        nonce: BigInt(details.nonce),
      },
      spender: message.spender as `0x${string}`,
      sigDeadline: BigInt(message.sigDeadline),
    };

    const encodedData = encodeFunctionData({
      abi: PERMIT2_ABI,
      functionName: 'permit',
      args: [
        owner as `0x${string}`,
        permitSingle,
        signature as `0x${string}`,
      ],
    });

    const txPayload = {
      to: PERMIT2_ADDRESS,
      from: owner,
      data: encodedData,
      value: '0x0',
    };

    logger.info('wallet_permit2_submit.tx_payload.built', { 
      to: txPayload.to, 
      from: txPayload.from,
      dataLength: encodedData.length 
    });

    // Handle skipSimulation escape hatch for debugging
    if (dryRun && skipSimulation) {
      logger.info('wallet_permit2_submit.skip_simulation', { skipSimulation: true });
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "submit",
          dryRun: true,
          skipSimulation: true,
          txPayload
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle dry-run simulation if requested
    let simulationResult;
    if (dryRun) {
      logger.info('wallet_permit2_submit.simulate.start');
      
      const simResult = await simulateCall(BASE_CHAIN_ID, {
        to: txPayload.to,
        from: txPayload.from,
        data: txPayload.data,
        value: txPayload.value,
      });

      if (simResult.success) {
        logger.info('wallet_permit2_submit.simulate.ok', { result: simResult.result });
        simulationResult = {
          success: true,
          result: simResult.result,
        };
      } else {
        logger.warn('wallet_permit2_submit.simulate.error', { error: simResult.error });
        // Include txPayload in error response for debugging
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "SIGNING_FAILED",
              message: "Gas estimation failed: execution reverted",
              details: simResult.error,
              txPayload
            }
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build success response
    const response: SubmitResponse = {
      success: true,
      txPayload,
    };

    if (simulationResult) {
      response.simulation = simulationResult;
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error('wallet_permit2_submit.unexpected_error', { 
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred'
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
