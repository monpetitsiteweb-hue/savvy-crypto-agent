/**
 * execution-wallet-funding-confirm
 * 
 * SERVICE ROLE / CRON - Reconciles on-chain deposits and marks wallets as funded
 * 
 * This function:
 * 1. Checks pending funding requests
 * 2. Queries on-chain balance
 * 3. Updates funding status when funds are confirmed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// RPC endpoints by chain
const RPC_ENDPOINTS: Record<number, string> = {
  8453: 'https://mainnet.base.org', // Base mainnet
  84532: 'https://sepolia.base.org', // Base Sepolia
};

interface FundingRequest {
  id: string;
  user_id: string;
  execution_wallet_id: string;
  chain_id: number;
  source_asset: string;
  requested_amount: string;
  requested_amount_wei: string | null;
  expected_amount_wei: string | null;
  status: string;
}

interface ExecutionWallet {
  id: string;
  wallet_address: string;
  chain_id: number;
}

// Get ETH balance via RPC
async function getEthBalance(address: string, chainId: number): Promise<bigint> {
  const rpc = Deno.env.get(`RPC_URL_${chainId}`) || RPC_ENDPOINTS[chainId];
  
  if (!rpc) {
    throw new Error(`No RPC endpoint for chain ${chainId}`);
  }

  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return BigInt(data.result);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Parse optional filters
    let userId: string | undefined;
    let requestId: string | undefined;
    
    try {
      const body = await req.json();
      userId = body.user_id;
      requestId = body.request_id;
    } catch {
      // No body is fine for cron
    }

    // Get pending funding requests
    let query = supabaseAdmin
      .from('wallet_funding_requests')
      .select(`
        id,
        user_id,
        execution_wallet_id,
        chain_id,
        source_asset,
        requested_amount,
        requested_amount_wei,
        expected_amount_wei,
        status
      `)
      .in('status', ['pending', 'initiated', 'confirming']);

    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (requestId) {
      query = query.eq('id', requestId);
    }

    const { data: requests, error: requestsError } = await query.limit(50);

    if (requestsError) {
      throw new Error(`Failed to fetch requests: ${requestsError.message}`);
    }

    if (!requests || requests.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending funding requests', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[execution-wallet-funding-confirm] Processing ${requests.length} requests`);

    const results: Array<{
      request_id: string;
      status: 'confirmed' | 'still_pending' | 'error';
      balance_wei?: string;
      error?: string;
    }> = [];

    for (const request of requests as FundingRequest[]) {
      try {
        // Get wallet address
        const { data: wallet } = await supabaseAdmin
          .from('execution_wallets')
          .select('id, wallet_address, chain_id')
          .eq('id', request.execution_wallet_id)
          .single();

        if (!wallet) {
          results.push({
            request_id: request.id,
            status: 'error',
            error: 'Wallet not found',
          });
          continue;
        }

        // Check on-chain balance
        const balance = await getEthBalance(wallet.wallet_address, wallet.chain_id);
        
        // Minimum threshold for "funded" (0.001 ETH = 1e15 wei)
        const minThreshold = BigInt('1000000000000000');
        
        if (balance >= minThreshold) {
          // Update funding request
          await supabaseAdmin
            .from('wallet_funding_requests')
            .update({
              status: 'confirmed',
              received_amount_wei: balance.toString(),
              confirmed_at: new Date().toISOString(),
            })
            .eq('id', request.id);

          // Update wallet
          await supabaseAdmin
            .from('execution_wallets')
            .update({
              is_funded: true,
              funded_at: new Date().toISOString(),
              funded_amount_wei: balance.toString(),
            })
            .eq('id', wallet.id);

          // Update onboarding
          await supabaseAdmin
            .from('user_onboarding_status')
            .update({
              funding_confirmed: true,
              current_step: 'rules_confirmation',
            })
            .eq('user_id', request.user_id);

          console.log(`[execution-wallet-funding-confirm] Confirmed funding for wallet ${wallet.wallet_address}: ${balance} wei`);

          results.push({
            request_id: request.id,
            status: 'confirmed',
            balance_wei: balance.toString(),
          });
        } else {
          // Update status to 'confirming' if still pending
          if (request.status === 'pending') {
            await supabaseAdmin
              .from('wallet_funding_requests')
              .update({ status: 'initiated', initiated_at: new Date().toISOString() })
              .eq('id', request.id);
          }

          results.push({
            request_id: request.id,
            status: 'still_pending',
            balance_wei: balance.toString(),
          });
        }
      } catch (error) {
        console.error(`[execution-wallet-funding-confirm] Error processing ${request.id}:`, error.message);
        results.push({
          request_id: request.id,
          status: 'error',
          error: error.message,
        });
      }
    }

    const confirmed = results.filter(r => r.status === 'confirmed').length;
    const pending = results.filter(r => r.status === 'still_pending').length;
    const errors = results.filter(r => r.status === 'error').length;

    return new Response(
      JSON.stringify({
        processed: results.length,
        confirmed,
        pending,
        errors,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-funding-confirm] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
