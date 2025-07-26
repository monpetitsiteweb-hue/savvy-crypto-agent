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
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=oauth_failed';
      console.log('Redirecting to frontend with error:', frontendUrl);
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state: !!state });
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=missing_params';
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
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=invalid_state';
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
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=config_error';
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

    // Exchange code for token
    const tokenUrl = oauthCreds.is_sandbox 
      ? 'https://api.sandbox.coinbase.com/oauth/token'
      : 'https://api.coinbase.com/oauth/token';

    const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;
    
    console.log('Token exchange details:', {
      tokenUrl,
      redirectUri,
      code: code ? 'present' : 'missing'
    });

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: oauthCreds.client_id_encrypted,
      client_secret: oauthCreds.client_secret_encrypted,
      redirect_uri: redirectUri,
    });

    console.log('Making token exchange request...');
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=token_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    // Get user info from Coinbase
    const userInfoUrl = oauthCreds.is_sandbox 
      ? 'https://api.sandbox.coinbase.com/v2/user'
      : 'https://api.coinbase.com/v2/user';

    console.log('Fetching user info from:', userInfoUrl);
    const userResponse = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();
    console.log('User info response:', {
      status: userResponse.status,
      ok: userResponse.ok,
      userId: userData.data?.id,
      userName: userData.data?.name
    });

    // Store the connection
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    console.log('Storing connection in database...');
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
      const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=storage_failed';
      return new Response(null, {
        status: 302,
        headers: { Location: frontendUrl }
      });
    }

    console.log('OAuth connection successfully stored for user:', userId);

    // Redirect back to frontend with success
    const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&success=connected';
    console.log('Redirecting to frontend with success:', frontendUrl);
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });

  } catch (error) {
    console.error('Critical error in oauth-callback function:', error);
    console.error('Error stack:', error.stack);
    
    const frontendUrl = 'https://fc7e001f-a738-4ce4-94e5-f25c301f368c.lovableproject.com/profile?tab=settings&error=server_error';
    console.log('Redirecting to frontend with server error:', frontendUrl);
    return new Response(null, {
      status: 302,
      headers: { Location: frontendUrl }
    });
  }
});