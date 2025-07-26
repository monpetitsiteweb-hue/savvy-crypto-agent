import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('OAuth callback params:', { code: !!code, state, error });

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error from Coinbase:', error);
      const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=oauth_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    if (!code || !state) {
      console.error('Missing code or state parameter');
      const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=missing_params';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Extract user ID from state
    const userId = state.split('_')[0];
    console.log('Extracted user ID from state:', userId);

    // Initialize Supabase client
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
      const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=config_error';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Exchange code for token
    const tokenUrl = oauthCreds.is_sandbox 
      ? 'https://api.sandbox.coinbase.com/oauth/token'
      : 'https://api.coinbase.com/oauth/token';

    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-callback`;

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: oauthCreds.client_id_encrypted,
        client_secret: oauthCreds.client_secret_encrypted,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Token exchange response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=token_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Get user info from Coinbase
    const userInfoUrl = oauthCreds.is_sandbox 
      ? 'https://api.sandbox.coinbase.com/v2/user'
      : 'https://api.coinbase.com/v2/user';

    const userResponse = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();
    console.log('User info response status:', userResponse.status);

    // Store the connection
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
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
      console.error('Failed to store connection:', insertError);
      const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=storage_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    console.log('OAuth connection successfully stored for user:', userId);

    // Redirect back to frontend with success
    const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&success=connected';
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });

  } catch (error) {
    console.error('Error in oauth-callback function:', error);
    
    const frontendUrl = 'https://fuieplftlcxdfkxyqzlt.lovable.app/profile?tab=settings&error=server_error';
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });
  }
});