import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  try {
    console.log('=== Coinbase OAuth Callback Function Called ===');
    
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=${encodeURIComponent(error)}`,
        },
      });
    }

    if (!code || !state) {
      console.error('Missing code or state parameter');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=missing_parameters`,
        },
      });
    }

    console.log('OAuth callback - Code received, State:', state);

    // Initialize Supabase client with service role key for database operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get OAuth credentials
    const { data: oauthCreds, error: oauthError } = await supabase
      .from('coinbase_oauth_credentials')
      .select('client_id_encrypted, client_secret_encrypted, is_sandbox')
      .eq('is_active', true)
      .single();

    if (oauthError || !oauthCreds) {
      console.error('OAuth credentials error:', oauthError);
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=oauth_not_configured`,
        },
      });
    }

    const clientId = oauthCreds.client_id_encrypted;
    const clientSecret = oauthCreds.client_secret_encrypted;
    const baseUrl = oauthCreds.is_sandbox 
      ? 'https://www.sandbox.coinbase.com' 
      : 'https://www.coinbase.com';

    // Exchange authorization code for access token
    const tokenUrl = `${baseUrl}/oauth/token`;
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/coinbase-oauth-callback`;

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange error:', errorText);
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=token_exchange_failed`,
        },
      });
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');

    // Get user info from Coinbase to link the connection
    const userResponse = await fetch('https://api.coinbase.com/v2/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'CB-VERSION': '2023-08-01',
      },
    });

    if (!userResponse.ok) {
      console.error('Failed to get user info from Coinbase');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=user_info_failed`,
        },
      });
    }

    const userData = await userResponse.json();
    const coinbaseUserId = userData.data.id;

    // For this demo, we'll use a hardcoded user ID
    // In a real app, you'd get this from the state parameter or session
    const userId = '00000000-0000-0000-0000-000000000000'; // This should be the actual authenticated user ID

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

    // Store OAuth connection in database
    const { error: insertError } = await supabase
      .from('user_coinbase_connections')
      .upsert({
        user_id: userId,
        access_token_encrypted: tokenData.access_token,
        refresh_token_encrypted: tokenData.refresh_token,
        coinbase_user_id: coinbaseUserId,
        expires_at: expiresAt.toISOString(),
        is_active: true,
      });

    if (insertError) {
      console.error('Database insert error:', insertError);
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=database_error`,
        },
      });
    }

    console.log('OAuth connection saved successfully');

    // Redirect back to app with success
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?connected=true`,
      },
    });

  } catch (error) {
    console.error('Error in coinbase-oauth-callback function:', error);
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${Deno.env.get('SUPABASE_URL').replace('.supabase.co', '.lovable.app')}/?error=internal_error`,
      },
    });
  }
});