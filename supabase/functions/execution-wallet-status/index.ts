/**
 * execution-wallet-status
 * 
 * USER CALLABLE - Returns safe wallet metadata only (no secrets)
 * Uses the user_wallet_info view to ensure no secret leakage
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Query safe view (RLS will filter to user's wallet)
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallet_info')
      .select('*')
      .single();

    if (walletError && walletError.code !== 'PGRST116') {
      console.error('[execution-wallet-status] Query error:', walletError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch wallet status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get onboarding status
    const { data: onboarding } = await supabase
      .from('user_onboarding_status')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Get pending funding requests
    const { data: fundingRequests } = await supabase
      .from('wallet_funding_requests')
      .select('id, status, source_asset, requested_amount, created_at')
      .eq('user_id', user.id)
      .in('status', ['pending', 'initiated', 'confirming'])
      .order('created_at', { ascending: false })
      .limit(5);

    return new Response(
      JSON.stringify({
        has_wallet: !!wallet,
        wallet: wallet ? {
          id: wallet.id,
          address: wallet.wallet_address,
          chain_id: wallet.chain_id,
          is_funded: wallet.is_funded,
          funded_at: wallet.funded_at,
          funded_amount_wei: wallet.funded_amount_wei,
          is_active: wallet.is_active,
          created_at: wallet.created_at,
        } : null,
        onboarding: onboarding ? {
          current_step: onboarding.current_step,
          coinbase_connected: onboarding.coinbase_connected,
          wallet_created: onboarding.wallet_created,
          funding_initiated: onboarding.funding_initiated,
          funding_confirmed: onboarding.funding_confirmed,
          rules_accepted: onboarding.rules_accepted,
        } : null,
        pending_funding_requests: fundingRequests || [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[execution-wallet-status] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
