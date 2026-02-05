// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== OAuth Callback Function Called ===');
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('OAuth callback params:', { 
      code: code ? 'present' : 'missing', 
      state: state ? 'present' : 'missing', 
      error: error || 'none',
      fullUrl: req.url 
    });

    // Handle OAuth errors from Coinbase
    if (error) {
      console.error('OAuth error from Coinbase:', error);
      const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=connections&error=oauth_failed';
      console.log('Redirecting to frontend with error:', frontendUrl);
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=connections&error=missing_params';
      console.log('Redirecting to frontend with missing params error:', frontendUrl);
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Extract user ID from state
    const userId = state.split('_')[0];
    console.log('Extracted user ID from state:', userId);

    if (!userId) {
      console.error('Invalid state parameter - could not extract user ID:', state);
      const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=settings&error=invalid_state';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('Supabase environment check:', {
      url: supabaseUrl ? 'present' : 'missing',
      serviceKey: supabaseServiceKey ? 'present' : 'missing'
    });

    const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

    // Get OAuth credentials
    console.log('Fetching OAuth credentials...');
    const { data: oauthCreds, error: oauthError } = await supabase
      .from('coinbase_oauth_credentials')
      .select('client_id_encrypted, client_secret_encrypted, is_sandbox')
      .eq('is_active', true)
      .single();

    if (oauthError || !oauthCreds) {
      console.error('OAuth credentials error:', oauthError);
      const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=settings&error=config_error';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    console.log('OAuth credentials found:', {
      clientId: oauthCreds.client_id_encrypted ? 'present' : 'missing',
      clientSecret: oauthCreds.client_secret_encrypted ? 'present' : 'missing',
      isSandbox: oauthCreds.is_sandbox
    });

    // Exchange code for token - Always use production API, not sandbox
    const tokenUrl = 'https://api.coinbase.com/oauth/token';
    const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;
    
    console.log('Token exchange details:', {
      tokenUrl,
      redirectUri,
      code: code ? 'present' : 'missing',
      clientId: oauthCreds.client_id_encrypted ? 'present' : 'missing',
      clientSecret: oauthCreds.client_secret_encrypted ? 'present' : 'missing'
    });

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: oauthCreds.client_id_encrypted,
      client_secret: oauthCreds.client_secret_encrypted,
      redirect_uri: redirectUri,
    });

    console.log('Making token exchange request to:', tokenUrl);
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: tokenBody,
    });

    const tokenData = await tokenResponse.json();
    console.log('Token exchange response:', {
      status: tokenResponse.status,
      ok: tokenResponse.ok,
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      error: tokenData.error
    });

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=settings&error=token_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Get user info from Coinbase - Always use production API
    const userInfoUrl = 'https://api.coinbase.com/v2/user';

    console.log('Fetching user info from:', userInfoUrl);
    const userResponse = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    // ============================================================
    // COINBASE → EXTERNAL FUNDING WALLET DISCOVERY
    // ============================================================
    // Fetch user's Coinbase accounts to discover wallet addresses
    // These will be inserted into user_external_addresses with source='coinbase'
    // This makes Coinbase a first-class external funding wallet source
    // ============================================================
    console.log('Fetching Coinbase accounts for wallet discovery...');
    
    const accountsResponse = await fetch('https://api.coinbase.com/v2/accounts?limit=100', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'CB-VERSION': '2024-01-01',
      },
    });

    const accountsData = await accountsResponse.json();
    console.log('Coinbase accounts response:', {
      status: accountsResponse.status,
      ok: accountsResponse.ok,
      accountCount: accountsData.data?.length || 0,
    });

    // Collect all wallet addresses from Coinbase accounts
    const walletAddresses: string[] = [];
    
    if (accountsData.data && Array.isArray(accountsData.data)) {
      for (const account of accountsData.data) {
        // Fetch deposit addresses for each account
        try {
          const addressesResponse = await fetch(
            `https://api.coinbase.com/v2/accounts/${account.id}/addresses`,
            {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'CB-VERSION': '2024-01-01',
              },
            }
          );
          
          if (addressesResponse.ok) {
            const addressesData = await addressesResponse.json();
            if (addressesData.data && Array.isArray(addressesData.data)) {
              for (const addr of addressesData.data) {
                // Only collect EVM-compatible addresses (0x prefixed, 42 chars)
                if (addr.address && 
                    addr.address.startsWith('0x') && 
                    addr.address.length === 42) {
                  walletAddresses.push(addr.address.toLowerCase());
                }
              }
            }
          }
        } catch (addrError) {
          console.warn('Failed to fetch addresses for account:', account.id, addrError);
        }
      }
    }

    // Deduplicate addresses
    const uniqueAddresses = [...new Set(walletAddresses)];
    console.log('Discovered Coinbase wallet addresses:', {
      total: walletAddresses.length,
      unique: uniqueAddresses.length,
      addresses: uniqueAddresses.slice(0, 5), // Log first 5 for debugging
    });

    // Insert discovered addresses into user_external_addresses
    // Uses ON CONFLICT to ensure idempotency (no duplicates)
    const BASE_CHAIN_ID = 8453;
    
    for (const address of uniqueAddresses) {
      const { error: insertError } = await supabase
        .from('user_external_addresses')
        .upsert(
          {
            user_id: userId,
            chain_id: BASE_CHAIN_ID,
            address: address,
            label: 'Coinbase wallet',
            is_verified: true,
            source: 'coinbase',
          },
          {
            onConflict: 'chain_id,address',
            ignoreDuplicates: true,
          }
        );

      if (insertError) {
        console.warn('Failed to insert Coinbase address:', address, insertError);
      } else {
        console.log('Successfully registered Coinbase address:', address);
      }
    }

    console.log('Coinbase wallet discovery complete. Addresses registered:', uniqueAddresses.length);
    console.log('User info response:', {
      status: userResponse.status,
      ok: userResponse.ok,
      userId: userData.data?.id,
      userName: userData.data?.name
    });

    // Check if this is a refresh of existing connection
    const refreshExisting = url.searchParams.get('refresh_existing') === 'true';
    const connectionId = url.searchParams.get('connection_id');

    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    console.log('Storing connection in database...');
    
    if (refreshExisting && connectionId) {
      // Update existing connection and ensure it's active
      const { error: updateError } = await supabase
        .from('user_coinbase_connections')
        .update({
          access_token_encrypted: tokenData.access_token,
          refresh_token_encrypted: tokenData.refresh_token,
          coinbase_user_id: userData.data?.id,
          expires_at: expiresAt,
          last_sync: new Date().toISOString(),
          is_active: true
        })
        .eq('id', connectionId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to update connection:', updateError);
        const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=connections&error=storage_failed';
        return new Response(null, {
          status: 302,
          headers: { Location: frontendUrl }
        });
      }

      console.log('Successfully refreshed OAuth connection:', connectionId);
    } else {
      // First deactivate all existing connections for this user
      await supabase
        .from('user_coinbase_connections')
        .update({ is_active: false })
        .eq('user_id', userId);

      // Create new connection
      const { error: insertError } = await supabase
        .from('user_coinbase_connections')
        .insert({
          user_id: userId,
          access_token_encrypted: tokenData.access_token,
          refresh_token_encrypted: tokenData.refresh_token,
          coinbase_user_id: userData.data?.id,
          expires_at: expiresAt,
          is_active: true
        });

      if (insertError) {
        console.error('Failed to insert connection:', insertError);
        const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=connections&error=storage_failed';
        return new Response(null, {
          status: 302,
          headers: { Location: frontendUrl }
        });
      }
    }

    console.log('OAuth connection successfully stored for user:', userId);

    // Redirect back to frontend with success
    const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=connections&success=connected';
    console.log('Redirecting to frontend with success:', frontendUrl);
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });

  } catch (error) {
    console.error('Critical error in oauth-callback function:', error);
    console.error('Error stack:', error.stack);
    
    const frontendUrl = 'https://preview--savvy-crypto-agent.lovable.app/profile?tab=settings&error=server_error';
    console.log('Redirecting to frontend with server error:', frontendUrl);
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });
  }
});