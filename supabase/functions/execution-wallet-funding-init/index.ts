/**
 * execution-wallet-funding-init
 * 
 * USER CALLABLE - Creates an idempotent funding request
 * Does NOT initiate actual transfer (that requires Coinbase integration)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's JWT
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const { 
      source_asset, 
      amount, 
      idempotency_key,
      chain_id = 8453 
    } = await req.json();

    if (!source_asset || !amount) {
      return new Response(
        JSON.stringify({ error: 'source_asset and amount are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate idempotency key if not provided
    const finalIdempotencyKey = idempotency_key || `funding-${user.id}-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Get user's execution wallet
    const { data: wallet, error: walletError } = await supabase
      .from('execution_wallets')
      .select('id, wallet_address, is_funded')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({ error: 'No active execution wallet found. Create a wallet first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing request with same idempotency key
    const { data: existingRequest } = await supabase
      .from('wallet_funding_requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('idempotency_key', finalIdempotencyKey)
      .single();

    if (existingRequest) {
      console.log(`[execution-wallet-funding-init] Returning existing request: ${existingRequest.id}`);
      return new Response(
        JSON.stringify({
          success: true,
          request_id: existingRequest.id,
          status: existingRequest.status,
          idempotency_key: existingRequest.idempotency_key,
          already_existed: true,
          wallet_address: wallet.wallet_address,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create new funding request
    const { data: fundingRequest, error: insertError } = await supabase
      .from('wallet_funding_requests')
      .insert({
        user_id: user.id,
        execution_wallet_id: wallet.id,
        idempotency_key: finalIdempotencyKey,
        chain_id,
        source_asset,
        requested_amount: amount.toString(),
        status: 'pending',
      })
      .select('id, status, idempotency_key')
      .single();

    if (insertError) {
      console.error('[execution-wallet-funding-init] Insert error:', insertError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to create funding request', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update onboarding status
    await supabase
      .from('user_onboarding_status')
      .update({ funding_initiated: true, current_step: 'funding' })
      .eq('user_id', user.id);

    console.log(`[execution-wallet-funding-init] Created request ${fundingRequest.id} for wallet ${wallet.wallet_address}`);

    return new Response(
      JSON.stringify({
        success: true,
        request_id: fundingRequest.id,
        status: fundingRequest.status,
        idempotency_key: fundingRequest.idempotency_key,
        already_existed: false,
        wallet_address: wallet.wallet_address,
        instructions: {
          message: 'Send funds to the wallet address below',
          destination_address: wallet.wallet_address,
          chain: chain_id === 8453 ? 'Base Mainnet' : `Chain ${chain_id}`,
          source_asset,
          amount,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-funding-init] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
